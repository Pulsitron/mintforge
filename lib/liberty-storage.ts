import { Interface, Wallet, ZeroAddress, ZeroHash, computeHmac, getAddress, toUtf8Bytes } from "ethers";
import { settings } from "./server";
import { irysSettings } from "./irys-server";
import { SettlementError, SettlementRpc } from "./settlement-rpc";
import type { StorageQuote } from "./storage-types";

// PulseX runtime is verified by the PulseChain explorer. Liberty's runtime pin
// identifies the deployment tested here; it is not a contract audit.
export const PULSE_ROUTER = "0x165C3410fC91EF562C50559f7d2289fEbed552d9";
export const PULSE_ROUTER_HASH = "0xe1e828f98e6b6f64db7ecfbf8b8e0f3c2d554137db960d6a7e49f7a94f5c35d0";
export const LIBERTY_ROUTER = "0xFd84612B395dA9459EF47F9F4598a0be6d9F3e29";
export const LIBERTY_ROUTER_HASH = "0x38949949f27c725179edaed92d5a612e7c18c3907a21522ac309ef852bb3ce17";
export const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
export const WETH = "0x02DcdD04e3F455D838cd1249292C58f3B79e3C3C";
export const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
export const SOURCE_GAS_UNITS = 350000n + 80000n + 500000n + 80000n + 21000n;
export const DEX = new Interface([
  "function WPLS() view returns(address)", "function getAmountsIn(uint256,address[]) view returns(uint256[])",
  "function swapETHForExactTokens(uint256,address[],address,uint256) payable returns(uint256[])",
]);
export const TOKEN = new Interface(["function balanceOf(address) view returns(uint256)", "function decimals() view returns(uint8)", "function approve(address,uint256) returns(bool)", "function transfer(address,uint256) returns(bool)"]);
export const BRIDGE = new Interface(["function swap(uint256,uint256,bytes,uint8,address,bytes32)"]);
export const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
export const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const uint = (v: unknown) => {
  if (typeof v !== "string" || !/^\d{1,78}$/.test(v)) throw new SettlementError("The payment provider returned an invalid amount.");
  return BigInt(v);
};
export function jobSigner(id: string, key = irysSettings().key) {
  if (!/^0x[0-9a-f]{64}$/.test(id)) throw new SettlementError("Invalid storage job ID.");
  // Independent per-job wallets isolate balances and nonces. Never expose the
  // derived key. Retain the master secret while any quote or upload is pending.
  return new Wallet(computeHmac("sha256", key, toUtf8Bytes(`MintForge storage settlement v1:${id}`)));
}
async function providerJson<T>(url: URL | string): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new SettlementError(`LibertySwap cannot quote this route right now (${r.status}). No new payment is requested.`);
  return r.json() as Promise<T>;
}
type TokenInfo = { address?: string; symbol?: string; decimals?: number; chainId?: number };
type QuoteResponse = {
  to?: string; route?: { type?: string }; srcToken?: TokenInfo; destToken?: TokenInfo; srcAmount?: unknown; destAmount?: unknown;
  methodParameters?: { calldata?: string; value?: string };
  approval?: { token?: string; spender?: string; amount?: unknown; calldata?: string };
  fee?: { chainId?: number; token?: string; protocol?: { amount?: unknown }; integrator?: { amount?: unknown }; total?: { amount?: unknown } };
};
export type LibertyQuote = { output: bigint; fee: bigint; data: string; approval: string };
export async function libertyQuote(amount: bigint, chain: number, recipient: string, weth: string, router: string): Promise<LibertyQuote> {
  const url = new URL("https://apis.libertyswap.finance/v3/swap/quote");
  url.search = new URLSearchParams({ srcToken: weth, dstToken: "ETH", amount: String(amount), srcChain: "369", dstChain: String(chain), recipient }).toString();
  const [q, registry] = await Promise.all([providerJson<QuoteResponse>(url), providerJson<{ data?: { chainId: number; symbol: string; router: string }[] }>("https://apis.libertyswap.finance/v3/app/routers")]);
  const entry = Array.isArray(registry?.data) ? registry.data.find(v => v.chainId === 369 && v.symbol === "WETH") : undefined;
  const data = BRIDGE.encodeFunctionData("swap", [chain, amount, recipient, 0, NATIVE, ZeroHash]);
  const approval = TOKEN.encodeFunctionData("approve", [router, amount]);
  if (!q || !entry || !sameAddress(entry.router, router) || !sameAddress(q.to || ZeroAddress, router) || q.route?.type !== "DIRECT" ||
    q.srcToken?.chainId !== 369 || q.srcToken?.decimals !== 18 || !sameAddress(q.srcToken?.address || ZeroAddress, weth) ||
    q.destToken?.chainId !== chain || q.destToken?.decimals !== 18 || q.destToken?.symbol !== "ETH" || ![ZeroAddress, NATIVE].some(a => sameAddress(a, q.destToken?.address || "")) ||
    uint(q.srcAmount) !== amount || uint(q.fee?.integrator?.amount) !== 0n || q.fee?.chainId !== chain || q.fee?.token !== "destination" ||
    q.methodParameters?.calldata?.toLowerCase() !== data.toLowerCase() || BigInt(q.methodParameters?.value || "-1") !== 0n ||
    !sameAddress(q.approval?.token || ZeroAddress, weth) || !sameAddress(q.approval?.spender || ZeroAddress, router) ||
    uint(q.approval?.amount) !== amount || q.approval?.calldata?.toLowerCase() !== approval.toLowerCase()) {
    throw new SettlementError("LibertySwap returned a different route or recipient. Checkout is paused.");
  }
  const output = uint(q.destAmount), fee = uint(q.fee?.total?.amount);
  if (output <= 0n || output + fee !== amount || uint(q.fee?.protocol?.amount) !== fee || fee > ceilDiv(amount, 100n)) throw new SettlementError("LibertySwap's fee or output is outside the supported budget.");
  return { output, fee, data, approval };
}
export async function irysDepositAddress(endpoint: string, token: string) {
  const r = await fetch(new URL("/info", endpoint), { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new SettlementError("Irys funding information is unavailable.");
  const info = await r.json() as { addresses?: Record<string, string> };
  let address: string;
  try { address = getAddress(info.addresses?.[token] || ""); } catch { throw new SettlementError("Irys returned an invalid deposit address."); }
  if (sameAddress(address, ZeroAddress)) throw new SettlementError("Irys returned an invalid deposit address.");
  return address;
}
export async function l1GasBudget(rpc: SettlementRpc) {
  if (rpc.chain !== 8453) return 0n;
  // Base charges an L1 data fee in addition to execution. Use its documented
  // upper-bound API; a repetitive fabricated payload could compress too well.
  const oracle = new Interface(["function getL1FeeUpperBound(uint256) view returns(uint256)"]);
  const fee = (await rpc.call("0x420000000000000000000000000000000000000F", oracle, "getL1FeeUpperBound", [512]))[0] as bigint;
  return fee * 2n;
}
export async function makePlsQuote(q: StorageQuote, customer: string): Promise<StorageQuote> {
  const c = irysSettings(), s = settings();
  if (s.PLS_CHECKOUT_ENABLED !== "true") throw new SettlementError("PLS checkout is not enabled.");
  const destinationChain = Number(c.paymentChain), payer = jobSigner(q.id, c.key).address;
  const sourceRpc = s.PLS_RPC_URL || "https://rpc.pulsechain.com";
  const source = new SettlementRpc(sourceRpc, 369), destination = new SettlementRpc(c.rpc, destinationChain);
  const router = getAddress(s.PLS_SWAP_ROUTER || PULSE_ROUTER), routerHash = s.PLS_SWAP_ROUTER_HASH || PULSE_ROUTER_HASH;
  const bridge = getAddress(s.LIBERTY_ROUTER || LIBERTY_ROUTER), bridgeHash = s.LIBERTY_ROUTER_HASH || LIBERTY_ROUTER_HASH;
  const wrappedPls = getAddress(s.PLS_WRAPPED_NATIVE || WPLS), weth = getAddress(s.PLS_BRIDGE_WETH || WETH);
  const slippageBps = Number(s.PLS_SLIPPAGE_BPS || "100");
  if (!Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 200) throw new SettlementError("PLS swap slippage must be between 10 and 200 basis points.");
  await Promise.all([source.verify(), destination.verify()]);
  const [actualRouter, actualBridge, wrapped, decimals, sourcePrice, destPrice, l1Budget, deposit] = await Promise.all([
    source.codeHash(router), source.codeHash(bridge), source.call(router, DEX, "WPLS"), source.call(weth, TOKEN, "decimals"),
    source.gasPrice(), destination.gasPrice(), l1GasBudget(destination), irysDepositAddress(c.endpoint, c.token),
  ]);
  if (actualRouter !== routerHash || actualBridge !== bridgeHash || !sameAddress(wrapped[0], wrappedPls) || Number(decimals[0]) !== 18) throw new SettlementError("The payment contracts changed. PLS checkout needs review before payment.");
  const addresses = [deposit, customer, ...(c.service > 0n ? [c.recipient] : [])];
  for (const address of addresses) {
    if (await destination.send("eth_getCode", [address, "latest"]) !== "0x") throw new SettlementError("Automatic ETH funding and refunds currently require ordinary receiving wallets.");
  }
  const sourceGasPrice = sourcePrice * 2n, destinationGasPrice = destPrice * 2n;
  const destinationGas = (21000n * destinationGasPrice + l1Budget) * (c.service > 0n ? 3n : 2n);
  const depositAmount = BigInt(q.allowance) + BigInt(q.approvalCost);
  const required = depositAmount + c.service + destinationGas;
  const minimum = 10n ** 16n;
  let bridgeInput = required * 101n / 100n + 1n;
  if (bridgeInput < minimum) bridgeInput = minimum;
  if (bridgeInput > 20n * 10n ** 18n) throw new SettlementError("This storage budget exceeds the supported bridge transaction limit.");
  const quote = await libertyQuote(bridgeInput, destinationChain, payer, weth, bridge);
  if (quote.output < required) throw new SettlementError("The bridge output cannot fund this complete upload budget. Request a fresh quote.");
  const amounts = (await source.call(router, DEX, "getAmountsIn", [bridgeInput, [wrappedPls, weth]]))[0] as bigint[];
  if (amounts.length !== 2 || amounts[0] <= 0n || amounts[1] !== bridgeInput) throw new SettlementError("PulseX cannot price the required WETH amount.");
  const expectedPls = amounts[0], maxPls = ceilDiv(expectedPls * BigInt(10000 + slippageBps), 10000n);
  const sourceGas = sourceGasPrice * SOURCE_GAS_UNITS;
  return { ...q, paymentChain: "0x171", symbol: "PLS", recipient: payer, payer, total: String(maxPls + sourceGas),
    expires: Date.now() + 10 * 60000,
    automation: {
      version: 1, destinationChain, master: c.payer, receiver: c.recipient, customer,
      router, routerHash, bridge, bridgeHash, wrappedPls, weth, bridgeInput: String(bridgeInput), bridgeOutput: String(quote.output), bridgeFee: String(quote.fee),
      expectedPls: String(expectedPls), maxPls: String(maxPls), sourceGas: String(sourceGas), sourceGasPrice: String(sourceGasPrice),
      destinationGas: String(destinationGas), destinationGasPrice: String(destinationGasPrice), l1Budget: String(l1Budget),
      deposit, depositAmount: String(depositAmount), surplus: String(quote.output - required), slippageBps,
      sourceConfirmations: 3, destinationConfirmations: destinationChain === 1 ? 3 : 12,
    },
  };
}
