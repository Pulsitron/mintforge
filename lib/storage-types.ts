import type { PlsBudget } from "./pls-types";
export type StorageQuote = {
  id: string; job: string; address: string; provider: "irys"; endpoint: string; gateway: string;
  token: string; paymentChain: string; symbol: string; recipient: string; data: string;
  storage: string; reserve: string; service: string; approvalCost: string; total: string;
  allowance: string; payer: string; expires: number; approvalSeconds: number; paid?: boolean;
  automation?: PlsBudget;
};
export const BATCH_BYTES = 8 * 1024 * 1024;
export const BATCH_COUNT = 200;
// Includes item signatures/tags, bundle headers and the signed outer envelope.
export const batchBound = (bytes: number, count: number) => bytes + count * 2048 + 4096;
export function groupFiles<T extends {size: number}>(files: readonly T[]) {
  const batches: T[][] = []; let batch: T[] = [], bytes = 0;
  for (const file of files) {
    if (batch.length && (bytes + file.size > BATCH_BYTES || batch.length >= BATCH_COUNT)) {
      batches.push(batch); batch = []; bytes = 0;
    }
    batch.push(file); bytes += file.size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
