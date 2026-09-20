import { boundedJson } from "../../../lib/http";
import { isAddress, verifyMessage } from "ethers";
import {
  authMessage,
  database,
  digest,
  jsonError,
  quota,
  sameOrigin,
  settings,
} from "../../../lib/server";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    if (!settings().PINATA_JWT && !settings().IRYS_PRIVATE_KEY)
      throw new Error("Storage uploads are not configured yet.");
    if (Number(req.headers.get("content-length") || 0) > 5000)
      throw new Error("Request too large.");
    const { wallet, nonce, signature } = await boundedJson(req);
    if (typeof wallet !== "string" || !isAddress(wallet))
      throw new Error("Valid wallet required.");
    const origin = new URL(req.url).origin;
    const db = database();
    const now = Date.now();
    const allowed = settings()
      .UPLOAD_ALLOWED_WALLETS?.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (allowed?.length && !allowed.includes(wallet.toLowerCase()))
      throw new Error("This wallet is not enabled for uploads.");
    const ip = await digest(req.headers.get("cf-connecting-ip") || "local");
    await quota(`auth:${Math.floor(now / 3600000)}:${ip}`, 1, 60);
    if (!signature) {
      const value = crypto.randomUUID();
      const expires = now + 300000;
      await db
        .prepare(
          "INSERT INTO upload_nonces(nonce,wallet,origin,expires) VALUES(?,?,?,?)",
        )
        .bind(value, wallet.toLowerCase(), origin, expires)
        .run();
      return Response.json({
        nonce: value,
        message: authMessage(wallet.toLowerCase(), origin, value, expires),
      });
    }
    if (typeof nonce !== "string" || typeof signature !== "string")
      throw new Error("Signature required.");
    const record = await db
      .prepare(
        "SELECT wallet,origin,expires FROM upload_nonces WHERE nonce=? AND expires>?",
      )
      .bind(nonce, now)
      .first<{ wallet: string; origin: string; expires: number }>();
    if (
      !record ||
      record.wallet !== wallet.toLowerCase() ||
      record.origin !== origin
    )
      throw new Error("Authorization expired.");
    if (
      verifyMessage(
        authMessage(record.wallet, origin, nonce, record.expires),
        signature,
      ).toLowerCase() !== record.wallet
    )
      throw new Error("Signature does not match wallet.");
    const consumed = await db
      .prepare("DELETE FROM upload_nonces WHERE nonce=? RETURNING nonce")
      .bind(nonce)
      .first();
    if (!consumed) throw new Error("Authorization already used.");
    const token = crypto.randomUUID() + crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO upload_sessions(token,wallet,expires) VALUES(?,?,?)",
      )
      .bind(await digest(token), record.wallet, now + 3600000)
      .run();
    await db.batch([
      db.prepare("DELETE FROM upload_nonces WHERE expires<?").bind(now),
      db.prepare("DELETE FROM upload_sessions WHERE expires<?").bind(now),
    ]);
    return Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie": `mf_upload=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=3600${origin.startsWith("https:") ? "; Secure" : ""}`,
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (e) {
    return jsonError(e);
  }
}
