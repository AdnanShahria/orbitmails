CREATE TABLE `email_router_send_logs` (
	`id` varchar(191) NOT NULL,
	`project_id` varchar(191) NOT NULL,
	`provider_cred_id` longtext NOT NULL,
	`provider` varchar(191) NOT NULL,
	`to_address` longtext NOT NULL,
	`subject` longtext,
	`status` longtext NOT NULL,
	`provider_message_id` longtext,
	`error_message` longtext,
	`latency_ms` bigint NOT NULL DEFAULT 0,
	`sent_at` bigint NOT NULL,
	`date_bucket` varchar(191) NOT NULL,
	`html_snippet` longtext,
	`text_content` longtext,
	CONSTRAINT `email_router_send_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `email_router_send_logs_project_date_idx` ON `email_router_send_logs` (`project_id`,`date_bucket`);--> statement-breakpoint
CREATE INDEX `email_router_send_logs_provider_date_idx` ON `email_router_send_logs` (`provider`,`date_bucket`);--> statement-breakpoint
CREATE INDEX `email_router_send_logs_sent_at_idx` ON `email_router_send_logs` (`sent_at`);