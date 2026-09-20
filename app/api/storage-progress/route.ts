import { boundedJson } from "../../../lib/http";
import { database, jsonError, quota, sameOrigin, uploadSession } from "../../../lib/server";
import { advanceSettlement, registerPlsPayment, settlementProgress } from "../../../lib/pls-settlement";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const session = await uploadSession(req);
    const { id, payment } = await boundedJson(req, 2048);
    if (typeof id !== "string" || !/^0x[a-f0-9]{64}$/.test(id)) throw new Error("Invalid storage job ID.");
    await quota(`storage-progress:${Math.floor(Date.now() / 60000)}:${session.wallet}`, 1, 30);
    const job = await database().prepare("SELECT id FROM storage_quotes WHERE id=? AND wallet=?").bind(id, session.wallet).first();
    if (!job) throw new Error("Storage job not found for this wallet.");
    if (payment !== undefined) {
      if (typeof payment !== "string") throw new Error("Invalid storage payment hash.");
      await registerPlsPayment(id, session.wallet, payment);
    }
    await advanceSettlement(id);
    return Response.json(await settlementProgress(id, session.wallet), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return jsonError(e); }
}
