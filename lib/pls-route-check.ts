import { formatEther, parseEther, ZeroAddress } from "ethers";
import { irysSettings } from "./irys-server";
import { positiveEth } from "./irys-treasury";
import type { PlsRouteCheck } from "./treasury-types";

// Read-only discovery. Never consume, sign or forward provider transaction data.
// A quote is not proof of settlement, supported automation, or complete costs.
export async function checkPlsRoute(value: unknown): Promise<PlsRouteCheck> {
  const amount = positiveEth(value);
  const c = irysSettings();
  let response: Response;
  try {
    response = await fetch("https://api-v2.rubic.exchange/api/routes/quoteBest", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ srcTokenAddress: ZeroAddress, srcTokenBlockchain: "PULSECHAIN",
        srcTokenAmount: formatEther(amount), dstTokenAddress: ZeroAddress,
        dstTokenBlockchain: c.token === "ethereum" ? "ETH" : "BASE", referrer: "mintforge",
        showFailedRoutes: false, showDangerousRoutes: false }),
    });
  } catch { throw new Error("The route service could not be reached. PLS checkout remains unavailable; no funds were moved."); }
  if (!response.ok) throw new Error(`The route service did not provide a quote (${response.status}). PLS checkout remains unavailable; no funds were moved.`);
  const q = await response.json() as {
    tokens?: { from?: { address?: string; blockchainId?: string | number; decimals?: number; amount?: string }; to?: { address?: string; blockchainId?: string | number; decimals?: number } };
    estimate?: { destinationWeiAmount?: string; destinationWeiMinAmount?: string };
    providerType?: string; fees?: { gasTokenFees?: { gas?: { totalWeiAmount?: string }; nativeToken?: { blockchainId?: string | number; decimals?: number } } };
  };
  const from = q?.tokens?.from, to = q?.tokens?.to;
  if (from?.address?.toLowerCase() !== ZeroAddress || String(from.blockchainId) !== "369" || from.decimals !== 18 ||
      to?.address?.toLowerCase() !== ZeroAddress || String(to.blockchainId) !== String(Number(c.paymentChain)) || to.decimals !== 18)
    throw new Error("No verified native-PLS to native-ETH quote was returned for the configured network.");
  let matches = false;
  try { matches = typeof from.amount === "string" && parseEther(from.amount) === amount; } catch {}
  const expected = q.estimate?.destinationWeiAmount, minimum = q.estimate?.destinationWeiMinAmount;
  if (!matches || typeof expected !== "string" || typeof minimum !== "string" ||
      !/^\d{1,78}$/.test(expected) || !/^\d{1,78}$/.test(minimum) || BigInt(minimum) <= 0n || BigInt(expected) < BigInt(minimum))
    throw new Error("The quote did not provide matching input and a valid minimum ETH output. PLS checkout remains unavailable.");
  const gas = q.fees?.gasTokenFees?.gas?.totalWeiAmount;
  const gasToken = q.fees?.gasTokenFees?.nativeToken;
  return { sourceAmount: amount.toString(), destinationChain: c.token === "ethereum" ? "Ethereum mainnet" : "Base mainnet",
    expectedEth: expected, minimumEth: minimum,
    provider: typeof q.providerType === "string" ? q.providerType.slice(0, 100) : "Provider not identified",
    sourceGas: String(gasToken?.blockchainId) === "369" && gasToken?.decimals === 18 && typeof gas === "string" && /^\d{1,78}$/.test(gas) ? gas : null,
    checkedAt: Date.now(), executable: false };
}
