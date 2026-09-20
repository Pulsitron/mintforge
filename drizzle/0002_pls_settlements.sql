CREATE TABLE `storage_settlement_txs` (
	`quote_id` text NOT NULL,
	`step` text NOT NULL,
	`chain_id` integer NOT NULL,
	`raw` text NOT NULL,
	`hash` text NOT NULL,
	PRIMARY KEY(`quote_id`, `step`),
	FOREIGN KEY (`quote_id`) REFERENCES `storage_quotes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_settlement_txs_hash` ON `storage_settlement_txs` (`chain_id`,`hash`);--> statement-breakpoint
CREATE TABLE `storage_settlements` (
	`quote_id` text PRIMARY KEY NOT NULL,
	`stage` text DEFAULT 'awaiting_payment' NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`error` text,
	`next_attempt` integer DEFAULT 0 NOT NULL,
	`updated` integer NOT NULL,
	`lease_owner` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `storage_quotes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `storage_settlements_pending` ON `storage_settlements` (`next_attempt`,`updated`);