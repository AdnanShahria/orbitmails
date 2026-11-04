CREATE TABLE "email_router_send_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"provider_cred_id" text NOT NULL,
	"provider" text NOT NULL,
	"to_address" text NOT NULL,
	"subject" text,
	"status" text NOT NULL,
	"provider_message_id" text,
	"error_message" text,
	"latency_ms" bigint DEFAULT 0 NOT NULL,
	"sent_at" bigint NOT NULL,
	"date_bucket" text NOT NULL,
	"html_snippet" text,
	"text_content" text
);
--> statement-breakpoint
CREATE INDEX "email_router_send_logs_project_date_idx" ON "email_router_send_logs" USING btree ("project_id","date_bucket");--> statement-breakpoint
CREATE INDEX "email_router_send_logs_provider_date_idx" ON "email_router_send_logs" USING btree ("provider","date_bucket");--> statement-breakpoint
CREATE INDEX "email_router_send_logs_sent_at_idx" ON "email_router_send_logs" USING btree ("sent_at");