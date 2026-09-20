import { Buffer } from "buffer";
import { Transaction, hexlify, randomBytes } from "ethers";
import { database, settings } from "./server";
import { irysSettings } from "./irys-server";
import { signedData } from "./irys-data";
import { BRIDGE, DEX, TOKEN, irysDepositAddress, jobSigner, l1GasBudget, libertyQuote, sameAddress } from "./liberty-storage";
import { SettlementError, SettlementRpc, hex, type ChainTx } from "./settlement-rpc";
import type { StorageQuote } from "./storage-types";
import type { SettlementProgress, SettlementStage, SettlementState } from "./pls-types";

type Row = { quote_id: string; quote: string; wallet: string; payment_tx: string | null; active: number; stage: SettlementStage; data: string; error: string | null; approval_raw: string | null; approval_id: string | null };
type SavedTx = { raw: string; hash: string; chain_id: number; step: string };
const messages: Record<SettlementStage, string> = {
  awaiting_payment: "Waiting for the saved PLS payment to confirm.",
  swapping: "Converting the required PLS to WETH on PulseChain.",
  approving_bridge: "Preparing the exact WETH amount for LibertySwap.",
  bridging: "Sending WETH through LibertySwap.",
  waiting_bridge: "Waiting for ETH to arrive from LibertySwap. Your payment is saved.",
  funding_irys: "Funding this collection's Irys account.",
  waiting_credit: "Waiting for Irys to confirm usable upload credit.",
  authorizing: "Authorizing this collection's upload budget.",
  returning_surplus: "Storage is ready. Returning unused conversion and gas funds.",
  complete: "Storage is ready. Payment processing is complete.",
  refunding: "This route could not complete. Returning the funds still held by this job.",
  refunded: "Available funds have been returned, less network fees. Review the refund transactions.",
  needs_attention: "Processing is paused. Keep your job ID and transaction hashes; do not pay again.",
};
async function rowFor(id: string) {
  return database().prepare("SELECT s.*,q.quote,q.wallet,q.payment_tx,q.active,q.approval_raw,q.approval_id FROM storage_settlements s JOIN storage_quotes q ON q.id=s.quote_id WHERE s.quote_id=?").bind(id).first<Row>();
}
function configuration(q: StorageQuote) {
  const c = irysSettings(), a = q.automation;
  if (!a || a.version !== 1 || q.endpoint !== c.endpoint || q.token !== c.token || Number(c.paymentChain) !== a.destinationChain || !sameAddress(a.master, c.payer)) throw new SettlementError("Storage configuration changed. Keep the original treasury secret available to recover this payment.");
  const signer = jobSigner(q.id, c.key);
  if (!sameAddress(signer.address, q.payer) || !sameAddress(signer.address, q.recipient)) throw new SettlementError("This payment wallet does not match the saved job.");
  return { a, c, signer, source: new SettlementRpc(settings().PLS_RPC_URL || "https://rpc.pulsechain.com", 369), destination: new SettlementRpc(c.rpc, a.destinationChain) };
}
export async function registerPlsPayment(id: string, wallet: string, payment: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(payment)) throw new SettlementError("A payment transaction hash is required.");
  const row = await rowFor(id);
  if (!row || row.wallet !== wallet) throw new SettlementError("This payment job belongs to another wallet.");
  if (row.payment_tx === payment.toLowerCase()) return;
  const q = JSON.parse(row.quote) as StorageQuote;
  const { source } = configuration(q);
  await source.verify();
  const tx = await source.send<ChainTx | null>("eth_getTransactionByHash", [payment]);
  if (!tx) throw new SettlementError("The PLS payment is not visible yet. Retry using the same hash.");
  if (!sameAddress(tx.from, wallet) || !tx.to || !sameAddress(tx.to, q.recipient) || BigInt(tx.value) !== BigInt(q.total) || tx.input.toLowerCase() !== q.data.toLowerCase() || (tx.chainId && BigInt(tx.chainId) !== 369n)) throw new SettlementError("The PLS payment does not match this wallet and quote.");
  if (row.payment_tx) {
    const previous = await source.send<ChainTx | null>("eth_getTransactionByHash", [row.payment_tx]);
    if (row.stage !== "awaiting_payment" || !previous || previous.blockNumber || previous.nonce !== tx.nonce || !sameAddress(previous.from, tx.from)) throw new SettlementError("This job already has a saved payment. Only a matching wallet speed-up can replace it.");
    await database().prepare("UPDATE storage_quotes SET payment_tx=? WHERE id=? AND payment_tx=?").bind(payment.toLowerCase(), id, row.payment_tx).run();
  } else {
    await database().prepare("UPDATE storage_quotes SET payment_tx=? WHERE id=? AND payment_tx IS NULL").bind(payment.toLowerCase(), id).run();
  }
  const saved = await database().prepare("SELECT payment_tx FROM storage_quotes WHERE id=?").bind(id).first<{ payment_tx: string }>();
  if (saved?.payment_tx !== payment.toLowerCase()) throw new SettlementError("Another payment is already registered for this job.");
  await database().prepare("UPDATE storage_settlements SET next_attempt=0 WHERE quote_id=?").bind(id).run();
}
export async function settlementProgress(id: string, wallet: string): Promise<SettlementProgress> {
  const row = await rowFor(id);
  if (!row || row.wallet !== wallet) throw new SettlementError("Storage job not found for this wallet.");
  const txs = await database().prepare("SELECT step,chain_id,hash FROM storage_settlement_txs WHERE quote_id=? ORDER BY rowid").bind(id).all<SavedTx>();
  const data = JSON.parse(row.data) as SettlementState;
  return { id, stage: row.stage, active: !!row.active, message: messages[row.stage] + (data.reason ? " " + data.reason : ""), ...(row.error ? { error: row.error } : {}),
    transactions: [...(row.payment_tx ? [{ step: "payment", chain: 369, hash: row.payment_tx }] : []), ...txs.results.map(t => ({ step: t.step, chain: t.chain_id, hash: t.hash }))], refunds: data.refunds || [] };
}

