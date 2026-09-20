import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import {DatabaseSync} from "node:sqlite";
import {Wallet,BrowserProvider} from "ethers";
import {DataItem} from "@irys/bundles/node";
import ganache from "ganache";
import {env} from "cloudflare:workers";
await test("Storage checkout",async suite=>{
const sqlite=new DatabaseSync(":memory:");
for(const file of ["drizzle/0000_peaceful_avengers.sql","drizzle/0001_storage_quotes.sql"])sqlite.exec(fs.readFileSync(file,"utf8").replaceAll("--> statement-breakpoint",""));
function prepared(sql,args=[]){return{bind(...v){return prepared(sql,v)},async first(){return sqlite.prepare(sql).get(...args)||null},async run(){return{success:true,meta:sqlite.prepare(sql).run(...args)}}};}
env.DB={prepare:prepared,async batch(statements){return Promise.all(statements.map(s=>s.run()))}};
const chain=ganache.provider({logging:{quiet:true},chain:{chainId:1},wallet:{totalAccounts:2}});
const provider=new BrowserProvider(chain,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
const wallet=new Wallet(Object.values(chain.getInitialAccounts())[0].secretKey,provider);
const rpcServer=http.createServer(async(req,res)=>{
  try{let raw="";for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);const result=await chain.request({method:body.method,params:body.params});res.setHeader("Content-Type","application/json");res.end(JSON.stringify({jsonrpc:"2.0",id:body.id,result}));}
  catch(error){res.end(JSON.stringify({jsonrpc:"2.0",id:1,error:{code:-32000,message:error.message}}));}
});
await new Promise(r=>rpcServer.listen(0,"127.0.0.1",r));
env.IRYS_PRIVATE_KEY=Wallet.createRandom().privateKey;
env.IRYS_NODE_URL="https://irys.test";env.IRYS_GATEWAY_URL="https://gateway.test";
env.STORAGE_PAYMENT_RECEIVER=Wallet.createRandom().address;
env.STORAGE_PAYMENT_RPC=`http://127.0.0.1:${rpcServer.address().port}`;
env.STORAGE_SERVICE_FEE_WEI="123";
const originalFetch=globalThis.fetch;
let priceCalls=0,loseApprovalResponse=false,approvalPosts=[];
globalThis.fetch=async(url,options={})=>{
  const u=new URL(url);
  if(u.origin!=="https://irys.test")return originalFetch(url,options);
  if(u.pathname.startsWith("/price/")){priceCalls++;return Response.json(String(Math.ceil(Number(u.pathname.split("/").at(-1))/1000)));}
  if(u.pathname.startsWith("/account/balance"))return Response.json({balance:"1000000000000000000"});
  if(u.pathname==="/tx/ethereum"){
    const item=new DataItem(Buffer.from(options.body));assert.ok(await item.isValid());
    approvalPosts.push({id:item.id,tags:item.tags});
    if(loseApprovalResponse){loseApprovalResponse=false;throw new Error("Simulated lost response after provider accepted approval");}
    return Response.json({id:item.id});
  }
  throw new Error("Unexpected provider endpoint: "+u.pathname);
};
const {default:worker}=await import("../dist/server/index.js");
const ctx={waitUntil(){},passThroughOnException(){}};
let cookie="";
async function post(path,body,origin="https://mintforge.example"){
  return worker.fetch(new Request("https://mintforge.example"+path,{method:"POST",headers:{"Content-Type":"application/json",Origin:origin,Cookie:cookie},body:JSON.stringify(body)}),{ASSETS:{fetch:()=>new Response("",{status:404})}},ctx);
}
suite.after(async()=>{globalThis.fetch=originalFetch;sqlite.close();provider.destroy();await chain.disconnect();await new Promise(r=>rpcServer.close(r));});
await suite.test("storage quote requires wallet authorization and validates all item limits",async()=>{
  let response=await post("/api/storage-quote",{});assert.equal(response.status,400);
  const first=await post("/api/upload-auth",{wallet:wallet.address});const challenge=await first.json();
  const auth=await post("/api/upload-auth",{wallet:wallet.address,nonce:challenge.nonce,signature:await wallet.signMessage(challenge.message)});
  assert.equal(auth.status,200);cookie=auth.headers.get("set-cookie").split(";")[0];
  for(const body of [{count:10001},{sizes:[-1]},{}]){
    response=await post("/api/storage-quote",{job:"a".repeat(64),address:Wallet.createRandom().address,count:1,sizes:[4096],...body});
    if(Object.keys(body).length)assert.equal(response.status,400);else assert.equal(response.status,200);
  }
});
await suite.test("10,000-item quotes include envelopes, reserve, approval and service costs with bounded pricing calls",async()=>{
  priceCalls=0;
  const response=await post("/api/storage-quote",{job:"b".repeat(64),address:Wallet.createRandom().address,count:10000,sizes:Array.from({length:10000},(_,i)=>1000+i)});
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const q=await response.json();
  assert.ok(priceCalls<20);
  assert.equal(BigInt(q.total),BigInt(q.storage)+BigInt(q.reserve)+BigInt(q.approvalCost)+123n);
  assert.equal(BigInt(q.allowance),BigInt(q.storage)+BigInt(q.reserve));
  assert.equal(q.data,q.id);assert.equal(q.paymentChain,"0x1");
});
await suite.test("checkout rejects mismatched payment, consumes the correct receipt and reuses approval bytes after a lost response",async()=>{
  const response=await post("/api/storage-quote",{job:"c".repeat(64),address:Wallet.createRandom().address,count:1,sizes:[4096,4096,4096]});
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const q=await response.json();
  const wrong=await wallet.sendTransaction({to:q.recipient,value:BigInt(q.total),data:"0x"});await wrong.wait();await chain.request({method:"evm_mine",params:[]});
  let result=await post("/api/storage-activate",{id:q.id,payment:wrong.hash});assert.equal(result.status,400);assert.match((await result.json()).error,/does not match/);assert.equal(approvalPosts.length,0);
  const payment=await wallet.sendTransaction({to:q.recipient,value:BigInt(q.total),data:q.data});await payment.wait();await chain.request({method:"evm_mine",params:[]});
  loseApprovalResponse=true;
  result=await post("/api/storage-activate",{id:q.id,payment:payment.hash});assert.equal(result.status,400);
  result=await post("/api/storage-activate",{id:q.id,payment:payment.hash});assert.equal(result.status,200,JSON.stringify(await result.clone().json()));
  assert.equal(approvalPosts.length,2);assert.equal(approvalPosts[0].id,approvalPosts[1].id);
  const tags=Object.fromEntries(approvalPosts[0].tags.map(t=>[t.name,t.value]));assert.equal(tags["x-amount"],q.allowance);assert.equal(tags["x-irys-approve-payment"],q.address);
  result=await post("/api/storage-activate",{id:q.id,payment:payment.hash});assert.equal(result.status,200);assert.equal(approvalPosts.length,2);
  const next=await (await post("/api/storage-quote",{job:"d".repeat(64),address:Wallet.createRandom().address,count:1,sizes:[4096]})).json();
  result=await post("/api/storage-activate",{id:next.id,payment:payment.hash});assert.equal(result.status,400);
});

});
