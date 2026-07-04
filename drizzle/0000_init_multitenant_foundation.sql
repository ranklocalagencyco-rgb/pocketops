CREATE TABLE `accounting_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`external_realm_id` text,
	`token_expires_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `acct_conn_tenant_idx` ON `accounting_connections` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `acct_conn_tenant_provider_idx` ON `accounting_connections` (`tenant_id`,`provider`);--> statement-breakpoint
CREATE TABLE `call_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`twilio_call_sid` text NOT NULL,
	`from_number` text NOT NULL,
	`to_number` text NOT NULL,
	`status` text NOT NULL,
	`matched_customer_id` text,
	`text_back_sent_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matched_customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `call_events_twilio_call_sid_unique` ON `call_events` (`twilio_call_sid`);--> statement-breakpoint
CREATE INDEX `call_events_tenant_idx` ON `call_events` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`address_line1` text,
	`address_line2` text,
	`city` text,
	`region` text,
	`postal_code` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `customers_tenant_idx` ON `customers` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `customers_tenant_phone_idx` ON `customers` (`tenant_id`,`phone`);--> statement-breakpoint
CREATE TABLE `job_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`job_id` text NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`unit_cost_cents` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `line_items_tenant_idx` ON `job_line_items` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `line_items_job_idx` ON `job_line_items` (`job_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`assigned_user_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'lead' NOT NULL,
	`client_token` text NOT NULL,
	`scheduled_at` integer,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`stripe_checkout_session_id` text,
	`stripe_payment_intent_id` text,
	`invoiced_at` integer,
	`completed_at` integer,
	`paid_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_tenant_idx` ON `jobs` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `jobs_tenant_status_idx` ON `jobs` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `jobs_tenant_assigned_idx` ON `jobs` (`tenant_id`,`assigned_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_client_token_idx` ON `jobs` (`client_token`);--> statement-breakpoint
CREATE TABLE `ledger_sync_records` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`job_id` text NOT NULL,
	`entity` text NOT NULL,
	`external_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`synced_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connection_id`) REFERENCES `accounting_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_sync_tenant_idx` ON `ledger_sync_records` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `ledger_sync_job_idx` ON `ledger_sync_records` (`job_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`job_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'usd' NOT NULL,
	`method` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`stripe_payment_intent_id` text,
	`paid_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_stripe_payment_intent_id_unique` ON `payments` (`stripe_payment_intent_id`);--> statement-breakpoint
CREATE INDEX `payments_tenant_idx` ON `payments` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `payments_job_idx` ON `payments` (`job_id`);--> statement-breakpoint
CREATE TABLE `review_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`job_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`channel` text NOT NULL,
	`review_link` text NOT NULL,
	`sent_at` integer,
	`clicked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_requests_tenant_idx` ON `review_requests` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_tenant_idx` ON `sessions` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `signatures` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`job_id` text NOT NULL,
	`signer_name` text NOT NULL,
	`image_data_url` text NOT NULL,
	`ip` text,
	`signed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `signatures_tenant_idx` ON `signatures` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `signatures_job_idx` ON `signatures` (`job_id`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`email` text,
	`phone` text,
	`currency` text DEFAULT 'usd' NOT NULL,
	`timezone` text DEFAULT 'America/New_York' NOT NULL,
	`plan` text DEFAULT 'trial' NOT NULL,
	`stripe_account_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_unique` ON `tenants` (`slug`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`role` text DEFAULT 'technician' NOT NULL,
	`hourly_cost_cents` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_tenant_idx` ON `users` (`tenant_id`);