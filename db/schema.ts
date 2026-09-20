import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from "drizzle-orm/sqlite-core";
export const uploadNonces = sqliteTable("upload_nonces", {
  nonce: text("nonce").primaryKey(),
  wallet: text("wallet").notNull(),
  origin: text("origin").notNull(),
  expires: integer("expires").notNull(),
});
export const uploadSessions = sqliteTable("upload_sessions", {
  token: text("token").primaryKey(),
  wallet: text("wallet").notNull(),
  expires: integer("expires").notNull(),
});
export const uploadQuota = sqliteTable("upload_quota", {
  bucket: text("bucket").primaryKey(),
  used: integer("used").notNull(),
});

export const storageQuotes = sqliteTable("storage_quotes", {
  id: text("id").primaryKey(), wallet: text("wallet").notNull(), job: text("job").notNull(),
  uploadAddress: text("upload_address").notNull(), quote: text("quote").notNull(), expires: integer("expires").notNull(),
  paymentTx: text("payment_tx").unique(), approvalRaw: text("approval_raw"), approvalId: text("approval_id"), active: integer("active").notNull().default(0),
});
export const storageSettlements = sqliteTable("storage_settlements", {
  quoteId: text("quote_id").primaryKey().references(() => storageQuotes.id),
  stage: text("stage").notNull().default("awaiting_payment"), data: text("data").notNull().default("{}"),
  error: text("error"), nextAttempt: integer("next_attempt").notNull().default(0), updated: integer("updated").notNull(),
  leaseOwner: text("lease_owner"), leaseUntil: integer("lease_until").notNull().default(0),
}, t => [index("storage_settlements_pending").on(t.nextAttempt, t.updated)]);
export const storageSettlementTxs = sqliteTable("storage_settlement_txs", {
  quoteId: text("quote_id").notNull().references(() => storageQuotes.id), step: text("step").notNull(),
  chainId: integer("chain_id").notNull(), raw: text("raw").notNull(), hash: text("hash").notNull(),
}, t => [primaryKey({columns:[t.quoteId,t.step]}), uniqueIndex("storage_settlement_txs_hash").on(t.chainId,t.hash)]);
