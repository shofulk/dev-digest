// Ring 1 — application. The four use cases behind the MCP tools (rev 3): resolve, the
// AgentDisabled gate, run selection, findings shaping and the conventions filter all
// live here so `src/tools/*.ts` stay a thin parse → call → format shell.
import type {
  Agent,
  BlastCaller,
  BlastDegradedReason,
  ChangedSymbol,
  ConventionCandidate,
  DownstreamImpact,
} from '../domain/contracts.js';
import { AgentDisabled, NoRun, ReviewMissing, RunNotFound } from '../domain/errors.js';
import type { ConciseFinding, DetailedFinding, ResponseFormat } from '../domain/findings.js';
import { reviewForRun, selectRun, shapeReview, truncate } from '../domain/findings.js';
import type { DevDigestApi } from '../domain/ports.js';
import { resolveAgent, resolvePr, resolveRepo } from './resolve.js';
import { runAndWait } from './run-review.js';
import type { Severity } from '../domain/contracts.js';

export interface RunOutcome {
  status: 'done' | 'running' | 'failed' | 'cancelled';
  run_id: string;
  agent: string | null;
  verdict: string | null;
  score: number | null;
  total: number;
  findings: (ConciseFinding | DetailedFinding)[];
  error?: string | null;
}

export interface FindingsOptions {
  minSeverity?: Severity;
  limit: number;
  format: ResponseFormat;
  textMax: number;
}

function pendingOutcome(
  status: 'running' | 'failed' | 'cancelled',
  runId: string,
  agent: string | null,
  textMax: number,
  error: string | null = null,
): RunOutcome {
  return { status, run_id: runId, agent, verdict: null, score: null, total: 0, findings: [], error: error == null ? null : truncate(error, textMax) };
}

// ---- list_agents ----

export interface ConciseAgent {
  id: string;
  name: string;
  description: string;
  model: string;
  enabled: boolean;
}

export async function listAgents(api: DevDigestApi, opts: { textMax: number }): Promise<{ agents: ConciseAgent[] }> {
  const agents = await api.listAgents();
  // Pick only the declared fields — the real API's Agent row carries several more
  // (system_prompt, output_schema, …) that must never reach the model (C4 budget).
  return {
    agents: agents.map((a: Agent) => ({
      id: a.id,
      name: a.name,
      description: truncate(a.description, opts.textMax),
      model: a.model,
      enabled: a.enabled,
    })),
  };
}

// ---- run_agent_on_pr ----

export interface RunAgentOnPrTarget {
  repo: string;
  pr: number;
  agent: string;
}

