import { boundedJson } from "../../../lib/http";
import { database, jsonError, quota, sameOrigin, uploadSession } from "../../../lib/server";
import { irysSettings } from "../../../lib/irys-server";
import { treasuryStatus, prepareFunding, notifyFunding } from "../../../lib/irys-treasury";
import { checkPlsRoute } from "../../../lib/pls-route-check";

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const c = irysSettings();
    const session = await uploadSession(req);
    if (session.wallet !== c.payer) throw new Error("Connect the dedicated storage wallet that matches IRYS_PRIVATE_KEY to manage Irys funding.");
    const body = await boundedJson(req, 2048);
    const action = body.action;
    if (typeof action !== "string" || !["status", "prepare", "notify", "route"].includes(action)) throw new Error("Unknown storage treasury action.");
    const minute = Math.floor(Date.now() / 60000);
    await quota(`treasury:${c.payer}:${minute}`, 1, 12);
    if (action === "route") await quota(`route-check:${minute}`, 1, 2);
    // Verify migrations before offering a funding transaction.
    if (action === "prepare") await database().prepare("SELECT id FROM storage_quotes LIMIT 1").first();
    const data = action === "status" ? await treasuryStatus() : action === "prepare" ? await prepareFunding(body.amount)
      : action === "notify" ? await notifyFunding(body.hash) : await checkPlsRoute(body.amount);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    // RPC errors can contain credentials embedded in RPC URLs. Only return our
    // own plain messages, never raw ethers/provider exception objects.
    if (e instanceof Error && e.constructor === Error && !("code" in e)) return jsonError(e);
    return jsonError(new Error("The storage check could not complete. Check the funding network and provider settings, then retry."));
  }
}
