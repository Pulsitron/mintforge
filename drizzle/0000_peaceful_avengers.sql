CREATE TABLE `upload_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`origin` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `upload_quota` (
	`bucket` text PRIMARY KEY NOT NULL,
	`used` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `upload_sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`expires` integer NOT NULL
);
