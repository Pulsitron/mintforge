import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { indexedDB } from "fake-indexeddb";
import React from "react";
import { create, act } from "react-test-renderer";
import { formatEther, parseEther } from "ethers";

const wallet="0x"+"11".repeat(20),hash="0x"+"aa".repeat(32);
function quote(){return {id:"0x"+"33".repeat(32),expires:Date.now()+600000,paymentChain:"0x171",symbol:"PLS",total:"1000000000000000000123",recipient:"0x"+"22".repeat(20),data:"0x1234",storage:"1000",reserve:"100",approvalCost:"100",service:"500",automation:{destinationChain:1,bridgeFee:"50000000000000",destinationGas:"1000000000000",surplus:"9948999999998300",expectedPls:"990000000000000000000",maxPls:"999900000000000000000",sourceGas:"100000000000000123",slippageBps:100}};}
const status=(q,stage="waiting_bridge",active=false)=>({id:q.id,stage,active,message:stage==="complete"?"Storage is ready.":"Waiting for ETH.",transactions:[{step:"payment",chain:369,hash}],refunds:[]});

await test("PLS checkout prevents repeated sends across clicks, tabs and reloads and resumes after a lost registration response",async t=>{
  const temporary=await mkdtemp(new URL("../.pls-ui-",import.meta.url).pathname),file=temporary+"/storage.mjs";
  await build({entryPoints:["lib/storage-job.ts"],outfile:file,bundle:true,platform:"node",format:"esm",packages:"external",plugins:[{name:"wallet",setup(b){
    b.onResolve({filter:/^\.\/web3$/},()=>({path:"wallet",namespace:"test"}));
    b.onLoad({filter:/.*/,namespace:"test"},()=>({contents:"export const signer=async()=>globalThis.mintforgePlsWallet;",loader:"js"}));
  }}]});
  const browser=await import(pathToFileURL(file).href),otherTab=await import(pathToFileURL(file).href+"?other-tab");
  const originalFetch=globalThis.fetch,originalTimer=globalThis.setTimeout,originalDb=globalThis.indexedDB,originalWindow=globalThis.window;
  const nav=Object.getOwnPropertyDescriptor(globalThis,"navigator");
  const held=new Set();
  Object.defineProperty(globalThis,"navigator",{configurable:true,value:{locks:{async request(name,options,fn){assert.equal(options.ifAvailable,true);if(held.has(name))return fn(null);held.add(name);try{return await fn({name});}finally{held.delete(name);}}}}});
  globalThis.indexedDB=indexedDB;
  globalThis.setTimeout=(fn,delay,...args)=>originalTimer(fn,delay===6000?0:delay,...args);
  const q=quote(),plan={id:"client-payment",job:{key:"browser-upload-key",address:wallet,quote:q}};
  const stale=structuredClone(plan);
  await browser.checkpoint(plan.id,plan.job);
  let sends=0,calls=0,complete=false,releaseWallet,enteredWallet;
  const entered=new Promise(resolve=>{enteredWallet=resolve;});
  const release=new Promise(resolve=>{releaseWallet=resolve;});
  globalThis.mintforgePlsWallet={sendTransaction:async tx=>{sends++;assert.equal(tx.to,q.recipient);assert.equal(tx.value,BigInt(q.total));enteredWallet();await release;return {hash};}};
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,"/api/storage-progress");assert.equal(JSON.parse(init.body).payment,hash);
    assert.equal((await browser.checkpoint(plan.id)).payment,hash,"save before server registration");
    if(++calls===1)throw new Error("Network lost after customer payment");
    return Response.json(status(q,complete?"complete":"waiting_bridge",complete));
  };
  t.after(async()=>{globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimer;globalThis.indexedDB=originalDb;if(nav)Object.defineProperty(globalThis,"navigator",nav);else delete globalThis.navigator;if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;delete globalThis.mintforgePlsWallet;await rm(temporary,{recursive:true,force:true});});
  const controller=new AbortController(),messages=[];
  const first=browser.payStorage(plan,wallet,s=>messages.push(s),()=>controller.abort(),controller.signal);
  assert.equal(browser.payStorage(plan,wallet,()=>{}),first);
  const rejected=assert.rejects(first);
  await entered;
  await assert.rejects(otherTab.payStorage(stale,wallet,()=>{}),/another tab/);
  assert.equal(sends,1);releaseWallet();await rejected;
  assert.equal(plan.job.payment,hash);assert.ok(!plan.job.active);assert.ok(calls>=2);
  assert.ok(messages.some(m=>m.includes("Keep this page open")));
  complete=true;
  await otherTab.payStorage(stale,wallet,()=>{});
  assert.equal(sends,1);assert.equal(stale.job.payment,hash);assert.equal(stale.job.active,true);
  assert.equal((await browser.checkpoint(plan.id)).active,true);
  await assert.rejects(browser.resetStorageQuote(stale),/Keep the existing payment/);

  const refunded={id:"client-refunded",job:{...plan.job,active:false}};
  await browser.checkpoint(refunded.id,refunded.job);
  globalThis.fetch=async()=>Response.json(status(q,"refunded",false));
  await browser.resetStorageQuote(refunded);
  assert.equal((await browser.checkpoint(refunded.id)).payment,undefined);
  assert.equal((await browser.checkpoint(`payment-history:${q.id}`)).payment,hash);
  assert.equal(sends,1);
  delete globalThis.navigator.locks;globalThis.window={};
  await assert.rejects(browser.payStorage({id:"unsupported",job:{quote:q}},wallet,()=>{}),/cannot safely coordinate/);
  assert.equal(sends,1);
});

