import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  InterfaceAbi,
  isAddress,
  formatUnits,
  ZeroAddress,
} from "ethers";
import { getChain } from "./chains";
export type Deployment = {
  factory: string;
  market: string;
  staking: string;
  block?: number;
};
export type ContractName =
  | "MintForge721"
  | "MintForge404"
  | "MintForge1155"
  | "MintForgeFactory"
  | "MintForgeMarket"
  | "MintForgeStaking";
export type Artifact = { abi: InterfaceAbi; bytecode: string };
const artifacts = new Map<string, Promise<Artifact>>();
export async function artifact(name: ContractName) {
  if (!artifacts.has(name))
    artifacts.set(
      name,
      fetch("/contracts/" + name + ".json").then(async (r) => {
        if (!r.ok) throw new Error("Contract package unavailable.");
        return r.json();
      }),
    );
  return artifacts.get(name)!;
}
export async function deployment(chainId: string): Promise<Deployment | null> {
  const r = await fetch("/deployments.json", { cache: "no-store" });
  if (!r.ok) throw new Error("Network configuration unavailable.");
  const data = (await r.json()) as { networks?: Record<string, Deployment> };
  return data.networks?.[String(Number(chainId))] || null;
}
const providers = new Map<string, JsonRpcProvider>();
export function reader(chainId: string) {
  if (!providers.has(chainId))
    providers.set(
      chainId,
      new JsonRpcProvider(getChain(chainId).rpc, Number(chainId), {
        staticNetwork: true,
        batchMaxCount: 1,
      }),
    );
  return providers.get(chainId)!;
}
export async function signer(chainId: string, wallet?: string) {
  if (!window.ethereum)
    throw new Error(
      "Open MintForge in MetaMask or Rabby, or install an EVM wallet.",
    );
  const chain = getChain(chainId);
  const current = await window.ethereum.request({ method: "eth_chainId" });
  if (BigInt(String(current)) !== BigInt(chain.id)) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chain.id }],
      });
    } catch (e) {
      if ((e as { code?: number }).code !== 4902) throw e;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chain.id,
            chainName: chain.name,
            nativeCurrency: {
              name: chain.native,
              symbol: chain.native,
              decimals: 18,
            },
            rpcUrls: [chain.rpc],
            blockExplorerUrls: [chain.explorer],
          },
        ],
      });
    }
  }
  const provider = new BrowserProvider(window.ethereum);
  const s = await provider.getSigner();
  if (
    BigInt(String(await window.ethereum.request({ method: "eth_chainId" }))) !==
    BigInt(chainId)
  )
    throw new Error("Switch to " + chain.name + " in your wallet.");
  if (wallet && (await s.getAddress()).toLowerCase() !== wallet.toLowerCase())
    throw new Error("Wallet account changed. Refresh before continuing.");
  return s;
}
export async function contract(
  name: ContractName,
  address: string,
  chainId: string,
  write = false,
  wallet?: string,
) {
  if (!isAddress(address) || address === ZeroAddress)
    throw new Error("Contract address is not configured.");
  const abi = (await artifact(name)).abi;
  const runner = write ? await signer(chainId, wallet) : reader(chainId);
  if ((await reader(chainId).getCode(address)) === "0x")
    throw new Error("No contract at this address on the selected network.");
  return new Contract(address, abi, runner);
}
export async function confirmed(
  tx: Promise<unknown> | unknown,
  onHash?: (hash: string) => void,
) {
  const t = (await tx) as {
    hash: string;
    wait: (
      n: number,
    ) => Promise<{ status: number | null; hash: string } | null>;
  };
  onHash?.(t.hash);
  const r = await t.wait(1);
  if (!r || r.status !== 1)
    throw new Error("Transaction failed. Nothing was completed.");
  return r;
}
export function errorText(error: unknown) {
  const e = error as {
    code?: string | number;
    shortMessage?: string;
    reason?: string;
    message?: string;
  };
  if (e.code === 4001 || e.code === "ACTION_REJECTED")
    return "Cancelled in your wallet. No transaction was submitted.";
  return (
    e.reason ||
    e.shortMessage ||
    e.message ||
    "Unable to complete this action. Please try again."
  );
}
export const short = (s: string) =>
  s ? s.slice(0, 6) + "…" + s.slice(-4) : "—";
export function amount(v: bigint, decimals = 18) {
  const s = formatUnits(v, decimals);
  const [a, b] = s.split(".");
  return b ? `${a}.${b.slice(0, 6).replace(/0+$/, "") || "0"}` : a;
}
export const tokenABI = [
  "function approve(address,uint256) returns(bool)",
  "function getApproved(uint256) view returns(address)",
  "function isApprovedForAll(address,address) view returns(bool)",
  "function setApprovalForAll(address,bool)",
  "function ownerOf(uint256) view returns(address)",
  "function balanceOf(address,uint256) view returns(uint256)",
  "function decimals() view returns(uint8)",
  "function symbol() view returns(string)",
];
export async function approveNft(
  nft: string,
  id: string,
  operator: string,
  is1155: boolean,
  chainId: string,
  wallet: string,
  onHash?: (h: string) => void,
) {
  const s = await signer(chainId, wallet);
  const c = new Contract(nft, tokenABI, s);
  if (is1155) {
    if (!(await c.isApprovedForAll(wallet, operator)))
      await confirmed(c.setApprovalForAll(operator, true), onHash);
  } else if (
    (await c.getApproved(id)).toLowerCase() !== operator.toLowerCase() &&
    !(await c.isApprovedForAll(wallet, operator))
  ) {
    await confirmed(c.approve(operator, id), onHash);
  }
}
export async function rewardInfo(address: string, chainId: string) {
  if (address === ZeroAddress)
    return { symbol: getChain(chainId).native, decimals: 18 };
  const c = new Contract(address, tokenABI, reader(chainId));
  const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()]);
  return { symbol: String(symbol), decimals: Number(decimals) };
}
export function ipfs(uri: string) {
  if (uri.startsWith("ipfs://")) return "https://ipfs.io/ipfs/" + uri.slice(7);
  try {
    const u = new URL(uri);
    return ["https:", "http:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}
