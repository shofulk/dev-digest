ALTER TABLE "findings" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "confidence" text DEFAULT 'low' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "stats" jsonb;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "derived_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_scope_ck" CHECK ("findings"."scope" is null or "findings"."scope" in ('in', 'out'));--> statement-breakpoint
ALTER TABLE "pr_intent" ADD CONSTRAINT "pr_intent_confidence_ck" CHECK ("pr_intent"."confidence" in ('low', 'medium', 'high'));