await test("PLS quote shows complete budgets, refund currency and hash recovery without requesting another transfer",async t=>{
  const temporary=await mkdtemp(new URL("../.pls-panel-",import.meta.url).pathname),file=temporary+"/panel.mjs";
  await build({entryPoints:["app/StorageQuotePanel.tsx"],outfile:file,bundle:true,platform:"node",format:"esm",packages:"external",jsx:"automatic",plugins:[{name:"recovery",setup(b){
    b.onResolve({filter:/\/lib\/(storage-job|uploads)$/},a=>({path:a.path,namespace:"test"}));
    b.onLoad({filter:/.*/,namespace:"test"},()=>({contents:"export const authorizeUploads=async()=>{};export const inspectStoragePayment=async()=>globalThis.mintforgePanelStatus;export const recoverStoragePayment=async(p,h)=>{globalThis.mintforgePanelRecoveries.push(h);return globalThis.mintforgePanelStatus;};",loader:"js"}));
  }}]});
  const Panel=(await import(pathToFileURL(file).href)).default,q=quote();let renderer,recovered;
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.mintforgePanelRecoveries=[];globalThis.mintforgePanelStatus=status(q,"waiting_bridge");
  t.after(async()=>{if(renderer)await act(async()=>renderer.unmount());delete globalThis.IS_REACT_ACT_ENVIRONMENT;delete globalThis.mintforgePanelRecoveries;delete globalThis.mintforgePanelStatus;await rm(temporary,{recursive:true,force:true});});
  const props={quote:q,plan:{job:{quote:q,payment:hash}},settlement:status(q),busy:false,wallet,storageGas:"0.00001",mintGas:"2",native:"PLS",refresh:()=>assert.fail("paid quote cannot refresh"),onSettlement:s=>{recovered=s;}};
  await act(async()=>{renderer=create(React.createElement(Panel,props));});
  const textOf=node=>typeof node==="string"?node:Array.isArray(node)?node.map(textOf).join(""):node?.children?.map(textOf).join("")||"";
  const text=textOf(renderer.toJSON());
  assert.match(text,/Pay in PLS/);assert.match(text,/LibertySwap fee/);assert.match(text,/PulseChain execution and refund gas budget/);
  assert.match(text,/Excess ETH returns to your wallet on Ethereum/);assert.match(text,/unused upload credit is not automatically refunded/);
  assert.ok(text.includes(formatEther(BigInt(q.total)+parseEther("0.00001"))));
  assert.ok(!text.includes("Refresh unpaid quote"));
  assert.equal(renderer.root.findAllByType("a")[0].props.href,"https://scan.pulsechain.com/tx/"+hash);
  const input=renderer.root.findByType("input");await act(async()=>input.props.onChange({target:{value:hash}}));
  const button=renderer.root.findAllByType("button").find(b=>textOf(b)==="Recover payment");
  await act(async()=>{await Promise.all([button.props.onClick(),button.props.onClick()]);});
  assert.deepEqual(globalThis.mintforgePanelRecoveries,[hash]);assert.equal(recovered.id,q.id);
});
