import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Wallet, BrowserProvider, ContractFactory, Interface, Transaction, keccak256, hexlify, computeAddress } from "ethers";
import { DataItem } from "@irys/bundles/node";
import ganache from "ganache";
import solc from "solc";
import { env } from "cloudflare:workers";

const mockSource=`pragma solidity ^0.8.20;
contract MockWETH {
 mapping(address=>uint) public balanceOf; mapping(address=>mapping(address=>uint)) public allowance;
 uint8 public constant decimals=18;
 function mint(address a,uint n) external {balanceOf[a]+=n;}
 function approve(address a,uint n) external returns(bool){allowance[msg.sender][a]=n;return true;}
 function transfer(address a,uint n) external returns(bool){require(balanceOf[msg.sender]>=n);balanceOf[msg.sender]-=n;balanceOf[a]+=n;return true;}
 function transferFrom(address f,address t,uint n) external returns(bool){require(allowance[f][msg.sender]>=n&&balanceOf[f]>=n);allowance[f][msg.sender]-=n;balanceOf[f]-=n;balanceOf[t]+=n;return true;}
}
contract MockDex {
 address public immutable WPLS; MockWETH public immutable weth;
 constructor(address w,address e){WPLS=w;weth=MockWETH(e);}
 function getAmountsIn(uint n,address[] memory path) external view returns(uint[] memory a){require(path[0]==WPLS&&path[1]==address(weth));a=new uint[](2);a[0]=n*100;a[1]=n;}
 function swapETHForExactTokens(uint n,address[] memory path,address to,uint deadline) external payable returns(uint[] memory a){require(block.timestamp<=deadline&&path[0]==WPLS&&path[1]==address(weth)&&msg.value>=n*100);weth.mint(to,n);payable(msg.sender).transfer(msg.value-n*100);a=new uint[](2);a[0]=n*100;a[1]=n;}
}
contract MockBridge {
 MockWETH public immutable weth; uint public calls;
 constructor(address w){weth=MockWETH(w);}
 function swap(uint chain,uint n,bytes memory recipient,uint8 kind,address token,bytes32 integrator) external {require((chain==1||chain==8453)&&recipient.length==20&&kind==0&&integrator==bytes32(0)&&token==address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE));require(weth.transferFrom(msg.sender,address(this),n));calls++;}
}`;
const compiled=JSON.parse(solc.compile(JSON.stringify({language:"Solidity",sources:{"Mocks.sol":{content:mockSource}},settings:{evmVersion:"paris",optimizer:{enabled:true,runs:50},outputSelection:{"*":{"*":["abi","evm.bytecode.object"]}}}})));
assert.equal(compiled.errors?.filter(e=>e.severity==="error").length||0,0);
for (const destinationChain of [1,8453]) await test(`Customer-funded PLS settlement to chain ${destinationChain}`,async suite=>{
 const sqlite=new DatabaseSync(":memory:");
 for(const f of ["0000_peaceful_avengers.sql","0001_storage_quotes.sql","0002_pls_settlements.sql"])sqlite.exec(fs.readFileSync("drizzle/"+f,"utf8").replaceAll("--> statement-breakpoint",""));
 function prepared(sql,args=[]){return{bind(...v){return prepared(sql,v)},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return{results:sqlite.prepare(sql).all(...args)}},async run(){return{success:true,meta:sqlite.prepare(sql).run(...args)}}};}
 env.DB={prepare:prepared,async batch(statements){sqlite.exec("BEGIN");try{const result=[];for(const statement of statements)result.push(await statement.run());sqlite.exec("COMMIT");return result;}catch(error){sqlite.exec("ROLLBACK");throw error;}}};
 const pulse=ganache.provider({logging:{quiet:true},chain:{chainId:369},wallet:{totalAccounts:3,defaultBalance:10000}});
 const eth=ganache.provider({logging:{quiet:true},chain:{chainId:destinationChain},wallet:{totalAccounts:3,defaultBalance:10000}});
 const provider=new BrowserProvider(pulse,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const wallet=new Wallet(Object.values(pulse.getInitialAccounts())[0].secretKey,provider);
 const other=new Wallet(Object.values(pulse.getInitialAccounts())[1].secretKey,provider);
 const wrapped=Wallet.createRandom().address;
 async function deploy(name,args=[]){const c=compiled.contracts["Mocks.sol"][name];const f=new ContractFactory(c.abi,"0x"+c.evm.bytecode.object,wallet);const contract=await f.deploy(...args);await contract.waitForDeployment();return contract;}
 const weth=await deploy("MockWETH"),dex=await deploy("MockDex",[wrapped,await weth.getAddress()]),bridge=await deploy("MockBridge",[await weth.getAddress()]);
 Object.assign(env,{PLS_CHECKOUT_ENABLED:"true",IRYS_PRIVATE_KEY:Wallet.createRandom().privateKey,IRYS_NODE_URL:"https://irys.test",IRYS_GATEWAY_URL:"https://gateway.test",IRYS_TOKEN:destinationChain===1?"ethereum":"base-eth",STORAGE_PAYMENT_RPC:"https://eth.test",PLS_RPC_URL:"https://pulse.test",STORAGE_PAYMENT_RECEIVER:Wallet.createRandom().address,STORAGE_SERVICE_FEE_WEI:"10000000000000",PLS_SWAP_ROUTER:await dex.getAddress(),PLS_SWAP_ROUTER_HASH:keccak256(await provider.getCode(await dex.getAddress())),PLS_WRAPPED_NATIVE:wrapped,PLS_BRIDGE_WETH:await weth.getAddress(),LIBERTY_ROUTER:await bridge.getAddress(),LIBERTY_ROUTER_HASH:keccak256(await provider.getCode(await bridge.getAddress()))});
 const deposit=Wallet.createRandom().address,native="0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
 const bridgeAbi=new Interface(["function swap(uint256,uint256,bytes,uint8,address,bytes32)"]),tokenAbi=new Interface(["function approve(address,uint256)","function transfer(address,uint256)"]);
 const l1Oracle=new Interface(["function getL1FeeUpperBound(uint256) view returns(uint256)"]);
 let l1Checks=0;
 const originalFetch=globalThis.fetch;
 let deliverBridge=false,creditIrys=false,loseBroadcast=false,loseNotification=false,loseApproval=false,badRoute=false,expensiveSwap=false;
 const broadcasts=[],notifications=[],approvals=[],credits=new Map(),bridgeDeliveries=new Set();
 globalThis.fetch=async(url,options={})=>{
  const u=new URL(url);
  if(["https://pulse.test","https://eth.test"].includes(u.origin)){
   const body=JSON.parse(options.body),chain=u.origin==="https://pulse.test"?pulse:eth;
   try {
    if(chain===eth&&destinationChain===8453&&body.method==="eth_call"&&body.params[0].to.toLowerCase()==="0x420000000000000000000000000000000000000f"){
     assert.equal(l1Oracle.decodeFunctionData("getL1FeeUpperBound",body.params[0].data)[0],512n);l1Checks++;
     return Response.json({jsonrpc:"2.0",id:body.id,result:l1Oracle.encodeFunctionResult("getL1FeeUpperBound",[1000000000n])});
    }
    if(expensiveSwap&&chain===pulse&&body.method==="eth_call"&&body.params[0].to.toLowerCase()===env.PLS_SWAP_ROUTER.toLowerCase()&&body.params[0].data.startsWith(dex.interface.getFunction("getAmountsIn").selector)){
     const [amount]=dex.interface.decodeFunctionData("getAmountsIn",body.params[0].data);
     return Response.json({jsonrpc:"2.0",id:body.id,result:dex.interface.encodeFunctionResult("getAmountsIn",[[amount*1000n,amount]])});
    }
    const result=await chain.request({method:body.method,params:body.params});
    if(body.method==="eth_sendRawTransaction"){
     const tx=Transaction.from(body.params[0]);broadcasts.push({hash:tx.hash,to:tx.to,chain:chain===pulse?369:destinationChain,value:tx.value,from:tx.from});
     if(loseBroadcast&&tx.to.toLowerCase()===env.PLS_SWAP_ROUTER.toLowerCase()){loseBroadcast=false;throw new Error("Lost response after broadcast");}
    }
    return Response.json({jsonrpc:"2.0",id:body.id,result});
   }catch(e){if(e.message==="Lost response after broadcast")throw e;return Response.json({jsonrpc:"2.0",id:body.id,error:{code:-32000,message:e.message}});}
  }
  if(u.origin==="https://apis.libertyswap.finance"){
   if(u.pathname.endsWith("/app/routers"))return Response.json({data:[{chainId:369,symbol:"WETH",router:env.LIBERTY_ROUTER}]});
   if(u.pathname.endsWith("/swap/quote")){
    const amount=BigInt(u.searchParams.get("amount")),chain=Number(u.searchParams.get("dstChain")),recipient=u.searchParams.get("recipient"),fee=amount/200n;
    const data=bridgeAbi.encodeFunctionData("swap",[chain,amount,badRoute?other.address:recipient,0,native,"0x"+"0".repeat(64)]);
    return Response.json({to:env.LIBERTY_ROUTER,srcToken:{address:env.PLS_BRIDGE_WETH,symbol:"WETH",decimals:18,chainId:369},destToken:{address:"0x"+"0".repeat(40),symbol:"ETH",decimals:18,chainId:chain},srcAmount:String(amount),destAmount:String(amount-fee),fee:{chainId:chain,token:"destination",protocol:{amount:String(fee)},integrator:{amount:"0"},total:{amount:String(fee)}},approval:{token:env.PLS_BRIDGE_WETH,spender:env.LIBERTY_ROUTER,amount:String(amount),calldata:tokenAbi.encodeFunctionData("approve",[env.LIBERTY_ROUTER,amount])},methodParameters:{calldata:data,value:"0x00"},route:{type:"DIRECT"}});
   }
   if(u.pathname.endsWith("/swap/tx/process")){
    const hash=JSON.parse(options.body).txHash;
    const tx=sqlite.prepare("SELECT quote_id FROM storage_settlement_txs WHERE hash=?").get(hash);assert.ok(tx);
    const q=JSON.parse(sqlite.prepare("SELECT quote FROM storage_quotes WHERE id=?").get(tx.quote_id).quote);
    if(deliverBridge&&!bridgeDeliveries.has(hash)){await eth.request({method:"evm_setAccountBalance",params:[q.payer,"0x"+BigInt(q.automation.bridgeOutput).toString(16)]});bridgeDeliveries.add(hash);}
    return Response.json({ok:true});
   }
  }
  if(u.origin==="https://irys.test"){
   if(u.pathname==="/info")return Response.json({addresses:{[env.IRYS_TOKEN]:deposit}});
   if(u.pathname.startsWith("/price/"))return Response.json(String(BigInt(u.pathname.split("/").at(-1))*1000000n));
   if(u.pathname.startsWith("/account/balance/")&&options.method!=="POST")return Response.json({balance:credits.get(u.searchParams.get("address").toLowerCase())||"0"});
   if(u.pathname.startsWith("/account/balance/")&&options.method==="POST"){
    const hash=JSON.parse(options.body).tx_id;notifications.push(hash);
    const receipt=await eth.request({method:"eth_getTransactionReceipt",params:[hash]});assert.equal(receipt.status,"0x1");
    const tx=await eth.request({method:"eth_getTransactionByHash",params:[hash]});assert.equal(tx.to.toLowerCase(),deposit.toLowerCase());
    if(creditIrys)credits.set(tx.from.toLowerCase(),BigInt(tx.value).toString());
    if(loseNotification){loseNotification=false;throw new Error("Lost notification response");}
    return Response.json({ok:true},{status:202});
   }
   if(u.pathname===`/tx/${env.IRYS_TOKEN}`){
    const item=new DataItem(Buffer.from(options.body));assert.ok(await item.isValid());
    const tags=Object.fromEntries(item.tags.map(t=>[t.name,t.value]));
    const q=JSON.parse(sqlite.prepare("SELECT quote FROM storage_quotes WHERE id=?").get(tags["MintForge-Quote"]).quote);
    assert.equal(computeAddress(hexlify(item.rawOwner)).toLowerCase(),q.payer.toLowerCase());assert.equal(tags["x-amount"],q.allowance);
    approvals.push(item.id);
    if(loseApproval){loseApproval=false;throw new Error("Lost approval response");}
    return Response.json({id:item.id});
   }
  }
  throw new Error("Unexpected test request: "+u.origin+u.pathname);
 };
 const {default:worker}=await import("../dist/server/index.js");
 assert.equal(typeof worker.scheduled,"function");
 let cookie="";
 async function post(path,body,origin="https://mintforge.test"){
  return worker.fetch(new Request("https://mintforge.test"+path,{method:"POST",headers:{Origin:origin,Cookie:cookie,"Content-Type":"application/json"},body:JSON.stringify(body)}),{ASSETS:{fetch:()=>new Response("",{status:404})}},{waitUntil(){},passThroughOnException(){}});
 }
 async function login(w){let c=await(await post("/api/upload-auth",{wallet:w.address})).json();const r=await post("/api/upload-auth",{wallet:w.address,nonce:c.nonce,signature:await w.signMessage(c.message)});assert.equal(r.status,200,JSON.stringify(await r.clone().json()));cookie=r.headers.get("set-cookie").split(";")[0];}
 let sequence=0;
 async function quote(){const r=await post("/api/storage-quote",{job:(++sequence).toString(16).padStart(64,"0"),address:Wallet.createRandom().address,count:10000,sizes:[1000000,1000000,1000000]});assert.equal(r.status,200,JSON.stringify(await r.clone().json()));return r.json();}
 async function pay(q){const tx=await wallet.sendTransaction({to:q.recipient,data:q.data,value:BigInt(q.total)});await tx.wait();const r=await post("/api/storage-progress",{id:q.id,payment:tx.hash});assert.equal(r.status,200,JSON.stringify(await r.clone().json()));return tx.hash;}
 const get=id=>sqlite.prepare("SELECT * FROM storage_settlements WHERE quote_id=?").get(id);
 async function tick(id){sqlite.prepare("UPDATE storage_settlements SET next_attempt=0 WHERE quote_id=?").run(id);await Promise.all([worker.scheduled(),worker.scheduled()]);for(let i=0;i<3;i++)await pulse.request({method:"evm_mine",params:[]});for(let i=0;i<(destinationChain===1?3:12);i++)await eth.request({method:"evm_mine",params:[]});return get(id);}
 async function reach(id,stage,max=50){let row;for(let i=0;i<max;i++){row=await tick(id);if(row.stage===stage)return row;}assert.fail(`Expected ${stage}, got ${row.stage}: ${row.error}`);}
 suite.after(async()=>{globalThis.fetch=originalFetch;provider.destroy();await pulse.disconnect();await eth.disconnect();sqlite.close();});
 await login(wallet);
 await suite.test("quotes isolate wallets, include all budgets, and reject altered route payloads before charging",async()=>{
  badRoute=true;let r=await post("/api/storage-quote",{job:"a".repeat(64),address:Wallet.createRandom().address,count:1,sizes:[4096]});assert.equal(r.status,400);assert.match((await r.json()).error,/different route/);badRoute=false;
  const q=await quote(),q2=await quote();assert.notEqual(q.payer,q2.payer);assert.equal(q.symbol,"PLS");assert.equal(q.paymentChain,"0x171");assert.equal(BigInt(q.total),BigInt(q.automation.maxPls)+BigInt(q.automation.sourceGas));
  assert.equal(BigInt(q.automation.bridgeOutput),BigInt(q.automation.depositAmount)+BigInt(q.service)+BigInt(q.automation.destinationGas)+BigInt(q.automation.surplus));
  assert.ok(!JSON.stringify(q).includes(env.IRYS_PRIVATE_KEY));assert.ok(!JSON.stringify(q).includes("pulse.test"));assert.ok(!JSON.stringify(q).includes("eth.test"));assert.equal(broadcasts.length,0);
  r=await post("/api/storage-progress",{id:q.id},"https://evil.test");assert.equal(r.status,400);
  await login(other);r=await post("/api/storage-progress",{id:q.id});assert.equal(r.status,400);await login(wallet);
 });
 await suite.test("lost responses, concurrent workers and delayed bridge/Irys credit never spend twice or unlock early",async()=>{
  const q=await quote();loseBroadcast=true;await pay(q);
  await reach(q.id,"waiting_bridge");assert.equal(Number(await bridge.calls()),1);
  for(let i=0;i<3;i++)await tick(q.id);
  assert.equal(get(q.id).stage,"waiting_bridge");assert.equal(sqlite.prepare("SELECT active FROM storage_quotes WHERE id=?").get(q.id).active,0);
  assert.equal(broadcasts.filter(t=>t.to.toLowerCase()===deposit.toLowerCase()).length,0);
  deliverBridge=true;await reach(q.id,"waiting_credit");
  for(let i=0;i<2;i++)await tick(q.id);
  assert.equal(get(q.id).stage,"waiting_credit");assert.equal(approvals.length,0);
  creditIrys=true;loseNotification=true;loseApproval=true;
  await reach(q.id,"complete");
  assert.equal(new Set(broadcasts.map(t=>t.hash)).size,broadcasts.length,"no repeated broadcast after confirmed receipt");
  assert.equal(broadcasts.filter(t=>t.to.toLowerCase()===deposit.toLowerCase()).length,1);
  assert.equal(new Set(notifications).size,1,"notifications reuse the saved deposit hash");
  assert.equal(approvals.length,2);assert.equal(approvals[0],approvals[1]);
  assert.equal(sqlite.prepare("SELECT active FROM storage_quotes WHERE id=?").get(q.id).active,1);
  const refunds=JSON.parse(get(q.id).data).refunds;assert.ok(refunds.some(r=>r.symbol==="ETH"&&BigInt(r.amount)>=BigInt(q.automation.surplus)));assert.ok(refunds.some(r=>r.symbol==="PLS"));
  if(destinationChain===8453){assert.ok(l1Checks>=3);assert.equal(q.automation.l1Budget,"2000000000");}
  const before=broadcasts.length;await tick(q.id);assert.equal(broadcasts.length,before);
  const r=await post("/api/storage-progress",{id:q.id});assert.equal(r.status,200);const body=await r.json();assert.equal(body.active,true);assert.ok(!JSON.stringify(body).includes('"raw"'));
 });
 await suite.test("an expired paid quote automatically returns available PLS and never swaps",async()=>{
  const q=await quote();q.expires=Date.now()-60000;sqlite.prepare("UPDATE storage_quotes SET quote=?,expires=? WHERE id=?").run(JSON.stringify(q),q.expires,q.id);
  await pay(q);await reach(q.id,"refunded");assert.equal(sqlite.prepare("SELECT count(*) n FROM storage_settlement_txs WHERE quote_id=? AND step='swap'").get(q.id).n,0);
  assert.equal(JSON.parse(get(q.id).data).refunds[0].symbol,"PLS");
 });
 await suite.test("price movement above the approved PLS ceiling refunds before conversion",async()=>{
  const q=await quote();await pay(q);expensiveSwap=true;await reach(q.id,"refunded");expensiveSwap=false;
  assert.equal(sqlite.prepare("SELECT count(*) n FROM storage_settlement_txs WHERE quote_id=? AND step='swap'").get(q.id).n,0);
 });
 await suite.test("disabling new checkout preserves already-paid background jobs",async()=>{
  const q=await quote();await pay(q);env.PLS_CHECKOUT_ENABLED="false";await reach(q.id,"complete");
  assert.equal(sqlite.prepare("SELECT active FROM storage_quotes WHERE id=?").get(q.id).active,1);
 });
});
