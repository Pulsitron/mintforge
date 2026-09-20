export type Chain = {
  id: string;
  name: string;
  native: string;
  mark: string;
  colour: string;
  rpc: string;
  explorer: string;
};
export const chains: Chain[] = [
  {
    id: "0x171",
    name: "PulseChain",
    native: "PLS",
    mark: "P",
    colour: "#18d99b",
    rpc: "https://rpc.pulsechain.com",
    explorer: "https://scan.pulsechain.com",
  },
  {
    id: "0x1",
    name: "Ethereum",
    native: "ETH",
    mark: "E",
    colour: "#8b7cff",
    rpc: "https://ethereum-rpc.publicnode.com",
    explorer: "https://etherscan.io",
  },
  {
    id: "0x2105",
    name: "Base",
    native: "ETH",
    mark: "B",
    colour: "#3f7cff",
    rpc: "https://mainnet.base.org",
    explorer: "https://basescan.org",
  },
  {
    id: "0x89",
    name: "Polygon",
    native: "POL",
    mark: "M",
    colour: "#a66cff",
    rpc: "https://polygon.drpc.org",
    explorer: "https://polygonscan.com",
  },
  {
    id: "0xa4b1",
    name: "Arbitrum",
    native: "ETH",
    mark: "A",
    colour: "#4da4ef",
    rpc: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
  },
  {
    id: "0x38",
    name: "BNB Chain",
    native: "BNB",
    mark: "N",
    colour: "#f3ba2f",
    rpc: "https://bsc-dataseed.bnbchain.org",
    explorer: "https://bscscan.com",
  },
  {
    id: "0xaa36a7",
    name: "Sepolia testnet",
    native: "ETH",
    mark: "T",
    colour: "#8796aa",
    rpc: "https://ethereum-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.etherscan.io",
  },
];
export function getChain(id: string) {
  const chain = chains.find((c) => BigInt(c.id) === BigInt(id));
  if (!chain) throw new Error("Unsupported network.");
  return chain;
}
