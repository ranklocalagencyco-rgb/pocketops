CREATE TABLE `tenant_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`share_token` text NOT NULL,
	`show_on_portal` integer DEFAULT true NOT NULL,
	`uploaded_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tenant_docs_tenant_idx` ON `tenant_documents` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_docs_share_idx` ON `tenant_documents` (`share_token`);