export async function advanceSettlement(id: string) {
  const db = database(), owner = hexlify(randomBytes(16)), now = Date.now();
  const lease = await db.prepare("UPDATE storage_settlements SET lease_owner=?,lease_until=? WHERE quote_id=? AND lease_until<? AND stage NOT IN ('complete','refunded','needs_attention') RETURNING quote_id")
    .bind(owner, now + 240000, id, now).first();
  if (!lease) return;
  let state: SettlementState = {};
  async function owned() {
    const r = await db.prepare("SELECT quote_id FROM storage_settlements WHERE quote_id=? AND lease_owner=? AND lease_until>?").bind(id, owner, Date.now()).first();
    if (!r) throw new SettlementError("Another worker resumed this job. Progress is saved.");
  }
  async function stage(value: SettlementStage) {
    const r = await db.prepare("UPDATE storage_settlements SET stage=?,data=?,error=NULL,updated=?,next_attempt=? WHERE quote_id=? AND lease_owner=? AND lease_until>? RETURNING quote_id")
      .bind(value, JSON.stringify(state), Date.now(), Date.now() + 15000, id, owner, Date.now()).first();
    if (!r) throw new SettlementError("Another worker resumed this job. Progress is saved.");
  }
  const savedTx = (step: string) => db.prepare("SELECT * FROM storage_settlement_txs WHERE quote_id=? AND step=?").bind(id, step).first<SavedTx>();
  try {
    const row = await rowFor(id);
    if (!row || !row.payment_tx) return;
    const q = JSON.parse(row.quote) as StorageQuote;
    const { a, signer, source, destination } = configuration(q);
    state = JSON.parse(row.data) as SettlementState;
    await Promise.all([source.verify(), destination.verify()]);
    async function once(stepName: string, rpc: SettlementRpc, to: string, value: bigint, data: string, gasLimit: bigint): Promise<"pending" | "ok" | "failed"> {
      let tx = await savedTx(stepName);
      if (!tx) {
        await owned();
        const gasPrice = BigInt(rpc.chain === 369 ? a.sourceGasPrice : a.destinationGasPrice);
        if (await rpc.gasPrice() > gasPrice) throw new SettlementError("Network fees are above the approved budget. The job will retry automatically.");
        if (rpc.chain === 8453 && await l1GasBudget(rpc) > BigInt(a.l1Budget)) throw new SettlementError("Base data fees are above the approved budget. The job will retry automatically.");
        const from = signer.address;
        const estimated = BigInt(await rpc.send("eth_estimateGas", [{ from, to, value: hex(value), data }]));
        if (estimated > gasLimit) throw new SettlementError("Execution requires more gas than the reviewed budget. Processing is paused without another charge.");
        const nonce = Number(BigInt(await rpc.send("eth_getTransactionCount", [from, "pending"])));
        const raw = await signer.signTransaction({ type: 0, chainId: rpc.chain, nonce, to, value, data, gasLimit, gasPrice });
        if (rpc.chain === 8453 && (raw.length - 2) / 2 > 512) throw new SettlementError("The transaction exceeds the reviewed Base data-fee budget. Nothing was broadcast.");
        const hash = Transaction.from(raw).hash!;
        // The lease predicate fences late workers. The unique step chooses one
        // canonical signed transaction even if a response or worker is lost.
        await db.prepare("INSERT INTO storage_settlement_txs(quote_id,step,chain_id,raw,hash) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM storage_settlements WHERE quote_id=? AND lease_owner=? AND lease_until>?) ON CONFLICT(quote_id,step) DO NOTHING")
          .bind(id, stepName, rpc.chain, raw, hash, id, owner, Date.now()).run();
        tx = await savedTx(stepName);
        if (!tx) throw new SettlementError("Could not save the payment transaction. Nothing was broadcast.");
      }
      const signed = Transaction.from(tx.raw);
      if (signed.chainId !== BigInt(rpc.chain) || !sameAddress(signed.from || "", signer.address) || signed.hash !== tx.hash) throw new SettlementError("The saved transaction did not match this job.");
      const receipt = await rpc.confirmed(tx.hash, rpc.chain === 369 ? a.sourceConfirmations : a.destinationConfirmations);
      if (receipt) return BigInt(receipt.status) === 1n ? "ok" : "failed";
      const known = await rpc.send<ChainTx | null>("eth_getTransactionByHash", [tx.hash]);
      if (!known) {
        await owned();
        // A lost response is harmless: the next attempt sends these same bytes.
        const hash = await rpc.send("eth_sendRawTransaction", [tx.raw]);
        if (hash.toLowerCase() !== tx.hash.toLowerCase()) throw new SettlementError("The network returned an unexpected transaction hash.");
      }
      return "pending";
    }
    async function contractPins() {
      const [r, b] = await Promise.all([source.codeHash(a.router), source.codeHash(a.bridge)]);
      if (r !== a.routerHash || b !== a.bridgeHash) throw new SettlementError("Payment contract code changed. The saved job requires review.");
    }
    async function returnNative(rpc: SettlementRpc, stepName: string) {
      const saved = await savedTx(stepName);
      let value: bigint;
      if (saved) value = Transaction.from(saved.raw).value;
      else {
        const fee = 21000n * BigInt(rpc.chain === 369 ? a.sourceGasPrice : a.destinationGasPrice) + (rpc.chain === 8453 ? BigInt(a.l1Budget) : 0n);
        value = await rpc.balance(signer.address) - fee;
        if (value <= 0n) return true; // dust remains below the cost of a transfer
      }
      const result = await once(stepName, rpc, a.customer, value, "0x", 21000n);
      if (result === "failed") { await stage("needs_attention"); throw new SettlementError("The refund transfer reverted. Storage and payment records are saved for recovery."); }
      if (result !== "ok") return false;
      const symbol = rpc.chain === 369 ? "PLS" : "ETH";
      if (!(state.refunds || []).some(r => r.symbol === symbol && r.chain === rpc.chain)) (state.refunds ||= []).push({ symbol, chain: rpc.chain, amount: String(value) });
      return true;
    }
    switch (row.stage) {
      case "awaiting_payment": {
        const receipt = await source.confirmed(row.payment_tx, a.sourceConfirmations);
        if (!receipt) return;
        if (BigInt(receipt.status) !== 1n) { state.reason = "The customer payment reverted."; await stage("needs_attention"); return; }
        const tx = await source.send<ChainTx>("eth_getTransactionByHash", [row.payment_tx]);
        if (!tx || !sameAddress(tx.from, row.wallet) || !sameAddress(tx.to || "", q.recipient) || BigInt(tx.value) !== BigInt(q.total) || tx.input.toLowerCase() !== q.data.toLowerCase()) throw new SettlementError("The confirmed payment no longer matches the quote.");
        const block = await source.send<{ timestamp: string }>("eth_getBlockByNumber", [receipt.blockNumber, false]);
        if (Number(BigInt(block.timestamp)) * 1000 > q.expires) { state.reason = "The payment confirmed after the quote expired."; await stage("refunding"); return; }
        await stage("swapping"); return;
      }
      case "swapping": {
        if (!(await savedTx("swap"))) {
          await contractPins();
          const amounts = (await source.call(a.router, DEX, "getAmountsIn", [BigInt(a.bridgeInput), [a.wrappedPls, a.weth]]))[0] as bigint[];
          if (amounts[0] > BigInt(a.maxPls)) { state.reason = "The PLS price moved outside the approved limit."; await stage("refunding"); return; }
        }
        const block = await source.send<{ timestamp: string }>("eth_getBlockByNumber", ["latest", false]);
        const deadline = BigInt(block.timestamp) + 600n;
        const data = DEX.encodeFunctionData("swapETHForExactTokens", [BigInt(a.bridgeInput), [a.wrappedPls, a.weth], signer.address, deadline]);
        const result = await once("swap", source, a.router, BigInt(a.maxPls), data, 350000n);
        if (result === "failed") { state.reason = "The PLS swap reverted."; await stage("refunding"); }
        if (result === "ok") {
          const balance = (await source.call(a.weth, TOKEN, "balanceOf", [signer.address]))[0] as bigint;
          if (balance < BigInt(a.bridgeInput)) throw new SettlementError("The WETH amount received is below the approved bridge amount.");
          await stage("approving_bridge");
        }
        return;
      }
      case "approving_bridge": {
        await contractPins();
        const result = await once("bridge_approval", source, a.weth, 0n, TOKEN.encodeFunctionData("approve", [a.bridge, BigInt(a.bridgeInput)]), 80000n);
        if (result === "failed") { state.reason = "The WETH approval reverted."; await stage("refunding"); }
        if (result === "ok") await stage("bridging");
        return;
      }
      case "bridging": {
        await contractPins();
        if (!(await savedTx("bridge"))) {
          const current = await libertyQuote(BigInt(a.bridgeInput), a.destinationChain, signer.address, a.weth, a.bridge);
          const required = BigInt(a.depositAmount) + BigInt(q.service) + BigInt(a.destinationGas);
          if (current.output < required || current.output < BigInt(a.bridgeOutput)) { state.reason = "The bridge price moved outside the approved budget."; await stage("refunding"); return; }
        }
        const data = BRIDGE.encodeFunctionData("swap", [a.destinationChain, BigInt(a.bridgeInput), signer.address, 0, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", "0x" + "0".repeat(64)]);
        const result = await once("bridge", source, a.bridge, 0n, data, 500000n);
        if (result === "failed") { state.reason = "The bridge source transaction reverted."; await stage("refunding"); }
        if (result === "ok") { state.bridgeStarted = Date.now(); await stage("waiting_bridge"); }
        return;
      }
      case "waiting_bridge": {
        const bridge = await savedTx("bridge");
        if (!bridge || !(await source.confirmed(bridge.hash, a.sourceConfirmations))) return;
        const safeBlock = Math.max(0, await destination.height() - a.destinationConfirmations + 1);
        // A unique, non-reused destination wallet isolates this job's proceeds.
        // Source success alone never activates storage or proves ETH delivery.
        const received = await destination.balance(signer.address, hex(safeBlock));
        if (received >= BigInt(a.bridgeOutput)) { await stage("funding_irys"); return; }
        const response = await fetch("https://apis.libertyswap.finance/v3/app/swap/tx/process", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash: bridge.hash, chainId: 369, transactionType: "SWAP_INITIATED", target: "LIBERTY_SWAP" }), signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new SettlementError("LibertySwap is still processing the saved bridge transaction. It will be checked again.");
        return;
      }
      case "funding_irys": {
        if (await irysDepositAddress(q.endpoint, q.token) !== a.deposit) throw new SettlementError("Irys changed its deposit address. The saved payment needs review before funding.");
        const result = await once("irys_deposit", destination, a.deposit, BigInt(a.depositAmount), "0x", 21000n);
        if (result === "failed") { state.reason = "The Irys deposit transaction reverted."; await stage("needs_attention"); }
        if (result === "ok") await stage("waiting_credit");
        return;
      }
      case "waiting_credit": {
        const deposit = await savedTx("irys_deposit");
        if (!deposit) throw new SettlementError("The saved Irys deposit is missing.");
        const response = await fetch(new URL(`/account/balance/${q.token}?address=${q.payer}`, q.endpoint), { signal: AbortSignal.timeout(15000) });
        if (!response.ok && response.status !== 404) throw new SettlementError("Irys has not confirmed upload credit yet. The same deposit will be checked again.");
        const balance = response.status === 404 ? { balance: "0" } : await response.json() as { balance?: string };
        if (typeof balance.balance !== "string" || !/^\d+$/.test(balance.balance)) throw new SettlementError("Irys returned an invalid credit balance.");
        if (BigInt(balance.balance) >= BigInt(a.depositAmount)) { await stage("authorizing"); return; }
        const notified = await fetch(new URL(`/account/balance/${q.token}`, q.endpoint), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tx_id: deposit.hash }), signal: AbortSignal.timeout(15000) });
        if (!notified.ok) throw new SettlementError("Irys deposit notification is pending. The saved hash will be retried without another transfer.");
        return;
      }
      case "authorizing": {
        if (!row.approval_raw) {
          const approval = await signedData("", signer.privateKey, [{ name: "x-irys-approve-payment", value: q.address }, { name: "x-amount", value: q.allowance }, { name: "x-expire-seconds", value: String(q.approvalSeconds) }, { name: "MintForge-Quote", value: q.id }]);
          await owned();
          await db.prepare("UPDATE storage_quotes SET approval_raw=?,approval_id=? WHERE id=? AND approval_raw IS NULL").bind(Buffer.from(approval.getRaw()).toString("base64"), approval.id, id).run();
        }
        const approval = await db.prepare("SELECT approval_raw,approval_id FROM storage_quotes WHERE id=?").bind(id).first<{ approval_raw: string; approval_id: string }>();
        if (!approval) throw new SettlementError("Unable to restore the upload approval.");
        const r = await fetch(new URL(`/tx/${q.token}`, q.endpoint), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: Buffer.from(approval.approval_raw, "base64"), signal: AbortSignal.timeout(15000) });
        if (!r.ok || r.status === 201 || (await r.json() as { id?: string }).id !== approval.approval_id) throw new SettlementError("Irys upload approval is pending. The saved approval will be retried.");
        await owned();
        await db.prepare("UPDATE storage_quotes SET active=1 WHERE id=?").bind(id).run();
        await stage("returning_surplus"); return;
      }
      case "returning_surplus": {
        if (BigInt(q.service) > 0n) {
          const result = await once("service_fee", destination, a.receiver, BigInt(q.service), "0x", 21000n);
          if (result === "failed") { await stage("needs_attention"); return; }
          if (result !== "ok") return;
        }
        if (!(await returnNative(source, "refund_pls"))) return;
        if (!(await returnNative(destination, "refund_eth"))) { await stage("returning_surplus"); return; }
        await stage("complete"); return;
      }
      case "refunding": {
        // Once the bridge may be in flight, do not label it refunded or re-send.
        const bridge = await savedTx("bridge");
        if (bridge) {
          const receipt = await source.confirmed(bridge.hash, a.sourceConfirmations);
          if (!receipt || BigInt(receipt.status) === 1n) { await stage("waiting_bridge"); return; }
        }
        const saved = await savedTx("refund_weth");
        const amount = saved ? TOKEN.decodeFunctionData("transfer", Transaction.from(saved.raw).data)[1] as bigint : (await source.call(a.weth, TOKEN, "balanceOf", [signer.address]))[0] as bigint;
        if (amount > 0n) {
          const result = await once("refund_weth", source, a.weth, 0n, TOKEN.encodeFunctionData("transfer", [a.customer, amount]), 80000n);
          if (result === "failed") { await stage("needs_attention"); return; }
          if (result !== "ok") return;
          if (!(state.refunds || []).some(r => r.symbol === "WETH")) (state.refunds ||= []).push({ symbol: "WETH", chain: 369, amount: String(amount) });
        }
        if (!(await returnNative(source, "refund_pls"))) { await stage("refunding"); return; }
        await stage("refunded"); return;
      }
    }
  } catch (error) {
    const message = error instanceof SettlementError ? error.message : "Payment processing is temporarily unavailable. The same saved transactions will be retried; do not pay again.";
    await db.prepare("UPDATE storage_settlements SET error=?,data=?,updated=?,next_attempt=? WHERE quote_id=? AND lease_owner=? AND lease_until>?").bind(message, JSON.stringify(state), Date.now(), Date.now() + 60000, id, owner, Date.now()).run();
  } finally {
    // Rotate even waiting jobs to the back of the queue so a delayed bridge
    // cannot starve newer paid collections.
    await db.prepare("UPDATE storage_settlements SET lease_owner=NULL,lease_until=0,updated=?,next_attempt=MAX(next_attempt,?) WHERE quote_id=? AND lease_owner=?").bind(Date.now(), Date.now() + 15000, id, owner).run();
  }
}
export async function resumeSettlements() {
  // Already-paid jobs continue even if new PLS checkout is disabled.
  const rows = await database().prepare("SELECT s.quote_id FROM storage_settlements s JOIN storage_quotes q ON q.id=s.quote_id WHERE q.payment_tx IS NOT NULL AND s.stage NOT IN ('complete','refunded','needs_attention') AND s.next_attempt<=? AND s.lease_until<? ORDER BY s.updated LIMIT 8").bind(Date.now(), Date.now()).all<{ quote_id: string }>();
  for (const row of rows.results) await advanceSettlement(row.quote_id);
}
