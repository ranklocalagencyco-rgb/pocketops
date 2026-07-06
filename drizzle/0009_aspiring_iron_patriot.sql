CREATE TABLE `number_port_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`phone_number` text NOT NULL,
	`number_type` text NOT NULL,
	`pac_code` text,
	`account_holder` text NOT NULL,
	`current_provider` text,
	`status` text DEFAULT 'requested' NOT NULL,
	`port_date` integer,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `port_requests_tenant_idx` ON `number_port_requests` (`tenant_id`);--> statement-breakpoint
ALTER TABLE `tenants` ADD `twilio_forward_number` text;