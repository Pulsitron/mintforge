export type TreasuryCheck = { ok: boolean; message: string; value?: string };
export type TreasuryStatus = {
  treasury: string;
  receiver: string;
  chainId: string;
  chainName: string;
  token: string;
  endpoint: string;
  checkedAt: number;
  checks: {
    database: TreasuryCheck;
    wallet: TreasuryCheck;
    credit: TreasuryCheck;
    price: TreasuryCheck;
  };
};
export type FundingPlan = {
  treasury: string;
  chainId: string;
  token: string;
  endpoint: string;
  to: string;
  value: string;
  gasLimit: string;
  gasPrice: string;
  maximumNetworkFee: string;
  maximumTotal: string;
  expires: number;
};
export type PlsRouteCheck = {
  sourceAmount: string;
  destinationChain: string;
  expectedEth: string;
  minimumEth: string;
  provider: string;
  sourceGas: string | null;
  checkedAt: number;
  executable: false;
};
