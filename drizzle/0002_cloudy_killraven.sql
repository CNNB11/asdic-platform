CREATE TABLE "stage_closures" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"stage_key" text NOT NULL,
	"closed_by" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stage_closures" ADD CONSTRAINT "stage_closures_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;