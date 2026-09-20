"use client";
import { useEffect, useRef, useState } from "react";
import { formatEther } from "ethers";
import { authorizeUploads } from "../lib/uploads";
import { errorText, signer } from "../lib/web3";
import type { FundingPlan, PlsRouteCheck, TreasuryStatus } from "../lib/treasury-types";
import TransactionNotice from "./TransactionNotice";

type Configuration = { uploads: boolean; storageChain: string | null; plsCheckout?: boolean; automationAvailable?: boolean };
const eth = (value?: string) => value === undefined ? "Not verified" : `${formatEther(value)} ETH`;
async function request<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/storage-treasury", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json() as { error?: string };
  if (!response.ok) throw new Error(data.error || "Storage check failed. Please retry.");
  return data as T;
}
function savedKey(status: Pick<TreasuryStatus, "chainId" | "treasury" | "endpoint">) {
  return `mintforge-irys-funding:v1:${status.chainId}:${status.treasury.toLowerCase()}:${status.endpoint}`;
}

export default function StorageSetup() {
  const [config, setConfig] = useState<Configuration | null>(null);
  const [status, setStatus] = useState<TreasuryStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("");
  const [plan, setPlan] = useState<FundingPlan | null>(null);
  const [hash, setHash] = useState("");
  const [notified, setNotified] = useState(false);
  const [routeAmount, setRouteAmount] = useState("");
  const [route, setRoute] = useState<PlsRouteCheck | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/status", { cache: "no-store" })
      .then(async r => { if (!r.ok) throw new Error("Configuration check failed."); return r.json() as Promise<Configuration>; })
      .then(data => { if (active) setConfig(data); })
      .catch(() => { if (active) setMessage("Could not read storage settings. Reload this page to try again."); });
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage(errorText(error)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function restoreHash(next: TreasuryStatus) {
    try {
      const saved = localStorage.getItem(savedKey(next)) || "";
      setHash(/^0x[0-9a-fA-F]{64}$/.test(saved) ? saved : "");
    } catch { setMessage("Enable browser storage before making a deposit so its transaction hash can be saved."); }
  }
  function saveHash(value: string, current: TreasuryStatus) {
    // Keep the hash visible even if browser storage becomes unavailable after a
    // transaction was broadcast. Wallet activity also allows manual recovery.
    setHash(value); setNotified(false);
    try { localStorage.setItem(savedKey(current), value); }
    catch { throw new Error(`Deposit transaction: ${value}. Browser storage could not save it. Copy this hash before leaving; do not send another deposit.`); }
  }
  async function connect() {
    if (!config?.storageChain) throw new Error("Configure IRYS_TOKEN as ethereum or base-eth before connecting.");
    const wallet = await signer(config.storageChain);
    await authorizeUploads(config.storageChain, await wallet.getAddress());
    const next = await request<TreasuryStatus>({ action: "status" });
    setStatus(next); setPlan(null); setRoute(null); setNotified(false); restoreHash(next);
    setMessage("Storage wallet verified. These are separate wallet and Irys balances; each collection still needs its own quote.");
  }
  async function refresh() {
    const next = await request<TreasuryStatus>({ action: "status" });
    if (status && savedKey(next) !== savedKey(status)) {
      setPlan(null); setNotified(false); restoreHash(next);
    }
    setStatus(next);
  }
  async function review() {
    if (hash.trim()) throw new Error("Resolve the saved deposit before preparing another one.");
    setPlan(null);
    const next = await request<FundingPlan>({ action: "prepare", amount });
    requireSameConfiguration(next);
    setPlan(next);
    setMessage("Review the deposit amount, destination and maximum network fee below. Your wallet will ask for approval only when you choose Send deposit.");
  }
  function requireSameConfiguration(next: FundingPlan) {
    if (!status || next.chainId !== status.chainId || next.treasury !== status.treasury || next.endpoint !== status.endpoint || next.token !== status.token) {
      setPlan(null);
      throw new Error("Storage settings changed. Reconnect the storage wallet and review the current balances before preparing a deposit.");
    }
  }
  async function send() {
    if (!plan || !status || hash.trim()) throw new Error("Review a new deposit first, or check the existing transaction hash.");
    if (plan.expires <= Date.now()) { setPlan(null); throw new Error("The fee review expired. Review the deposit again before sending."); }
    // Refuse to open a wallet payment unless recovery storage is writable.
    const key = savedKey(status);
    const saved = localStorage.getItem(key);
    if (saved) { setHash(saved); throw new Error("A deposit is already saved. Check its notification before sending again."); }
    localStorage.setItem(key, ""); localStorage.removeItem(key);
    const current = await request<FundingPlan>({ action: "prepare", amount });
    requireSameConfiguration(current);
    if (current.to !== plan.to || current.treasury !== plan.treasury || current.chainId !== plan.chainId ||
        current.endpoint !== plan.endpoint || current.token !== plan.token || current.value !== plan.value ||
        BigInt(current.gasLimit) > BigInt(plan.gasLimit) || BigInt(current.gasPrice) > BigInt(plan.gasPrice)) {
      setPlan(current); throw new Error("Deposit details or network fees changed. Review the updated amount before choosing Send deposit again.");
    }
    const wallet = await signer(plan.chainId, plan.treasury);
    const tx = await wallet.sendTransaction({ to: plan.to, value: BigInt(plan.value), data: "0x",
      chainId: BigInt(plan.chainId), gasLimit: BigInt(plan.gasLimit), gasPrice: BigInt(plan.gasPrice), type: 0 });
    setPlan(null);
    saveHash(tx.hash, status);
    setMessage("Deposit submitted and its hash saved. After two network confirmations, choose Check deposit notification. This check does not send another payment.");
  }
  async function notify() {
    if (!status) return;
    const value = hash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("Paste the deposit transaction hash from your wallet.");
    saveHash(value, status);
    const result = await request<{ message: string }>({ action: "notify", hash: value });
    setNotified(true); setMessage(result.message);
    await refresh();
  }
  function clearSaved() {
    if (!status) return;
    try { localStorage.removeItem(savedKey(status)); }
    catch { setMessage("Could not clear browser storage. The saved transaction remains available."); return; }
    setHash(""); setNotified(false); setPlan(null);
    setMessage("Saved hash cleared in this browser. Existing blockchain transactions and Irys deposits are unchanged.");
  }
  async function checkRoute() {
    setRoute(null);
    setRoute(await request<PlsRouteCheck>({ action: "route", amount: routeAmount }));
    setMessage("This diagnostic quote does not enable checkout or verify a completed payment. The customer checkout uses PulseX and LibertySwap.");
  }

  return <section className="settings-card" aria-label="Irys storage setup">
    <h2>3. Enable Irys uploads and quotes</h2>
    <p>{config === null ? "Checking storage settings…" : config.uploads
      ? "Irys credentials and the database binding are present. Check the live balances below before funding or testing an upload."
      : "Irys storage is not configured yet. Add the database binding, treasury secret and payment receiver in Cloudflare."}</p>
    <p>Automatic PLS checkout gives each collection its own payment wallet and Irys credit, funded by the creator. The balances and manual recovery controls below belong to your original storage wallet; they are not the balances of those collection jobs.</p>
    <button className="mf-button" disabled={busy || !config?.uploads || !config.storageChain} onClick={() => run(connect)}>
      {busy ? "Working…" : status ? "Reconnect storage wallet" : "Connect storage wallet & check"}
    </button>
    {status && <>
      <dl className="mf-details">
        <div><dt>Storage wallet verified by signature</dt><dd className="mf-address">{status.treasury}</dd></div>
        <div><dt>ETH funding network</dt><dd>{status.chainName}</dd></div>
        <div><dt>Customer storage payment receiver</dt><dd className="mf-address">{status.receiver}</dd></div>
        <div><dt>ETH in storage wallet</dt><dd>{eth(status.checks.wallet.value)}</dd></div>
        <div><dt>Irys upload credit</dt><dd>{eth(status.checks.credit.value)}</dd></div>
        <div><dt>Live Irys price · 1 MiB sample</dt><dd>{eth(status.checks.price.value)}</dd></div>
      </dl>
      {Object.entries(status.checks).map(([name, check]) => <p key={name}>{check.message}</p>)}
      {status.treasury.toLowerCase() !== status.receiver.toLowerCase() &&
        <p>Storage payments currently go to a different wallet. Irys funding uses the storage wallet shown above.</p>}
      <p>Last checked: {new Date(status.checkedAt).toLocaleString()}.</p>
      <button disabled={busy} onClick={() => run(refresh)}>Refresh balances</button>

      <h3>Fund Irys from your storage wallet</h3>
      <p>Enter the amount you choose to deposit on {status.chainName}. The review shows the ETH deposit and its maximum network fee. Every transfer requires your wallet approval.</p>
      <div className="mf-form-grid">
        <label>Deposit amount (ETH)<input inputMode="decimal" value={amount} disabled={busy || !!hash.trim()}
          placeholder="Enter an amount" onChange={e => { setAmount(e.target.value); setPlan(null); }} /></label>
      </div>
      <button disabled={busy || !amount || !!hash.trim()} onClick={() => run(review)}>Review deposit and fee</button>
      {plan && <div className="mf-notice" aria-label="Irys deposit review">
        <dl className="mf-details">
          <div><dt>Deposit to Irys</dt><dd>{eth(plan.value)}</dd></div>
          <div><dt>Maximum network fee</dt><dd>{eth(plan.maximumNetworkFee)}</dd></div>
          <div><dt>Maximum wallet cost</dt><dd>{eth(plan.maximumTotal)}</dd></div>
          <div><dt>Irys deposit address</dt><dd className="mf-address">{plan.to}</dd></div>
          <div><dt>Network</dt><dd>{status.chainName}</dd></div>
        </dl>
        <p>The Irys node supplies this deposit address. The review expires after two minutes. Unused gas is not spent.</p>
        <button className="mf-button" disabled={busy || !!hash.trim()} onClick={() => run(send)}>Send deposit · approve in wallet</button>
      </div>}
      <details className="mf-manage" open={!!hash}>
        <summary>Check or recover an existing deposit</summary>
        <p>Paste the transaction hash from MetaMask activity if you closed the page, replaced a transaction or lost the notification. This only reports an existing deposit to Irys.</p>
        <label>Deposit transaction hash<input value={hash} disabled={busy} placeholder="0x…"
          onChange={e => { setHash(e.target.value); setNotified(false); setPlan(null); }} /></label>
        <div className="mf-inline">
          <button disabled={busy || !hash.trim()} onClick={() => run(notify)}>{notified ? "Retry deposit notification" : "Check deposit notification"}</button>
          <button disabled={busy || !hash.trim()} onClick={clearSaved}>Clear saved hash</button>
        </div>
        <p>Keep the hash until credit appears or the transaction is confirmed failed. An acknowledged notification can still be processing.</p>
      </details>

      <h3>PLS payments and conversion</h3>
      <p>{config?.plsCheckout ? "PLS checkout is enabled. Each creator payment funds its own PulseX conversion, LibertySwap bridge and Irys upload account. Paid jobs continue processing automatically while the collection page is closed." : "Automatic PLS checkout is installed but disabled. Enable it after completing the deployment and payment acceptance check. Current storage checkout uses ETH."}</p>
      <details className="mf-manage">
        <summary>Alternative route diagnostic · no payment</summary>
        <p>This optional Rubic check is separate from the PulseX and LibertySwap checkout. It only reads a quote and never requests a payment.</p>
        <label>PLS amount to check<input inputMode="decimal" value={routeAmount} disabled={busy}
          placeholder="Enter an amount" onChange={e => { setRouteAmount(e.target.value); setRoute(null); }} /></label>
        <button disabled={busy || !routeAmount} onClick={() => run(checkRoute)}>Check route without paying</button>
        {route && <dl className="mf-details">
          <div><dt>PLS input checked</dt><dd>{formatEther(route.sourceAmount)} PLS</dd></div>
          <div><dt>Quoted destination</dt><dd>{route.destinationChain}</dd></div>
          <div><dt>Expected ETH output</dt><dd>{eth(route.expectedEth)}</dd></div>
          <div><dt>Provider minimum ETH output</dt><dd>{eth(route.minimumEth)}</dd></div>
          <div><dt>Provider</dt><dd>{route.provider}</dd></div>
          <div><dt>Estimated source gas</dt><dd>{route.sourceGas === null ? "Not supplied" : `${formatEther(route.sourceGas)} PLS`}</dd></div>
          <div><dt>Diagnostic result</dt><dd>Quote discovery only</dd></div>
        </dl>}
      </details>
    </>}
    <TransactionNotice message={message} hash={/^0x[0-9a-fA-F]{64}$/.test(hash) ? hash : undefined}
      chainId={status?.chainId || config?.storageChain || "0x1"} />
    <details className="mf-manage">
      <summary>Cloudflare configuration help</summary>
      <p>Bind the upload database as <code>DB</code>, apply the supplied migrations and keep <code>IRYS_PRIVATE_KEY</code> as a server secret for your dedicated storage wallet. Never enter a recovery phrase or private key into this page.</p>
      <p>Set <code>STORAGE_PAYMENT_RECEIVER</code>, <code>IRYS_TOKEN</code> (ethereum or base-eth), and a matching <code>STORAGE_PAYMENT_RPC</code>. The default funding network is Ethereum mainnet. If <code>UPLOAD_ALLOWED_WALLETS</code> is set, include your storage wallet for these checks.</p>
      <p>Set your storage service fee separately. Creators review an itemized storage budget before paying; the Irys spending approval is capped to their upload job.</p>
      <p>Automatic PLS checkout requires migration <code>0002_pls_settlements.sql</code>, the scheduled worker installed by the deployment script, and <code>PLS_CHECKOUT_ENABLED=true</code>. Keep the existing <code>IRYS_PRIVATE_KEY</code> unchanged while jobs or upload approvals remain open. It also derives isolated payment wallets for those jobs. Start with an allowed test wallet before opening customer checkout.</p>
    </details>
    <a href="/">Return to MintForge →</a>
  </section>;
}
