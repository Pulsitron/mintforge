"use client";
import { useEffect, useRef, useState } from "react";
import { formatEther, parseEther } from "ethers";
import type { StorageQuote } from "../lib/storage-types";
import type { SettlementProgress } from "../lib/pls-types";
import { inspectStoragePayment, recoverStoragePayment, type StoragePlan } from "../lib/storage-job";
import { authorizeUploads } from "../lib/uploads";
const eth = (n: string) => `${formatEther(n)} ETH`;
export default function StorageQuotePanel({quote:q,plan,settlement,busy,wallet,storageGas,mintGas,native,refresh,onSettlement}: {
  quote:StorageQuote; plan:StoragePlan|null; settlement:SettlementProgress|null; busy:boolean; wallet:string;
  storageGas:string; mintGas:string; native:string; refresh:()=>void; onSettlement:(s:SettlementProgress)=>void;
}) {
  const [hash,setHash]=useState(""),[error,setError]=useState(""),[recovering,setRecovering]=useState(false);
  const lock=useRef(false),a=q.automation;
  useEffect(()=>{
    if (!a || !plan?.job.payment || busy || ["complete","refunded","needs_attention"].includes(settlement?.stage || "")) return;
    let active=true;
    let timer: ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try{const s=await inspectStoragePayment(plan);if(active){setError("");onSettlement(s);}}
      catch(e){if(active)setError(e instanceof Error?e.message:"Unable to check payment progress.");}
      if(active)timer=setTimeout(poll,6000);
    };
    timer=setTimeout(poll,6000);
    return()=>{active=false;clearTimeout(timer);};
  },[a,plan,busy,settlement,onSettlement]);
  async function recover() {
    if(!plan||lock.current)return;
    lock.current=true;setRecovering(true);setError("");
    try {await authorizeUploads(q.paymentChain,wallet);onSettlement(await recoverStoragePayment(plan,hash.trim()));}
    catch(e){setError(e instanceof Error?e.message:"Could not verify this payment.");}
    finally{lock.current=false;setRecovering(false);}
  }
  return <section className="settings-card" aria-label="Collection quote">
    <h4>Collection quote · {a?"Pay in PLS":"Irys"}</h4>
    <dl className="mf-details">
      <div><dt>Artwork, metadata and manifest storage budget</dt><dd>{eth(q.storage)}</dd></div>
      <div><dt>Upload price and retry reserve (10%)</dt><dd>{eth(q.reserve)}</dd></div>
      <div><dt>Upload approval</dt><dd>{eth(q.approvalCost)}</dd></div>
      <div><dt>MintForge service fee</dt><dd>{eth(q.service)}</dd></div>
      {a&&<>
        <div><dt>LibertySwap fee</dt><dd>{eth(a.bridgeFee)}</dd></div>
        <div><dt>ETH funding, service and refund gas budget</dt><dd>{eth(a.destinationGas)}</dd></div>
        <div><dt>Estimated ETH surplus returned to your wallet</dt><dd>{eth(a.surplus)}</dd></div>
        <div><dt>PLS conversion, including PulseX trading fee</dt><dd>{formatEther(a.expectedPls)} PLS</dd></div>
        <div><dt>Maximum price movement allowance ({a.slippageBps/100}%)</dt><dd>{formatEther(BigInt(a.maxPls)-BigInt(a.expectedPls))} PLS</dd></div>
        <div><dt>PulseChain execution and refund gas budget</dt><dd>{formatEther(a.sourceGas)} PLS</dd></div>
      </>}
      <div><dt>Storage payment total</dt><dd><strong>{formatEther(q.total)} {q.symbol}</strong></dd></div>
      <div><dt>Your payment transaction gas estimate</dt><dd>{storageGas||"—"} {q.symbol}</dd></div>
      {storageGas&&<div><dt>Estimated total including payment gas</dt><dd>{formatEther(BigInt(q.total)+parseEther(storageGas))} {q.symbol}</dd></div>}
      <div><dt>Collection deployment gas estimate · separate payment</dt><dd>{mintGas||"—"} {native}</dd></div>
    </dl>
    {a?<p className="field-hint">Pay on PulseChain. Conversion, LibertySwap bridging and Irys funding run automatically before uploading. The bridge minimum may exceed the storage cost. Excess ETH returns to your wallet on {a.destinationChain===1?"Ethereum":"Base"}; unused PLS returns on PulseChain, less transfer costs. Balances smaller than their transfer cost remain with this job. If processing fails before bridging, refunds may include WETH on PulseChain. You can follow every saved transaction below.</p>:<p className="field-hint">Storage checkout uses {q.paymentChain==="0x1"?"Ethereum":"Base"}.</p>}
    {a&&<p className="field-hint">LibertySwap's ETH output is an estimate. Uploads wait for confirmed ETH and Irys credit. Provider delays or insufficient proceeds pause processing without requesting another payment.</p>}
    <p className="field-hint">Quote expires {new Date(q.expires).toLocaleTimeString()}. The Irys upload allowance lasts 30 days; unused upload credit is not automatically refunded. Network gas is estimated and confirmed by your wallet. Optional staking and reward funding are separate payments. Files receive Irys URLs.</p>
    {a&&<p className="field-hint">Payment job: <code style={{overflowWrap:"anywhere"}}>{q.id}</code>. Keep this ID and your payment hash.</p>}
    {settlement&&settlement.id===q.id&&<div aria-live="polite">
      <p>{settlement.message}</p>{settlement.error&&<p className="mf-warning">{settlement.error}</p>}
      <ul>{settlement.transactions.map(t=><li key={t.step}>{t.step.replaceAll("_"," ")}: <a target="_blank" rel="noreferrer" href={`${t.chain===369?"https://scan.pulsechain.com":t.chain===1?"https://etherscan.io":"https://basescan.org"}/tx/${t.hash}`}>{t.hash.slice(0,12)}…</a></li>)}</ul>
      {settlement.refunds.map(r=><p key={`${r.chain}:${r.symbol}`}>Returned {formatEther(r.amount)} {r.symbol} on {r.chain===369?"PulseChain":r.chain===1?"Ethereum":"Base"}.</p>)}
    </div>}
    {plan?.job.payment&&<p className="field-hint" style={{overflowWrap:"anywhere"}}>Saved payment: {plan.job.payment}</p>}
    {a&&<details><summary>Recover a payment from wallet activity</summary><p>Use the same job and payment hash. This checks an existing payment and does not request another transfer.</p>
      <label>PLS payment hash<input value={hash} onChange={e=>setHash(e.target.value)} disabled={busy||recovering} placeholder="0x…" /></label>
      <button type="button" disabled={busy||recovering||!hash.trim()} onClick={recover}>Recover payment</button>
    </details>}
    {error&&<p className="mf-warning">{error}</p>}
    {!busy&&!plan?.job.payment&&<button type="button" className="secondary-action" onClick={refresh}>Refresh unpaid quote</button>}
    {!busy&&settlement?.id===q.id&&settlement.stage==="refunded"&&<button type="button" className="secondary-action" onClick={refresh}>Start new quote after refund</button>}
  </section>;
}
