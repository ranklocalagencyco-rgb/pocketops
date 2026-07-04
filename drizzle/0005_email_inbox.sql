CREATE TABLE `email_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider` text NOT NULL,
	`email_address` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`token_expires_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`last_synced_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `email_accounts_tenant_idx` ON `email_accounts` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_accounts_tenant_provider_idx` ON `email_accounts` (`tenant_id`,`provider`);--> statement-breakpoint
ALTER TABLE `messages` ADD `kind` text DEFAULT 'sms' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `subject` text;