CREATE TABLE `certificates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`job_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`type` text NOT NULL,
	`cert_number` text NOT NULL,
	`data` text NOT NULL,
	`engineer_name` text NOT NULL,
	`registration_number` text,
	`issued_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `certificates_tenant_idx` ON `certificates` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `certificates_job_idx` ON `certificates` (`job_id`);--> statement-breakpoint
ALTER TABLE `customers` ADD `portal_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `customers_portal_token_idx` ON `customers` (`portal_token`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `cis_reverse_charge` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `time_entries` ADD `lat` real;--> statement-breakpoint
ALTER TABLE `time_entries` ADD `lng` real;