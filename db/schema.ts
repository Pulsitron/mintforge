import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
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
