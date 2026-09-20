import { signer } from "./web3";
import { pool } from "./collection-files";
import { batchBound, groupFiles, type StorageQuote } from "./storage-types";
import { manifest, signedBundle, signedData, uploadIdentity, IRYS_TAGS, type UploadPart } from "./irys-data";
import type { SettlementProgress } from "./pls-types";

type Job = {key: string; address: string; quote?: StorageQuote; payment?: string; active?: boolean; base?: string};
type Batch = {id: string; ids: Record<string,string>; chunk?: string};
export type StoragePlan = {
  id: string; job: Job; media: UploadPart[][]; metadataGroups: number[][]; bounds: number[];
  render: (uris: Record<string,string>) => File[]; count: number; metaNames: string[];
};
function db() {
  return new Promise<IDBDatabase>((resolve,reject) => {
    const request = indexedDB.open("mintforge-uploads-v2", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("jobs");
    request.onerror = () => reject(new Error("Enable browser storage to save upload progress before paying."));
    request.onsuccess = () => resolve(request.result);
  });
}
export async function checkpoint<T>(key: string, value?: T): Promise<T | undefined> {
  const database = await db();
  try {
    return await new Promise<T | undefined>((resolve,reject) => {
      const tx = database.transaction("jobs", value === undefined ? "readonly" : "readwrite");
      const store = tx.objectStore("jobs");
      const request = value === undefined ? store.get(key) : store.put(value,key);
      let result: T | undefined;
      request.onsuccess = () => { if (value === undefined) result = request.result; };
      tx.oncomplete = () => resolve(value ?? result);
      tx.onerror = tx.onabort = () => reject(new Error("Could not save upload progress. Free browser storage before continuing."));
    });
  } finally { database.close(); }
}
const digest = async (value: ArrayBuffer | string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", typeof value === "string" ? new TextEncoder().encode(value) : value)),b=>b.toString(16).padStart(2,"0")).join("");
export async function prepareStorage(media: UploadPart[], render: StoragePlan["render"], count: number, wallet: string, progress: (s:string)=>void): Promise<StoragePlan> {
  if (media.some(part=>part.file.size < 1 || part.file.size > 90*1024*1024)) throw new Error("Artwork, banners and placeholders must be between 1 byte and 90 MiB.");
  let checked = 0;
  const hashes = await pool(media, 2, async part => {
    const hash = await digest(await part.file.arrayBuffer());
    if (++checked % 50 === 0 || checked === media.length) progress(`Checking file contents: ${checked.toLocaleString()} / ${media.length.toLocaleString()}…`);
    return `${part.path}:${hash}`;
  });
  // 512-byte placeholder URLs cover configured gateways and variable-length Irys IDs.
  const templates = render(Object.fromEntries(media.map(part=>[part.path,"https://storage.invalid/" + "x".repeat(488)])));
  const metadataHashes = await pool(templates, 4, async file => `${file.name}:${await digest(await file.arrayBuffer())}`);
  const id = await digest([wallet.toLowerCase(),...hashes,...metadataHashes].join("\n"));
  let job = await checkpoint<Job>(id);
  if (!job) { job = uploadIdentity(); await checkpoint(id,job); }
  const mediaGroups = groupFiles(media.map(part=>({...part,size:part.file.size})));
  const metadataGroups = groupFiles(templates.map((file,index)=>({size:file.size,index}))).map(group=>group.map(v=>v.index));
  const fakeManifest = JSON.stringify(manifest(Object.fromEntries(templates.map(file=>[file.name,"x".repeat(48)]))));
  const bounds = [
    ...mediaGroups.map(group=>batchBound(group.reduce((n,p)=>n+p.file.size,0),group.length)),
    ...metadataGroups.map(group=>batchBound(group.reduce((n,i)=>n+templates[i].size,0),group.length)),
    new TextEncoder().encode(fakeManifest).length + 4096,
  ];
  return {id,job,media:mediaGroups,metadataGroups,bounds,render,count,metaNames:templates.map(f=>f.name)};
}
async function api<T>(path: string, body: unknown) {
  const response = await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data = await response.json() as {error?: string};
  if (!response.ok) throw new Error(data.error || "Storage request failed.");
  return data as T;
}
export async function quoteStorage(plan: StoragePlan) {
  if (plan.job.quote && (plan.job.quote.automation || plan.job.payment || plan.job.quote.expires > Date.now() + 60000)) return plan.job.quote;
  plan.job.quote = await api<StorageQuote>("/api/storage-quote",{job:plan.id,address:plan.job.address,sizes:plan.bounds,count:plan.count});
  await checkpoint(plan.id,plan.job);
  return plan.job.quote;
}
const paymentsInFlight = new Map<string, Promise<void>>();
async function paymentLock<T>(plan: StoragePlan, run:()=>Promise<T>):Promise<T> {
  if(typeof navigator!=="undefined"&&navigator.locks)return await navigator.locks.request(`mintforge-payment:${plan.id}`,{ifAvailable:true},lock=>{
    if(!lock)throw new Error("This collection is already processing in another tab. Continue there without paying again.");
    return run();
  });
  if(plan.job.quote?.automation&&typeof window!=="undefined")return Promise.reject(new Error("This browser cannot safely coordinate collection payments. Use a current browser over HTTPS."));
  return run();
}
export async function resetStorageQuote(plan: StoragePlan) {
  if(paymentsInFlight.has(plan.id))throw new Error("This payment is still processing.");
  await paymentLock(plan,async()=>{
    const saved=await checkpoint<Job>(plan.id);
    if(saved?.quote&&saved.quote.id!==plan.job.quote?.id)throw new Error("The quote changed in another tab. Reload this collection before continuing.");
    if(saved?.payment)Object.assign(plan.job,saved);
    if(plan.job.quote?.automation){
      const status=await api<SettlementProgress>("/api/storage-progress",{id:plan.job.quote.id,...(plan.job.payment?{payment:plan.job.payment}:{})});
      const hasPayment=!!plan.job.payment||status.transactions.some(t=>t.step==="payment");
      if(status.active||(hasPayment&&status.stage!=="refunded"))throw new Error("Keep the existing payment job until processing or recovery finishes. Do not pay again.");
      if(hasPayment)await checkpoint(`payment-history:${plan.job.quote.id}`,{quote:plan.job.quote,payment:plan.job.payment,settlement:status});
    }else if(plan.job.payment)throw new Error("This collection already has a storage payment.");
    delete plan.job.quote;delete plan.job.payment;delete plan.job.active;
    await checkpoint(plan.id,plan.job);
  });
}
export function payStorage(plan: StoragePlan, wallet: string, progress: (s:string)=>void, onSettlement?: (s: SettlementProgress) => void, signal?: AbortSignal) {
  const existing = paymentsInFlight.get(plan.id);
  if (existing) return existing;
  const run=async()=>{
    // Another tab may have paid since this tab restored its IndexedDB draft.
    const saved=await checkpoint<Job>(plan.id);
    if(saved?.quote&&saved.quote.id!==plan.job.quote?.id)throw new Error("The quote changed in another tab. Reload this collection before continuing.");
    if(saved?.payment&&saved.quote?.id===plan.job.quote?.id)Object.assign(plan.job,saved);
    return payStorageOnce(plan,wallet,progress,onSettlement,signal);
  };
  const payment = paymentLock(plan,run).finally(()=>paymentsInFlight.delete(plan.id));
  paymentsInFlight.set(plan.id,payment);
  return payment;
}
export async function inspectStoragePayment(plan: StoragePlan) {
  if (!plan.job.quote || !plan.job.payment) throw new Error("No saved payment is available.");
  return api<SettlementProgress>("/api/storage-progress",{id:plan.job.quote.id,payment:plan.job.payment});
}
export async function recoverStoragePayment(plan: StoragePlan, payment: string) {
  if (!plan.job.quote?.automation || !/^0x[a-fA-F0-9]{64}$/.test(payment)) throw new Error("Enter the PLS payment hash from your wallet activity.");
  const status = await api<SettlementProgress>("/api/storage-progress",{id:plan.job.quote.id,payment});
  plan.job.payment = payment; plan.job.active = status.active;
  await checkpoint(plan.id,plan.job);
  return status;
}
async function payStorageOnce(plan: StoragePlan, wallet: string, progress: (s:string)=>void, onSettlement?: (s: SettlementProgress) => void, signal?: AbortSignal) {
  const q = plan.job.quote;
  if (!q) throw new Error("Review the storage quote first.");
  if (plan.job.active) return;
  if (q.automation) {
    if (!plan.job.payment) {
      if (q.expires < Date.now() + 60000) throw new Error("Quote expires too soon. Request a new quote before paying.");
      progress("Review the complete PLS payment in your wallet. Conversion and storage funding follow automatically.");
      const s = await signer(q.paymentChain,wallet);
      const tx = await s.sendTransaction({to:q.recipient,value:BigInt(q.total),data:q.data});
      plan.job.payment = tx.hash;
      await checkpoint(plan.id,plan.job);
    }
    const until = Date.now() + 5 * 60000;
    let registered=false;
    do {
      signal?.throwIfAborted();
      let status: SettlementProgress|undefined;
      try {status=await inspectStoragePayment(plan);registered=true;}
      catch {
        progress(registered?"Payment progress is temporarily unavailable. The saved job continues processing.":"Saving your payment with MintForge. Keep this page open; your transaction hash is saved in this browser.");
      }
      if(status){
        onSettlement?.(status);
        progress(status.error || status.message);
        if (status.active) {
          plan.job.active = true;
          await checkpoint(plan.id,plan.job);
          return;
        }
        if (["refunded","needs_attention"].includes(status.stage)) throw new Error(status.message);
      }
      await new Promise<void>((resolve,reject)=>{
        const stop = () => { clearTimeout(timer); reject(new Error(registered?"Payment monitoring paused. Processing continues automatically; resume with the same files.":"Your payment hash is saved in this browser but MintForge has not acknowledged it yet. Resume with the same files to register this payment; do not pay again.")); };
        const timer = setTimeout(()=>{signal?.removeEventListener("abort",stop);resolve();},6000);
        signal?.addEventListener("abort",stop,{once:true});
      });
    } while (Date.now() < until);
    throw new Error(registered?"Your payment is saved and processing continues automatically. Continue with the same files later to upload without paying again.":"Your payment hash is saved in this browser but MintForge has not acknowledged it yet. Resume with the same files or recover the payment hash; do not pay again.");
  }
  if (!plan.job.payment) {
    if (q.expires < Date.now() + 60000) throw new Error("Quote expires too soon. Request a new quote before paying.");
    progress("Review the quoted storage payment in your wallet.");
    const s = await signer(q.paymentChain,wallet);
    const tx = await s.sendTransaction({to:q.recipient,value:BigInt(q.total),data:q.data});
    plan.job.payment = tx.hash;
    await checkpoint(plan.id,plan.job);
    progress("Storage payment submitted. Waiting for two confirmations…");
    try { await tx.wait(2); }
    catch (error) {
      const replacement = error as {code?:string;cancelled?:boolean;replacement?:{hash:string};receipt?:{status:number}};
      if (replacement.code === "TRANSACTION_REPLACED" && !replacement.cancelled && replacement.replacement && replacement.receipt?.status === 1) {
        plan.job.payment = replacement.replacement.hash;
        await checkpoint(plan.id,plan.job);
      } else {
        if (replacement.cancelled || replacement.receipt?.status === 0) {
          delete plan.job.payment;
          await checkpoint(plan.id,plan.job);
        }
        throw error;
      }
    }
  }
  progress("Activating the saved storage payment…");
  await api("/api/storage-activate",{id:q.id,payment:plan.job.payment});
  plan.job.active = true;
  await checkpoint(plan.id,plan.job);
}
async function retryFetch(url: string, init: RequestInit, signal: AbortSignal) {
  for (let attempt=0; ; attempt++) {
    signal.throwIfAborted();
    let response: Response;
    try { response = await fetch(url,{...init,signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])}); }
    catch (e) {
      if (signal.aborted || attempt >= 4) throw e;
      await new Promise(r=>setTimeout(r,Math.min(15000,500*2**attempt))); continue;
    }
    if (response.ok && response.status !== 201) return response;
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      const value = response.headers.get("retry-after");
      const seconds = Number(value);
      const wait = value && !Number.isFinite(seconds) ? Date.parse(value)-Date.now() : seconds*1000;
      await new Promise(r=>setTimeout(r,Math.min(30000,Math.max(500*2**attempt,wait || 0)))); continue;
    }
    throw Object.assign(new Error(response.status === 402 ? "Irys upload budget is insufficient or approval is not ready. Progress is saved; no further payment is automatic." : `Irys upload failed (${response.status}). Progress is saved; retry to resume.`),{status:response.status});
  }
}
export async function sendIrys(raw: Uint8Array, expected: string, q: StorageQuote, key: string, signal: AbortSignal) {
  const saved = await checkpoint<Batch>(key);
  if (saved?.id === expected) return;
  const headers = {"Content-Type":"application/octet-stream","x-irys-paid-by":q.payer};
  let response: Response;
  if (raw.length < 50_000_000) {
    response = await retryFetch(`${q.endpoint}/tx/${q.token}`,{method:"POST",headers,body:raw as BodyInit},signal);
  } else {
    const chunkHeaders = {...headers,"x-chunking-version":"2"};
    let chunk = saved?.chunk;
    let infoResponse: Response;
    try { infoResponse = await retryFetch(`${q.endpoint}/chunks/${q.token}/${chunk || "-1"}/-1`,{headers:chunkHeaders},signal); }
    catch (error) {
      if (!chunk || (error as {status?:number}).status !== 404) throw error;
      chunk = undefined;
      infoResponse = await retryFetch(`${q.endpoint}/chunks/${q.token}/-1/-1`,{headers:chunkHeaders},signal);
    }
    const info = await infoResponse.json() as {id:string;min:number;max:number;size?:number;chunks?:[string,number][]};
    chunk = chunk || info.id;
    if (!/^[A-Za-z0-9_-]+$/.test(chunk)) throw new Error("Invalid chunk session.");
    await checkpoint(key,{chunk,id:"",ids:{}});
    const size = info.size || Math.max(Number(info.min),Math.min(10_000_000,Number(info.max)));
    if (!Number.isSafeInteger(Number(size)) || Number(size) < 1 || Number(size) > 50_000_000) throw new Error("Invalid Irys chunk size.");
    const present = new Map(info.chunks || []);
    for (let offset=0;offset<raw.length;offset+=Number(size)) {
      const end = Math.min(offset+Number(size),raw.length);
      if (Number(present.get(String(offset))) === end-offset) continue;
      await retryFetch(`${q.endpoint}/chunks/${q.token}/${chunk}/${offset}`,{method:"POST",headers:chunkHeaders,body:raw.subarray(offset,end) as BodyInit},signal);
    }
    response = await retryFetch(`${q.endpoint}/chunks/${q.token}/${chunk}/-1`,{method:"POST",headers:chunkHeaders},signal);
  }
  const receipt = await response.json() as {id?:string};
  if (receipt.id !== expected) throw new Error("Irys receipt does not match the signed upload.");
}
export async function runStorage(plan: StoragePlan, progress: (s:string)=>void, signal: AbortSignal) {
  const savedQuote = plan.job.quote;
  if (!savedQuote || !plan.job.active) throw new Error("Storage payment has not been activated.");
  const q: StorageQuote = savedQuote;
  if (plan.job.base) return plan.job.base;
  let completed = 0;
  const total = plan.media.reduce((n,g)=>n+g.length,0) + plan.metaNames.length;
  async function batch(parts: UploadPart[], index: number) {
    signal.throwIfAborted(); const key = `${plan.id}:batch:${index}`;
    const saved = await checkpoint<Batch>(key);
    if (saved?.id && Object.keys(saved.ids).length === parts.length) {
      completed += parts.length; progress(`Restored ${completed.toLocaleString()} / ${total.toLocaleString()} files from saved progress.`); return saved.ids;
    }
    const signed = await signedBundle(parts,plan.job.key);
    if (signed.raw.length > plan.bounds[index]) throw new Error("Upload exceeds the reviewed quote. Recalculate before uploading.");
    await sendIrys(signed.raw,signed.id,q,key,signal);
    await checkpoint(key,{id:signed.id,ids:signed.ids});
    completed += parts.length;
    progress(`Saved ${completed.toLocaleString()} / ${total.toLocaleString()} files to Irys. You can pause and resume.`);
    return signed.ids;
  }
  // Large individual media run alone. Smaller batches have two concurrent requests.
  const concurrency = plan.media.some(g=>g.reduce((n,p)=>n+p.file.size,0)>16*1024*1024) ? 1 : 2;
  const mediaResults = await pool(plan.media,concurrency,batch);
  const mediaIds = Object.assign({},...mediaResults) as Record<string,string>;
  const files = plan.render(Object.fromEntries(Object.entries(mediaIds).map(([p,id])=>[p,`${q.gateway}/${id}`])));
  const metadataResults = await pool(plan.metadataGroups,2,(indices,n)=>batch(indices.map(i=>({path:files[i].name,file:files[i]})),plan.media.length+n));
  const paths = Object.assign({},...metadataResults) as Record<string,string>;
  const root = await signedData(JSON.stringify(manifest(Object.fromEntries(Object.entries(paths).sort(([a],[b])=>a.localeCompare(b))))),plan.job.key,[...IRYS_TAGS,{name:"Type",value:"manifest"},{name:"Content-Type",value:"application/x.irys-manifest+json"}]);
  const rootRaw = new Uint8Array(root.getRaw());
  if (rootRaw.length > plan.bounds.at(-1)!) throw new Error("Manifest exceeds its quoted size.");
  progress("Saving the collection manifest…");
  await sendIrys(rootRaw,root.id,q,`${plan.id}:root`,signal);
  await checkpoint(`${plan.id}:root`,{id:root.id,ids:paths});
  plan.job.base = `${q.gateway}/${root.id}/`;
  await checkpoint(plan.id,plan.job);
  return plan.job.base;
}
