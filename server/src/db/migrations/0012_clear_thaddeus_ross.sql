ALTER TABLE "skill_versions" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "skills_used" jsonb;--> statement-breakpoint
CREATE INDEX "skills_workspace_idx" ON "skills" USING btree ("workspace_id");