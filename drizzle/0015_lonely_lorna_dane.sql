ALTER TABLE `users` ADD `notify_job_assigned` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `notify_tomorrow_digest` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `notify_invoice_chased` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `notify_stale_leads` integer DEFAULT true NOT NULL;