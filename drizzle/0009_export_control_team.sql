CREATE TABLE "goal_checkins" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"item_id" text NOT NULL,
	"period_date" text NOT NULL,
	"value" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "brand" jsonb;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "control" jsonb;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "team" jsonb;--> statement-breakpoint
ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "goal_checkins_item_period" ON "goal_checkins" USING btree ("item_id","period_date");