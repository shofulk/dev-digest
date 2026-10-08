ALTER TABLE "skills" ADD COLUMN "context_docs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "context_docs" jsonb DEFAULT '[]'::jsonb NOT NULL;