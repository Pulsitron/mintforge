import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {build} from "esbuild";
import "fake-indexeddb/auto";
import {DataItem} from "@irys/bundles/node";
const temporary=await mkdtemp(new URL("../.scale-test-",import.meta.url).pathname);
await build({stdin:{contents:'export * from "./lib/collection-files"; export * from "./lib/storage-job"; export * from "./lib/irys-data";',resolveDir:new URL("..",import.meta.url).pathname,loader:"ts"},outfile:temporary+"/test.mjs",bundle:true,platform:"node",format:"esm",packages:"external"});
const lib=await import(pathToFileURL(temporary+"/test.mjs").href);
test.after(()=>rm(temporary,{recursive:true,force:true}));
await test("10,000 images and JSON files import with numeric and custom metadata intact",async()=>{
  const images=Array.from({length:10000},(_,i)=>new File([String(i)],`${i+1}.png`,{type:"image/png"}));
  lib.validateArtwork(images);
  const files=images.map((_,i)=>new File([JSON.stringify({name:`Item ${i+1}`,description:"Original description",attributes:[{trait_type:"Level",value:0,display_type:"number"}],custom:{artist:"Creator"}})],`${i+1}.json`,{type:"application/json"}));
  const metadata=await lib.importMetadata(files,images);
  assert.equal(metadata.size,10000);
  assert.equal(metadata.get("10000").attributes[0].value,0);
  assert.deepEqual(metadata.get("1").custom,{artist:"Creator"});
  await assert.rejects(()=>lib.importMetadata([files[0],files[0]],images),/Duplicate/);
  await assert.rejects(()=>lib.importMetadata([new File(['{"bad":'],"1.json")],images),/Invalid JSON/);
  assert.throws(()=>lib.validateArtwork([...images,new File(["x"],"10001.png")]),/10,000/);
});
await test("bounded workers drain active work before reporting failure",async()=>{
  let active=0,max=0;
  await assert.rejects(()=>lib.pool(Array.from({length:10000},(_,i)=>i),3,async i=>{
    active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,1));active--;if(i===12)throw new Error("stop");
  }),/stop/);
  assert.equal(max,3);assert.equal(active,0);
});
await test("large-file chunk recovery skips acknowledged byte ranges and preserves the payer",async()=>{
  const original=globalThis.fetch;const present=new Map();let fail=true;
  const q={endpoint:"https://irys.test",token:"ethereum",payer:"0xpayer"};
  globalThis.fetch=async(url,options)=>{
    const offset=Number(new URL(url).pathname.split("/").at(-1));
    if(!options.method)return Response.json({id:"chunk-test",min:1_000_000,max:20_000_000,size:10_000_000,chunks:[...present]});
    if(offset===-1){assert.equal(options.headers["x-irys-paid-by"],q.payer);return Response.json({id:"expected"});}
    if(offset>=20_000_000 && fail)return new Response("outage",{status:400});
    assert.equal(present.has(String(offset)),false,"never retransmit acknowledged chunks");
    present.set(String(offset),options.body.length);return new Response("ok");
  };
  try{
    const raw=new Uint8Array(50_000_001);
    await assert.rejects(()=>lib.sendIrys(raw,"expected",q,"chunk-resume",new AbortController().signal),/failed/);
    assert.equal(present.size,2);fail=false;
    await lib.sendIrys(raw,"expected",q,"chunk-resume",new AbortController().signal);
    assert.equal([...present.values()].reduce((a,b)=>a+b,0),raw.length);
  }finally{globalThis.fetch=original;}
});
await test("20,000 signed file uploads resume beyond 3,000 images without re-uploading completed batches",{timeout:240000},async()=>{
  const original=globalThis.fetch;
  let posts=0,phase="fail",active=0,maxActive=0;
  const accepted=new Set();let duplicated=0;
  globalThis.fetch=async(_url,options)=>{
    active++;maxActive=Math.max(maxActive,active);
    try {
      if(phase==="fail" && posts>=17) return new Response("simulated outage",{status:400});
      const item=new DataItem(Buffer.from(options.body));
      assert.ok(await item.isValid(),"provider receives valid signed Irys transactions");
      if(accepted.has(item.id))duplicated++;
      accepted.add(item.id);posts++;
      return Response.json({id:item.id});
    } finally {active--;}
  };
  try {
    const media=Array.from({length:10000},(_,i)=>({path:`media/${i+1}`,file:new File([`image-${i}`],`${i+1}.png`,{type:"image/png"})}));
    const render=uris=>media.map((p,i)=>new File([JSON.stringify({name:`NFT ${i+1}`,image:uris[p.path],attributes:[{trait_type:"Index",value:i}]})],`${i+1}.json`,{type:"application/json"}));
    let plan=await lib.prepareStorage(media,render,10000,"0xcreator",()=>{});
    plan.job.quote={id:"quote",endpoint:"https://irys.test",gateway:"https://gateway.test",payer:"0xpayer",token:"ethereum"};plan.job.active=true;
    await lib.checkpoint(plan.id,plan.job);
    await assert.rejects(()=>lib.runStorage(plan,()=>{},new AbortController().signal),/upload failed/);
    assert.ok(posts>=17,"failure occurs after at least 3,400 image acknowledgements");
    phase="resume";
    // Reopen with fresh objects; recovery must come from IndexedDB, not a retained promise.
    plan=await lib.prepareStorage(media,render,10000,"0xcreator",()=>{});
    const base=await lib.runStorage(plan,()=>{},new AbortController().signal);
    assert.match(base,/https:\/\/gateway.test\/[^/]+\/$/);
    assert.equal(posts,101,"50 image bundles, 50 metadata bundles and one root manifest");
    assert.equal(duplicated,0);assert.ok(maxActive<=2);
    const root=await lib.checkpoint(`${plan.id}:root`);
    assert.equal(Object.keys(root.ids).length,10000);
    assert.ok(root.ids["1.json"] && root.ids["10000.json"]);
    const repeat=await lib.runStorage(plan,()=>{},new AbortController().signal);
    assert.equal(repeat,base);assert.equal(posts,101);
    const changed=[...media];changed[0]={...media[0],file:new File(["changed bytes"],"1.png",{type:"image/png"})};
    const revised=await lib.prepareStorage(changed,render,10000,"0xcreator",()=>{});
    assert.notEqual(revised.id,plan.id,"changed contents cannot reuse the old upload job");
  } finally {globalThis.fetch=original;}
});
