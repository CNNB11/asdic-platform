CREATE TABLE "ai_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text,
	"op_id" text,
	"user_id" text,
	"kind" text NOT NULL,
	"step" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"web_searches" integer DEFAULT 0 NOT NULL,
	"cost_usd" text DEFAULT '0' NOT NULL,
	"duration_ms" integer NOT NULL,
	"stop_reason" text,
	"error" text,
	"request_preview" text DEFAULT '' NOT NULL,
	"response_preview" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_ops" ADD COLUMN "outcome" text;