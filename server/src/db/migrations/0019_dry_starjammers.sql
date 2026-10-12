CREATE INDEX "ci_runs_installation_idx" ON "ci_runs" USING btree ("ci_installation_id");--> statement-breakpoint
CREATE INDEX "ci_runs_agent_run_idx" ON "ci_runs" USING btree ("agent_run_id");