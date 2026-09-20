import { FetchRequest, JsonRpcProvider, getAddress, parseEther, ZeroAddress } from "ethers";
import { database } from "./server";
import { irysGet, irysPrice, irysSettings } from "./irys-server";
import type { FundingPlan, TreasuryCheck, TreasuryStatus } from "./treasury-types";

export function positiveEth(value: unknown) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/.test(value))
    throw new Error("Enter a positive amount with at most 18 decimal places.");
  const amount = parseEther(value);
  if (amount <= 0n) throw new Error("Enter an amount greater than zero.");
  return amount;
}

export async function irysBalance() {
  const c = irysSettings();
  const data = await irysGet(`/account/balance/${c.token}?address=${c.payer}`) as { balance?: unknown };
  if (!data || typeof data.balance !== "string" || !/^\d{1,78}$/.test(data.balance))
    throw new Error("Irys did not return a valid upload balance.");
  return BigInt(data.balance);
}

async function fundingAddress() {
  const c = irysSettings();
  const data = await irysGet("/info") as { addresses?: Record<string, unknown> };
  const value = data?.addresses?.[c.token];
  if (typeof value !== "string") throw new Error("Irys has no deposit address for the configured network.");
  let address: string;
  try { address = getAddress(value); }
  catch { throw new Error("Irys returned an invalid deposit address."); }
  if (address === ZeroAddress || address.toLowerCase() === c.payer)
    throw new Error("Irys returned an invalid deposit address.");
  return address;
}

async function withRpc<T>(action: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
  const c = irysSettings();
  const request = new FetchRequest(c.rpc);
  request.timeout = 15000;
  const provider = new JsonRpcProvider(request, Number(c.paymentChain), { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
  try {
    // staticNetwork alone trusts configuration; explicitly verify the remote chain.
    const chain = await provider.send("eth_chainId", []);
    if (BigInt(chain) !== BigInt(c.paymentChain))
      throw new Error("The storage RPC is on the wrong network. Correct STORAGE_PAYMENT_RPC in Cloudflare.");
    return await action(provider);
  } finally { provider.destroy(); }
}

async function check(task: () => Promise<TreasuryCheck>, fallback: string): Promise<TreasuryCheck> {
  try { return await task(); }
  catch { return { ok: false, message: fallback }; }
}

export async function treasuryStatus(): Promise<TreasuryStatus> {
  const c = irysSettings();
  const [db, wallet, credit, price] = await Promise.all([
    check(async () => {
      await database().prepare("SELECT id FROM storage_quotes LIMIT 1").first();
      return { ok: true, message: "Upload database and storage quote migration are available." };
    }, "Storage tables are missing or unavailable. Run the supplied deploy command to apply migrations."),
    check(async () => {
      const balance = await withRpc(p => p.getBalance(c.payer));
      return { ok: true, value: balance.toString(), message: balance > 0n ? "ETH available in the storage wallet." : "No ETH in this wallet on the configured funding network." };
    }, "Cannot verify the wallet balance. Check that STORAGE_PAYMENT_RPC serves the configured Ethereum or Base network."),
    check(async () => {
      const balance = await irysBalance();
      return { ok: true, value: balance.toString(), message: balance > 0n ? "Irys reports upload credit. Each collection still needs a live budget check." : "Irys upload credit is zero. ETH in MetaMask is separate from this balance." };
    }, "Cannot read Irys upload credit. No balance is assumed."),
    check(async () => ({ ok: true, value: (await irysPrice(1024 * 1024)).toString(), message: "Live price for 1 MiB of data; collection quotes also cover metadata, envelopes and reserves." }), "Live Irys pricing is unavailable. Checkout must wait for a valid quote."),
  ]);
  return { treasury: getAddress(c.payer), receiver: c.recipient, chainId: c.paymentChain,
    chainName: c.token === "ethereum" ? "Ethereum mainnet" : "Base mainnet", token: c.token,
    endpoint: c.endpoint, checkedAt: Date.now(), checks: { database: db, wallet, credit, price } };
}

export async function prepareFunding(value: unknown): Promise<FundingPlan> {
  const c = irysSettings();
  const amount = positiveEth(value);
  const to = await fundingAddress();
  return withRpc(async p => {
    const [balance, fees, estimatedGas] = await Promise.all([
      p.getBalance(c.payer), p.getFeeData(), p.estimateGas({ from: c.payer, to, value: amount, data: "0x" }),
    ]);
    // Review a bounded gas-price ceiling. The browser sends these exact limits;
    // a slow transaction can be retried by hash without sending another deposit.
    const currentPrice = fees.maxFeePerGas ?? fees.gasPrice;
    if (!currentPrice || currentPrice <= 0n) throw new Error("Cannot estimate the funding network fee.");
    const gasPrice = (currentPrice * 125n + 99n) / 100n;
    const gasLimit = (estimatedGas * 120n + 99n) / 100n;
    const fee = gasPrice * gasLimit;
    if (balance < amount + fee) throw new Error("The storage wallet needs enough ETH for this deposit and its network fee on the selected funding network.");
    return { treasury: getAddress(c.payer), chainId: c.paymentChain, token: c.token, endpoint: c.endpoint,
      to, value: amount.toString(), gasLimit: gasLimit.toString(), gasPrice: gasPrice.toString(),
      maximumNetworkFee: fee.toString(), maximumTotal: (amount + fee).toString(), expires: Date.now() + 120000 };
  });
}

export async function notifyFunding(hash: unknown) {
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash))
    throw new Error("Enter the deposit transaction hash from your wallet.");
  const c = irysSettings();
  const to = await fundingAddress();
  const amount = await withRpc(async p => {
    const [tx, receipt] = await Promise.all([p.getTransaction(hash), p.getTransactionReceipt(hash)]);
    if (!tx || !receipt || await receipt.confirmations() < 2)
      throw new Error("The deposit needs two network confirmations. Keep this transaction hash and check again; do not send another deposit.");
    if (receipt.status !== 1) throw new Error("This transaction did not succeed. Check it in your wallet before preparing a new deposit.");
    if (tx.chainId !== BigInt(c.paymentChain) || tx.from.toLowerCase() !== c.payer ||
        tx.to?.toLowerCase() !== to.toLowerCase() || tx.value <= 0n || tx.data !== "0x")
      throw new Error("This is not a plain ETH deposit from the configured storage wallet to this Irys node on the configured network.");
    return tx.value;
  });
  // Official Irys Fund.submitFundTransaction protocol. This only resubmits the
  // existing on-chain hash. It cannot sign, broadcast or repeat an ETH transfer.
  let response: Response;
  try {
    response = await fetch(new URL(`/account/balance/${c.token}`, c.endpoint), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx_id: hash }), signal: AbortSignal.timeout(15000),
    });
  } catch { throw new Error("Irys did not acknowledge this deposit yet. Keep the saved hash and retry notification; do not pay again."); }
  if (response.status !== 200 && response.status !== 202)
    throw new Error("Irys did not acknowledge this deposit yet. Keep the saved hash and retry notification; do not pay again.");
  return { hash, amount: amount.toString(), accepted: true,
    message: "Irys accepted the transaction notification. Refresh upload credit to check processing. Notification acceptance alone does not prove the balance has been credited." };
}
