export const INDEXERS: Record<string, { name: string; base: string | null; rpc: string }> = {
  "0x171": { name: "PulseChain", base: "https://api.scan.pulsechain.com", rpc: "https://rpc.pulsechain.com" },
  "0x1": { name: "Ethereum", base: "https://eth.blockscout.com", rpc: "https://eth-mainnet.g.alchemy.com/public" },
  "0x2105": { name: "Base", base: "https://base.blockscout.com", rpc: "https://mainnet.base.org" },
  "0x89": { name: "Polygon", base: "https://polygon.blockscout.com", rpc: "https://polygon.drpc.org" },
  "0xa4b1": { name: "Arbitrum", base: "https://arbitrum.blockscout.com", rpc: "https://arb1.arbitrum.io/rpc" },
  "0x38": { name: "BNB Chain", base: null, rpc: "https://bsc-dataseed.bnbchain.org" },
  "0xaa36a7": { name: "Sepolia testnet", base: "https://eth-sepolia.blockscout.com", rpc: "https://ethereum-sepolia-rpc.publicnode.com" },
};
