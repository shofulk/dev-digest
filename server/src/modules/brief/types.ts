// RING 1 — pure structural types shared by `service.ts`/`facts.ts`/
// `prompt.ts`/`grounding.ts`. Pulled out of `service.ts` on its own so those
// files depend on ONE leaf module instead of on each other — `facts.ts`
// importing `BriefPrFile` straight from `service.ts` while `service.ts`
// imports `buildBriefFacts` from `facts.ts` is exactly the cycle
// `pnpm arch`'s `no-circular` rule (`tsPreCompilationDeps: true`, so a
// type-only import counts) would flag (`onion-architecture`). No imports of
// its own beyond `@devdigest/shared` types.
import type {
  BlastRadius,
  FeatureModelChoice,
  LLMProvider,
  PrBrief,
  PrIntentRecord,
  ProjectDocsSource,
  Severity,
} from '@devdigest/shared';

/** The minimal shape this service reads off a PR for brief generation. */
export interface BriefPull {
  id: string;
  title: string;
  body: string | null;
  headSha: string;
  lastReviewedSha: string | null;
  clonePath: string | null;
}

/** The minimal shape of a changed file this service reads. */
export interface BriefPrFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

/** One finding this service reads off a persisted review. */
export interface BriefFinding {
  title: string;
  severity: Severity;
  file: string;
  startLine: number | null;
  endLine: number | null;
  rationale: string;
  suggestion: string | null;
  dismissedAt: Date | null;
}

/** The minimal shape of a persisted review this service reads. */
export interface BriefReview {
  kind: 'summary' | 'review';
  agentId: string | null;
  createdAt: Date;
  findings: BriefFinding[];
}

/** Structural subset of `RunBus` this service needs (precedent: `BlastLogger`). */
export interface BriefBus {
  publish(id: string, kind: 'info' | 'result' | 'error', msg: string, data?: unknown): unknown;
  complete(id: string): void;
}

/** Structured logger port — never `req.log`/`FastifyBaseLogger` directly. */
export interface BriefLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/** Every dependency `BriefService` needs, resolved by its caller (`deps.ts`). */
export interface BriefServiceDeps {
  getPull(workspaceId: string, prId: string): Promise<BriefPull | undefined>;
  getPrFiles(prId: string): Promise<BriefPrFile[]>;
  getBrief(prId: string): Promise<PrBrief | null>;
  saveBrief(brief: PrBrief): Promise<void>;
  readIntent(workspaceId: string, prId: string): Promise<PrIntentRecord | null>;
  readBlast(workspaceId: string, prId: string): Promise<BlastRadius>;
  listReviews(prId: string): Promise<BriefReview[]>;
  listEnabledAgentDocs(
    workspaceId: string,
  ): Promise<{ contextDocs: string[]; skills: { name: string; contextDocs: string[] }[] }[]>;
  projectDocs: ProjectDocsSource;
  docRoots: string[];
  maxDocBytes: number;
  tokenizer: { count(text: string): number };
  resolveLlm(workspaceId: string): Promise<{ choice: FeatureModelChoice; llm: LLMProvider }>;
  bus: BriefBus;
  now?: () => Date;
}
