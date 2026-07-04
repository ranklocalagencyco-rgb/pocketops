CREATE TABLE `price_book_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text DEFAULT 'labor' NOT NULL,
	`description` text NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`unit_cost_cents` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `price_book_tenant_idx` ON `price_book_items` (`tenant_id`);--> statement-breakpoint
ALTER TABLE `tenants` ADD `tax_rate_bps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `missed_call_message` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `review_message` text;