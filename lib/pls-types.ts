export type PlsBudget = {
  version: 1; destinationChain: number;
  master: string; receiver: string; customer: string;
  router: string; routerHash: string; wrappedPls: string; weth: string;
  bridge: string; bridgeHash: string; bridgeInput: string; bridgeOutput: string; bridgeFee: string;
  expectedPls: string; maxPls: string; sourceGas: string; sourceGasPrice: string;
  destinationGas: string; destinationGasPrice: string; l1Budget: string;
  deposit: string; depositAmount: string; surplus: string;
  slippageBps: number; sourceConfirmations: number; destinationConfirmations: number;
};
export type SettlementStage = "awaiting_payment" | "swapping" | "approving_bridge" | "bridging" | "waiting_bridge" | "funding_irys" | "waiting_credit" | "authorizing" | "returning_surplus" | "complete" | "refunding" | "refunded" | "needs_attention";
export type SettlementProgress = {
  id: string; stage: SettlementStage; active: boolean; message: string; error?: string;
  transactions: { step: string; chain: number; hash: string }[];
  refunds: { symbol: string; chain: number; amount: string }[];
};
export type SettlementState = {
  refunds?: SettlementProgress["refunds"]; reason?: string; bridgeStarted?: number;
};
