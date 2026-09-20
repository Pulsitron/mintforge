import { Interface, keccak256 } from "ethers";

export class SettlementError extends Error {}
export const hex = (n: bigint | number) => `0x${BigInt(n).toString(16)}`;
export type ChainTx = { hash: string; from: string; to: string | null; input: string; value: string; chainId?: string; nonce: string; blockNumber: string | null };
export type ChainReceipt = { status: string; blockNumber: string; blockHash: string; transactionHash: string; logs: { address: string; topics: string[]; data: string }[] };
export class SettlementRpc {
  constructor(readonly url: string, readonly chain: number) {}
  async send<T = string>(method: string, params: unknown[] = []): Promise<T> {
    const res = await fetch(this.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new SettlementError(`Network ${this.chain} is temporarily unavailable. Saved payments will be retried.`);
    const result = await res.json() as { result?: T; error?: { message?: string } };
    if (result.error || !("result" in result)) throw new SettlementError(`Network ${this.chain} could not complete ${method}. Progress is saved.`);
    return result.result as T;
  }
  async verify() {
    if (BigInt(await this.send("eth_chainId")) !== BigInt(this.chain)) throw new SettlementError("The storage RPC is connected to the wrong network.");
  }
  async height() { return Number(BigInt(await this.send("eth_blockNumber"))); }
  async balance(address: string, block: string = "latest") { return BigInt(await this.send("eth_getBalance", [address, block])); }
  async gasPrice() { const price = BigInt(await this.send("eth_gasPrice")); if (price <= 0n) throw new SettlementError("A valid gas price is required."); return price; }
  async codeHash(address: string) { const code = await this.send("eth_getCode", [address, "latest"]); if (code === "0x") throw new SettlementError("A required payment contract is missing."); return keccak256(code); }
  async call(address: string, abi: Interface, method: string, args: unknown[] = [], block = "latest") {
    return abi.decodeFunctionResult(method, await this.send("eth_call", [{ to: address, data: abi.encodeFunctionData(method, args) }, block]));
  }
  async confirmed(hash: string, confirmations: number) {
    const receipt = await this.send<ChainReceipt | null>("eth_getTransactionReceipt", [hash]);
    if (!receipt || (await this.height()) - Number(BigInt(receipt.blockNumber)) + 1 < confirmations) return null;
    const block = await this.send<{ hash: string } | null>("eth_getBlockByNumber", [receipt.blockNumber, false]);
    if (!block || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) return null;
    return receipt;
  }
}
