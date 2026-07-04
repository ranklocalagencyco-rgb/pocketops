ALTER TABLE `tenants` ADD `twilio_number` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `review_link_url` text;--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_twilio_number_unique` ON `tenants` (`twilio_number`);