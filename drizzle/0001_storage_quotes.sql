CREATE TABLE `storage_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`job` text NOT NULL,
	`upload_address` text NOT NULL,
	`quote` text NOT NULL,
	`expires` integer NOT NULL,
	`payment_tx` text,
	`approval_raw` text,
	`approval_id` text,
	`active` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_quotes_payment_tx_unique` ON `storage_quotes` (`payment_tx`);