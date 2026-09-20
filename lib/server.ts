import { env } from "cloudflare:workers";
export function settings() {
  return env as unknown as {
    DB?: D1Database;
    PINATA_JWT?: string;
    IRYS_PRIVATE_KEY?: string;
    IRYS_TOKEN?: string;
    IRYS_NODE_URL?: string;
    IRYS_GATEWAY_URL?: string;
    STORAGE_PAYMENT_RECEIVER?: string;
    STORAGE_PAYMENT_RPC?: string;
    STORAGE_SERVICE_FEE_WEI?: string;
    COLLECTION_MAX_BYTES?: string;
    UPLOAD_MAX_BYTES_PER_DAY?: string;
    UPLOAD_ALLOWED_WALLETS?: string;
    PLS_CHECKOUT_ENABLED?: string;
    PLS_RPC_URL?: string;
    PLS_SWAP_ROUTER?: string;
    PLS_SWAP_ROUTER_HASH?: string;
    PLS_WRAPPED_NATIVE?: string;
    PLS_BRIDGE_WETH?: string;
    LIBERTY_ROUTER?: string;
    LIBERTY_ROUTER_HASH?: string;
    PLS_SLIPPAGE_BPS?: string;
  };
}
export function database() {
  const db = settings().DB;
  if (!db) throw new Error("Upload storage is not configured.");
  return db;
}
export function sameOrigin(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    throw new Error("Request origin rejected.");
}
export async function digest(s: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function quota(bucket: string, amount: number, limit: number) {
  const row = await database()
    .prepare(
      "INSERT INTO upload_quota(bucket,used) SELECT ?,? WHERE ? <= ? ON CONFLICT(bucket) DO UPDATE SET used=upload_quota.used+excluded.used WHERE upload_quota.used+excluded.used<=? RETURNING used",
    )
    .bind(bucket, amount, amount, limit, limit)
    .first();
  if (!row) throw new Error("Upload limit reached. Please try again tomorrow.");
}
export async function uploadSession(req: Request) {
  const token = req.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)mf_upload=([^;]+)/)?.[1];
  if (!token) throw new Error("Sign in with your wallet before uploading.");
  const s = await database()
    .prepare("SELECT wallet FROM upload_sessions WHERE token=? AND expires>?")
    .bind(await digest(token), Date.now())
    .first<{ wallet: string }>();
  if (!s) throw new Error("Upload session expired. Sign in again.");
  return s;
}
export function authMessage(
  wallet: string,
  origin: string,
  nonce: string,
  expires: number,
) {
  return `MintForge upload authorization\nWebsite: ${origin}\nWallet: ${wallet}\nNonce: ${nonce}\nExpires: ${new Date(expires).toISOString()}\n\nThis signature starts a one-hour upload session. It does not approve tokens or submit a transaction.`;
}
export function jsonError(e: unknown, status = 400) {
  return Response.json(
    { error: e instanceof Error && !("code" in e) ? e.message : "Request failed. Progress is saved; retry without paying again." },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
