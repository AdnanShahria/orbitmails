ALTER TABLE "app_settings" ADD COLUMN "cf_token" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "cf_oauth_client_id" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "cf_oauth_client_secret" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "cf_oauth_refresh_token" text;