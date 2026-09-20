import { isAddress, hexlify, randomBytes } from "ethers";
import { boundedJson } from "../../../lib/http";
import { database, digest, jsonError, quota, sameOrigin, uploadSession } from "../../../lib/server";
import { irysGet, irysPrice, irysSettings } from "../../../lib/irys-server";
import type { StorageQuote } from "../../../lib/storage-types";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const session = await uploadSession(req), c = irysSettings();
    const body = await boundedJson(req, 256 * 1024);
    const {job, address, sizes, count} = body;
    if (typeof job !== "string" || !/^[a-f0-9]{64}$/.test(job) || typeof address !== "string" || !isAddress(address) || !Number.isInteger(count) || Number(count) < 1 || Number(count) > 10000 || !Array.isArray(sizes) || !sizes.length || sizes.length > 20010 || sizes.some(n => !Number.isSafeInteger(n) || n < 1 || n > 96 * 1024 * 1024)) throw new Error("Invalid collection upload plan.");
    if (sizes.reduce((n: number, v: number) => n + v, 0) > c.maxBytes) throw new Error("Collection exceeds the configured byte budget.");
    const hour = Math.floor(Date.now() / 3600000);
    await quota(`quotes:${hour}:${session.wallet}`, 1, 30);
    await quota(`quotes-ip:${hour}:${await digest(req.headers.get("cf-connecting-ip") || "local")}`, 1, 60);
    // Power-of-two price bands bound provider requests to <=18, even for 10,000 files.
    const bands = sizes.map(n => Math.max(1024, 2 ** Math.ceil(Math.log2(n))));
    const prices = new Map<number, bigint>();
    for (const size of new Set(bands)) prices.set(size, await irysPrice(size));
    const storage = bands.reduce((sum, n) => sum + prices.get(n)!, 0n);
    const reserve = (storage + 9n) / 10n;
    const approvalCost = await irysPrice(4096);
    const allowance = storage + reserve;
    const balance = await irysGet(`/account/balance/${c.token}?address=${c.payer}`) as {balance?: string};
    if (!balance?.balance || BigInt(balance.balance) < allowance + approvalCost) throw new Error("The Irys treasury needs funding before checkout can open.");
    const id = hexlify(randomBytes(32));
    const quote: StorageQuote = {id, job, address, provider:"irys", endpoint:c.endpoint, gateway:c.gateway, token:c.token, paymentChain:c.paymentChain, symbol:"ETH", recipient:c.recipient, data:id, storage:String(storage), reserve:String(reserve), service:String(c.service), approvalCost:String(approvalCost), total:String(allowance + approvalCost + c.service), allowance:String(allowance), payer:c.payer, expires:Date.now() + 15 * 60000, approvalSeconds:30 * 86400};
    await database().prepare("INSERT INTO storage_quotes(id,wallet,job,upload_address,quote,expires) VALUES(?,?,?,?,?,?)").bind(id,session.wallet,job,address.toLowerCase(),JSON.stringify(quote),quote.expires).run();
    return Response.json(quote,{headers:{"Cache-Control":"no-store"}});
  } catch (e) { return jsonError(e); }
}
