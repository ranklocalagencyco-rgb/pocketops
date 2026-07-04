CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`job_id` text NOT NULL,
	`user_id` text,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `expenses_tenant_idx` ON `expenses` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `expenses_job_idx` ON `expenses` (`job_id`);--> statement-breakpoint
CREATE TABLE `job_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`job_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`uploaded_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `job_photos_tenant_idx` ON `job_photos` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `job_photos_job_idx` ON `job_photos` (`job_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text,
	`direction` text NOT NULL,
	`phone` text NOT NULL,
	`body` text NOT NULL,
	`twilio_sid` text,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_tenant_idx` ON `messages` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `messages_tenant_phone_idx` ON `messages` (`tenant_id`,`phone`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`job_id` text NOT NULL,
	`user_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `time_entries_tenant_idx` ON `time_entries` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `time_entries_job_idx` ON `time_entries` (`job_id`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `quote_accepted_at` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `quote_accepted_name` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `deposit_paid_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `recurrence_months` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `recurrence_spawned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `last_chased_at` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `chase_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `deposit_rate_bps` integer DEFAULT 0 NOT NULL;