export interface RunAgentOnPrOptions extends FindingsOptions {
  deadlineAt: number;
  pollMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export async function runAgentOnPr(api: DevDigestApi, target: RunAgentOnPrTarget, opts: RunAgentOnPrOptions): Promise<RunOutcome> {
  const repo = await resolveRepo(api, target.repo);
  const pr = await resolvePr(api, repo.id, repo.full_name, target.pr);
  const agent = await resolveAgent(api, target.agent);
  if (!agent.enabled) throw new AgentDisabled(agent.name);

  const result = await runAndWait(
    api,
    { prId: pr.id, agentId: agent.id },
    { deadlineAt: opts.deadlineAt, pollMs: opts.pollMs, sleep: opts.sleep, now: opts.now },
  );

  if (result.status === 'done') {
    const shaped = shapeReview(result.review, { minSeverity: opts.minSeverity, limit: opts.limit, format: opts.format, textMax: opts.textMax });
    return { status: 'done', run_id: result.run_id, agent: agent.name, ...shaped };
  }
  if (result.status === 'running') {
    return pendingOutcome('running', result.run_id, agent.name, opts.textMax);
  }
  return pendingOutcome(result.status, result.run_id, agent.name, opts.textMax, result.error);
}

// ---- get_findings ----

export interface GetFindingsTarget {
  repo: string;
  pr: number;
  agent?: string;
  runId?: string;
}

export async function getFindings(api: DevDigestApi, target: GetFindingsTarget, opts: FindingsOptions): Promise<RunOutcome> {
  const repo = await resolveRepo(api, target.repo);
  const pr = await resolvePr(api, repo.id, repo.full_name, target.pr);
  const agent = target.agent ? await resolveAgent(api, target.agent) : undefined;

  const runs = await api.listRuns(pr.id);
  if (runs.length === 0) {
    throw new NoRun(repo.full_name, target.pr, agent?.name ?? null);
  }

  const selected = selectRun(runs, { runId: target.runId, agentId: agent?.id });
  if (!selected) {
    if (target.runId) throw new RunNotFound(target.runId, repo.full_name, target.pr);
    throw new NoRun(repo.full_name, target.pr, agent?.name ?? null);
  }

  // A null/unknown status is treated as still running (C7 pitfall).
  const status = selected.status;
  if (status === 'done') {
    const reviews = await api.listReviews(pr.id);
    const review = reviewForRun(reviews, selected.run_id);
    if (!review) throw new ReviewMissing(selected.run_id);
    const shaped = shapeReview(review, opts);
    return { status: 'done', run_id: selected.run_id, agent: selected.agent_name, ...shaped };
  }
  if (status === 'failed' || status === 'cancelled') {
    return pendingOutcome(status, selected.run_id, selected.agent_name, opts.textMax, selected.error);
  }
  return pendingOutcome('running', selected.run_id, selected.agent_name, opts.textMax);
}

// ---- get_conventions ----

export interface ConciseConvention {
  category: ConventionCandidate['category'];
  rule: string;
  evidence: string;
}

// ---- get_blast_radius ----

export interface GetBlastRadiusTarget {
  repo: string;
  pr: number;
}

export interface ConciseChangedSymbol {
  name: string;
  file: string;
  kind: string;
}

export interface ConciseCaller {
  name: string;
  file: string;
  line: number;
  depth: 1 | 2 | null;
  via: string | null;
}

export interface ConciseDownstream {
  symbol: string;
  callers: ConciseCaller[];
  endpoints_affected: string[];
  crons_affected: string[];
}

export interface BlastRadiusOutcome {
  repo: string;
  pr: number;
  summary: string;
  degraded: boolean | null;
  reason: BlastDegradedReason;
  limits: { max_callers_per_symbol: number; bfs_depth: number } | null;
  changed_symbols: ConciseChangedSymbol[];
  downstream: ConciseDownstream[];
}

function conciseCaller(c: BlastCaller, textMax: number): ConciseCaller {
  return {
    name: truncate(c.name, textMax),
    file: truncate(c.file, textMax),
    line: c.line,
    depth: c.depth === 2 ? 2 : c.depth === 1 ? 1 : null,
    via: c.via ? truncate(c.via, textMax) : null,
  };
}

function conciseChangedSymbol(s: ChangedSymbol, textMax: number): ConciseChangedSymbol {
  return { name: truncate(s.name, textMax), file: truncate(s.file, textMax), kind: s.kind };
}

function conciseDownstream(d: DownstreamImpact, textMax: number): ConciseDownstream {
  return {
    symbol: truncate(d.symbol, textMax),
    callers: d.callers.map((c) => conciseCaller(c, textMax)),
    endpoints_affected: d.endpoints_affected.map((e) => truncate(e, textMax)),
    crons_affected: d.crons_affected.map((c) => truncate(c, textMax)),
  };
}

/**
 * D7 — returns the route's own field names (`endpoints_affected`,
 * `crons_affected`, caller `depth`/`via`, `limits.bfs_depth`); only `repo`/
 * `pr` are added. Every field is built by explicit mapping (C9: a spread
 * leaked `list_agents`' internal fields once) so a server-side field the
 * client never asked for cannot reach the model.
 */
export async function getBlastRadius(
  api: DevDigestApi,
  target: GetBlastRadiusTarget,
  opts: { textMax: number },
): Promise<BlastRadiusOutcome> {
  const repo = await resolveRepo(api, target.repo);
  const pr = await resolvePr(api, repo.id, repo.full_name, target.pr);
  const blast = await api.getBlastRadius(pr.id);
  return {
    repo: repo.full_name,
    pr: target.pr,
    summary: truncate(blast.summary, opts.textMax),
    degraded: blast.degraded ?? null,
    reason: blast.reason ?? null,
    limits: blast.limits
      ? { max_callers_per_symbol: blast.limits.max_callers_per_symbol, bfs_depth: blast.limits.bfs_depth }
      : null,
    changed_symbols: blast.changed_symbols.map((s) => conciseChangedSymbol(s, opts.textMax)),
    downstream: blast.downstream.map((d) => conciseDownstream(d, opts.textMax)),
  };
}

export async function getConventions(
  api: DevDigestApi,
  target: { repo: string; category?: ConventionCandidate['category'] },
  opts: { textMax: number },
): Promise<{ repo: string; total: number; conventions: ConciseConvention[] }> {
  const repo = await resolveRepo(api, target.repo);
  const all = await api.listConventions(repo.id);
  const accepted = all
    .filter((c) => c.status === 'accepted')
    .filter((c) => !target.category || c.category === target.category)
    .map((c) => {
      const path = truncate(c.evidence_path, opts.textMax);
      return {
        category: c.category,
        rule: truncate(c.rule, opts.textMax),
        evidence: c.evidence_line != null ? `${path}:${c.evidence_line}` : path,
      };
    });
  return { repo: repo.full_name, total: accepted.length, conventions: accepted };
}
