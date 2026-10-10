/**
 * CI change detector for the harness evals.
 *
 * Reads a newline-separated list of changed files (repo-relative) from $CHANGED_FILES and maps
 * them onto the eval suites that should run for this PR:
 *
 *   .claude/skills/<name>/**   OR  evals/skills/<name>/**   → run evals/skills/<name>  (content tier)
 *   .claude/agents/<name>.md   OR  evals/agents/<name>/**   → run evals/agents/<name>  (tool tier)
 *   CLAUDE.md / AGENTS.md (root or package) / .claude/settings.json / any agent → workflow tier
 *   evals/src/** (the engine) or EVAL_RUN_ALL=1 (manual dispatch) → every suite that has evals
 *
 * A changed artifact with NO written evals is NOT a failure: it is reported on the `skipped_*`
 * outputs so the job can print a visible "SKIP <name> (no evals)" line instead of going red.
 *
 * Emits GitHub Actions step outputs (skills, agents, run_workflow, needs_proxy, anything,
 * skipped_skills, skipped_agents)
 * to $GITHUB_OUTPUT. Pure filesystem + string work — no deps.
 */

import { existsSync, readdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(EVALS_DIR, "..");

const changed = (process.env.CHANGED_FILES ?? "")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

/** Does evals/<tier>/<name>/ contain at least one *.eval.ts? */
function hasEvals(tier, name) {
  const dir = join(EVALS_DIR, tier, name);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => f.endsWith(".eval.ts"));
}

/** Collect distinct artifact names touched under a `.claude` and/or `evals` prefix. */
function touched(reClaude, reEvals) {
  const names = new Set();
  for (const f of changed) {
    const m = f.match(reClaude) ?? f.match(reEvals);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

// The engine (or a manual "run everything") invalidates every result, so every artifact with evals runs.
const runAll =
  process.env.EVAL_RUN_ALL === "1" || changed.some((f) => /^evals\/(src\/|package\.json$|pnpm-lock\.yaml$|vitest\.config\.ts$)/.test(f));

/** Every artifact name that has an evals/<tier>/<name>/ folder. */
function allWithEvals(tier) {
  const dir = join(EVALS_DIR, tier);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => hasEvals(tier, n)).sort();
}

const skillNames = touched(
  /^\.claude\/skills\/([^/]+)\//,
  /^evals\/skills\/([^/]+)\//,
);
const agentNames = touched(
  /^\.claude\/agents\/([^/]+)\.md$/,
  /^evals\/agents\/([^/]+)\//,
);

const skills = runAll ? allWithEvals("skills") : skillNames.filter((n) => hasEvals("skills", n));
const skippedSkills = skillNames.filter((n) => !hasEvals("skills", n));
const agents = runAll ? allWithEvals("agents") : agentNames.filter((n) => hasEvals("agents", n));
const skippedAgents = agentNames.filter((n) => !hasEvals("agents", n));

// The workflow tier measures the LIVE harness, so anything that changes it re-triggers it.
// CLAUDE.md is only a shell that imports AGENTS.md — the instructions live in AGENTS.md (root and
// one per package), so both count. Settings carry the hooks that shape a session, so they count too.
const runWorkflow =
  runAll ||
  changed.some(
    (f) =>
      /^(?:[^/]+\/)?(?:CLAUDE|AGENTS)\.md$/.test(f) ||
      f === ".claude/CLAUDE.md" ||
      f === ".claude/settings.json" ||
      /^\.claude\/agents\/.+\.md$/.test(f) ||
      /^evals\/workflow\//.test(f),
  );
const hasEvalsWorkflow = existsSync(join(EVALS_DIR, "workflow")) &&
  readdirSync(join(EVALS_DIR, "workflow")).some((f) => f.endsWith(".eval.ts"));
const workflow = runWorkflow && hasEvalsWorkflow;

const out = process.env.GITHUB_OUTPUT;
const write = (k, v) => (out ? appendFileSync(out, `${k}=${v}\n`) : console.log(`${k}=${v}`));

write("skills", JSON.stringify(skills));
write("agents", JSON.stringify(agents));
write("run_workflow", String(workflow));
write("needs_proxy", String(agents.length > 0 || workflow));
write("anything", String(skills.length > 0 || agents.length > 0 || workflow));
write("skipped_skills", skippedSkills.join(" "));
write("skipped_agents", skippedAgents.join(" "));

// Human-readable summary in the step log.
console.error("── eval change detection ──");
console.error(`changed files : ${changed.length}`);
console.error(`skills → run  : ${skills.join(", ") || "(none)"}`);
console.error(`agents → run  : ${agents.join(", ") || "(none)"}`);
console.error(`run all       : ${runAll}`);
console.error(`workflow tier : ${workflow ? "run" : runWorkflow ? "SKIP (no evals/workflow/*.eval.ts)" : "skip (not triggered)"}`);
if (skippedSkills.length) console.error(`SKIP skills (no evals): ${skippedSkills.join(", ")}`);
if (skippedAgents.length) console.error(`SKIP agents (no evals): ${skippedAgents.join(", ")}`);
if (!skills.length && !agents.length && !workflow) console.error("nothing to evaluate — no changed artifact has evals");
