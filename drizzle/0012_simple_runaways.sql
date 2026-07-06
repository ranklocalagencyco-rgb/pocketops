CREATE TABLE `cancel_reasons` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cancel_reasons_tenant_idx` ON `cancel_reasons` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `job_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `job_sources_tenant_idx` ON `job_sources` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `sms_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sms_templates_tenant_idx` ON `sms_templates` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `web_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`token` text NOT NULL,
	`intro` text,
	`source_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `job_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `web_forms_tenant_idx` ON `web_forms` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `web_forms_token_idx` ON `web_forms` (`token`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `source_id` text REFERENCES job_sources(id);--> statement-breakpoint
ALTER TABLE `jobs` ADD `cancelled_reason` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `quiet_hours_start` text DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `quiet_hours_end` text DEFAULT '20:00' NOT NULL;