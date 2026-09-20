import { Buffer } from "buffer";
import { JsonRpcProvider } from "ethers";
import { boundedJson } from "../../../lib/http";
import { database, jsonError, sameOrigin, uploadSession } from "../../../lib/server";
import { irysSettings } from "../../../lib/irys-server";
import { signedData } from "../../../lib/irys-data";
import type { StorageQuote } from "../../../lib/storage-types";
import { advanceSettlement, registerPlsPayment, settlementProgress } from "../../../lib/pls-settlement";
export async function POST(req: Request) {
  try {
    sameOrigin(req); const session = await uploadSession(req), c = irysSettings();
    const {id, payment} = await boundedJson(req);
    if (typeof id !== "string" || typeof payment !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(payment)) throw new Error("A confirmed quote payment is required.");
    const db = database();
    const row = await db.prepare("SELECT * FROM storage_quotes WHERE id=? AND wallet=?").bind(id,session.wallet).first<{quote:string;payment_tx:string|null;active:number;approval_raw:string|null;approval_id:string|null}>();
    if (!row) throw new Error("Quote not found for this wallet.");
    const q = JSON.parse(row.quote) as StorageQuote;
    if (q.automation) {
      await registerPlsPayment(id,session.wallet,payment);
      await advanceSettlement(id);
      const status = await settlementProgress(id,session.wallet);
      return Response.json({ok:status.active,...status},{headers:{"Cache-Control":"no-store"}});
    }
    if (q.endpoint !== c.endpoint || q.token !== c.token || q.payer.toLowerCase() !== c.payer.toLowerCase()) throw new Error("Storage configuration changed. Contact the operator with your quote ID.");
    if (row.payment_tx && row.payment_tx !== payment.toLowerCase()) throw new Error("This quote already has a different payment.");
    if (row.active) return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});
    if (!row.payment_tx) {
      const rpc = new JsonRpcProvider(c.rpc, Number(q.paymentChain), {staticNetwork:true,batchMaxCount:1});
      try {
        const [tx, receipt] = await Promise.all([rpc.getTransaction(payment),rpc.getTransactionReceipt(payment)]);
        if (!tx || !receipt || receipt.status !== 1 || await receipt.confirmations() < 2) throw new Error("Payment needs two network confirmations. Retry activation; do not pay again.");
        if (tx.chainId !== BigInt(q.paymentChain) || tx.from.toLowerCase() !== session.wallet || tx.to?.toLowerCase() !== q.recipient.toLowerCase() || tx.value !== BigInt(q.total) || tx.data.toLowerCase() !== q.data.toLowerCase()) throw new Error("Payment does not match this wallet and quote.");
        const block = await rpc.getBlock(receipt.blockNumber);
        if (!block || block.timestamp * 1000 > q.expires) throw new Error("Payment was mined after this quote expired. Contact the operator with the payment hash; do not pay again.");
        await db.prepare("UPDATE storage_quotes SET payment_tx=? WHERE id=? AND payment_tx IS NULL").bind(payment.toLowerCase(),id).run();
      } finally { rpc.destroy(); }
    }
    // Persist exact signed bytes before sending. Concurrent requests and retries reuse the same ID.
    if (!row.approval_raw) {
      const tx = await signedData("", c.key, [
        {name:"x-irys-approve-payment",value:q.address}, {name:"x-amount",value:q.allowance},
        {name:"x-expire-seconds",value:String(q.approvalSeconds)}, {name:"MintForge-Quote",value:q.id},
      ]);
      await db.prepare("UPDATE storage_quotes SET approval_raw=?,approval_id=? WHERE id=? AND approval_raw IS NULL").bind(Buffer.from(tx.getRaw()).toString("base64"),tx.id,id).run();
    }
    const approval = await db.prepare("SELECT approval_raw,approval_id FROM storage_quotes WHERE id=?").bind(id).first<{approval_raw:string;approval_id:string}>();
    if (!approval) throw new Error("Unable to recover storage approval.");
    const response = await fetch(new URL(`/tx/${c.token}`,c.endpoint), {method:"POST",headers:{"Content-Type":"application/octet-stream"},body:Buffer.from(approval.approval_raw,"base64"),signal:AbortSignal.timeout(25000)});
    if (!response.ok || response.status === 201) throw new Error("Irys approval is pending. Retry activation using the saved payment; do not pay again.");
    const receipt = await response.json() as {id?:string};
    if (receipt.id !== approval.approval_id) throw new Error("Irys approval receipt did not match.");
    await db.prepare("UPDATE storage_quotes SET active=1 WHERE id=?").bind(id).run();
    return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});
  } catch (e) { return jsonError(e); }
}
