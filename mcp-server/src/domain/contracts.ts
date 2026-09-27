// Ring 0 — domain. The API shapes this package reads, as local interfaces.
//
// These mirror a SUBSET of the contracts in server/src/vendor/shared (named per field
// below). They are not imported from there: the shared contracts are Zod 3 source, and
// under this package's Zod 4 they fail to typecheck (`z.record(enum, …).default({})` in
// contracts/platform.ts — Zod 4 records over an enum key are exhaustive). Only fields this
// package actually reads are declared, so a server-side addition never breaks us; a rename
// or removal does, and is caught by the live smoke check, not by tsc.

/** contracts/findings.ts `Severity`. */
export type Severity = 'CRITICAL' | 'WARNING' | 'SUGGESTION';

/** contracts/knowledge.ts `ConventionCategory`. */
export type ConventionCategory =
  | 'naming'
  | 'structure'
  | 'errors'
  | 'testing'
  | 'imports'
  | 'typing'
  | 'api'
  | 'general';

/** Runtime values for `ConventionCategory`, pinned to the type above (C2). */
export const CONVENTION_CATEGORIES = [
  'naming',
  'structure',
  'errors',
  'testing',
  'imports',
  'typing',
  'api',
  'general',
] as const satisfies readonly ConventionCategory[];

/** contracts/platform.ts `Repo`. */
export interface Repo {
  id: string;
  name: string;
  full_name: string;
}

/** contracts/platform.ts `PrMeta` — `id` is nullish in the contract. */
export interface PrMeta {
  id?: string | null;
  number: number;
  title: string;
}

/** contracts/knowledge.ts `Agent`. */
export interface Agent {
  id: string;
  name: string;
  description: string;
  model: string;
  enabled: boolean;
}

/** contracts/review-api.ts `ReviewRunResponse` (the `runs` part). */
export interface ReviewRunResponse {
  pr_id: string;
  runs: { run_id: string; agent_id: string; agent_name: string }[];
}

/** contracts/trace.ts `RunSummary` — `status` is a nullable free string in the contract. */
export interface RunSummary {
  run_id: string;
  agent_id: string | null;
  agent_name: string | null;
  status: string | null;
  error: string | null;
  ran_at: string | null;
}

/** contracts/review-api.ts `FindingRecord`. */
export interface FindingRecord {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  rationale: string;
  suggestion?: string | null;
  confidence: number;
  dismissed_at: string | null;
}

/** contracts/review-api.ts `ReviewRecord`. */
export interface ReviewRecord {
  id: string;
  run_id: string | null;
  agent_name?: string | null;
  kind: 'summary' | 'review';
  verdict: string | null;
  score: number | null;
  findings: FindingRecord[];
}

/** contracts/knowledge.ts `ConventionCandidate`. */
export interface ConventionCandidate {
  id: string;
  category: ConventionCategory;
  rule: string;
  evidence_path: string;
  evidence_line?: number | null;
  status: 'pending' | 'accepted' | 'rejected';
}
