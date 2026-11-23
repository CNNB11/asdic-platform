CREATE TABLE "visuals" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"item_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"prompt" text NOT NULL,
	"aspect" text DEFAULT '1:1' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"cost_usd" text DEFAULT '0' NOT NULL,
	"verdict" text DEFAULT 'new' NOT NULL,
	"verdict_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visuals" ADD CONSTRAINT "visuals_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visuals" ADD CONSTRAINT "visuals_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;