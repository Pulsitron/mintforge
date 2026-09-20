import { Wallet, getAddress } from "ethers";
import { settings } from "./server";
export function irysSettings() {
  const s = settings();
  if (!s.IRYS_PRIVATE_KEY || !s.STORAGE_PAYMENT_RECEIVER) throw new Error("Irys upload treasury and storage checkout are not configured.");
  const token = s.IRYS_TOKEN || "ethereum";
  if (!["ethereum", "base-eth"].includes(token)) throw new Error("Configure Irys ethereum or base-eth funding.");
  const endpoint = (s.IRYS_NODE_URL || "https://uploader.irys.xyz").replace(/\/$/, "");
  const gateway = (s.IRYS_GATEWAY_URL || "https://gateway.irys.xyz").replace(/\/$/, "");
  for (const url of [endpoint, gateway]) if (new URL(url).protocol !== "https:" || url.length > 256) throw new Error("Storage endpoints require HTTPS.");
  const key = s.IRYS_PRIVATE_KEY;
  const payer = new Wallet(key).address.toLowerCase();
  const service = BigInt(s.STORAGE_SERVICE_FEE_WEI || "0");
  if (service < 0n) throw new Error("Storage service fee is invalid.");
  const maxBytes = Number(s.COLLECTION_MAX_BYTES || 214748364800);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Collection byte budget is invalid.");
  return {key, token, endpoint, gateway, payer, service, recipient: getAddress(s.STORAGE_PAYMENT_RECEIVER), paymentChain: token === "ethereum" ? "0x1" : "0x2105", rpc: s.STORAGE_PAYMENT_RPC || (token === "ethereum" ? "https://ethereum-rpc.publicnode.com" : "https://mainnet.base.org"), maxBytes};
}
export async function irysGet(path: string) {
  const config = irysSettings();
  const response = await fetch(new URL(path, config.endpoint), {signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(`Irys is unavailable (${response.status}). No payment is requested.`);
  return response.json();
}
export async function irysPrice(bytes: number) {
  const c = irysSettings();
  const value = await irysGet(`/price/${c.token}/${bytes}?address=${c.payer}`);
  if (!/^\d+$/.test(String(value))) throw new Error("Irys returned an invalid price.");
  return BigInt(String(value));
}
