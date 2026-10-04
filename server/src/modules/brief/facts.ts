// RING 1 — pure functions. Assembles the one fact set a PR Brief generation
// job renders into its single prompt (D6/D7, AC-1..AC-11, AC-14). No I/O, no
// model call — `BriefServiceDeps` already resolved every input (pull, files,
// intent, blast, reviews, documents) before `buildBriefFacts` runs; the only
// async work left here is reading already-fetched project-context documents
// through the injected `ProjectDocsSource` (`_shared/project-context/resolve.js`).
import type { BlastRadius, MissingInput, PrIntentRecord, Severity } from '@devdigest/shared';
import type { ProjectDocsSource } from '@devdigest/shared';
import { extractHunkHeaders } from '../_shared/intent/references.js';
import { resolveProjectContext } from '../_shared/project-context/resolve.js';
import type { BriefPrFile, BriefReview } from './types.js';
import { BRIEF_DOC_TOKEN_BUDGET } from './constants.js';

/** One changed file, described only by path/+/- and hunk header lines — the
 *  diff body never reaches this shape (AC-2). */
export interface BriefFactFile {
  path: string;
  additions: number;
  deletions: number;
  headers: string[];
}

/** One review finding, stripped to the fields the model is allowed to see
 *  (AC-9 — rationale/suggestion never cross into a fact). */
export interface BriefFactFinding {
  title: string;
  severity: Severity;
  file: string;
  startLine: number | null;
  endLine: number | null;
}

/** One resolved project-context document, already read and budgeted. */
export interface BriefFactDocument {
  path: string;
  content: string;
}

export interface BriefFactIntent {
  text: string;
  inScope: string[];
  outOfScope: string[];
  stale: boolean;
}

export interface BriefFactBlast {
  summary: string;
  degraded: boolean;
  reason: string | null;
}

/** The complete, model-call-free fact set (AC-1). `fitToBudget` (below) is
 *  the only thing allowed to shrink `documents`/`findings`/`files` further. */
export interface BriefFacts {
  title: string;
  description: string | null;
  intent: BriefFactIntent | null;
  blast: BriefFactBlast;
  files: BriefFactFile[];
  totals: { files: number; additions: number; deletions: number };
  findings: BriefFactFinding[];
  findingsStale: boolean;
  documents: BriefFactDocument[];
  missingInputs: MissingInput[];
}

export interface BuildBriefFactsInput {
  pull: { title: string; body: string | null; headSha: string; lastReviewedSha: string | null; clonePath: string | null };
  files: BriefPrFile[];
  intent: PrIntentRecord | null;
  blast: BlastRadius;
  reviews: BriefReview[];
  agentDocs: { contextDocs: string[]; skills: { name: string; contextDocs: string[] }[] }[];
  projectDocs: ProjectDocsSource;
  docRoots: string[];
  maxDocBytes: number;
  tokenizer: { count(text: string): number };
}

/** D6: the not-dismissed findings of the newest `kind: 'review'` review per
 *  `agent_id` (`null` grouped as one key), flattened, mapped to the fields a
 *  brief is allowed to pass on (AC-9). */
export function selectFindings(reviews: BriefReview[]): BriefFactFinding[] {
  const newestByAgent = new Map<string, BriefReview>();
  for (const review of reviews) {
    if (review.kind !== 'review') continue;
    const key = review.agentId ?? '\u0000null';
    const current = newestByAgent.get(key);
    if (!current || review.createdAt > current.createdAt) newestByAgent.set(key, review);
  }
  const out: BriefFactFinding[] = [];
  for (const review of newestByAgent.values()) {
    for (const finding of review.findings) {
      if (finding.dismissedAt !== null) continue;
      out.push({
        title: finding.title,
        severity: finding.severity,
        file: finding.file,
        startLine: finding.startLine,
        endLine: finding.endLine,
      });
    }
  }
  return out;
}

/** Union of every enabled agent's `context_docs` (agent order) plus every
 *  included skill's docs (D6) — `resolveProjectContext`'s own `resolveDocOrder`
 *  dedupes a path that both an agent and its skill attach, keeping the first
 *  occurrence (AC-10). */
function flattenAgentDocs(
  list: { contextDocs: string[]; skills: { name: string; contextDocs: string[] }[] }[],
): { agentDocs: string[]; skills: { name: string; contextDocs: string[] }[] } {
  const agentDocs: string[] = [];
  const skills: { name: string; contextDocs: string[] }[] = [];
  for (const entry of list) {
    agentDocs.push(...entry.contextDocs);
    skills.push(...entry.skills);
  }
  return { agentDocs, skills };
}

/**
 * Strip newline/control characters from a document path before it is
 * written into a TRUSTED, unwrapped line of the prompt — the "Project
 * context" section heading (`prompt.ts`) and the Missing-inputs list below
 * both print a doc path outside `wrapUntrusted`. `checkDocPathSyntax`
 * (`_shared/project-context/helpers.ts`) allows a literal `\n`/control char
 * in a STORED path, so a crafted filename could otherwise inject fake
 * prompt structure (e.g. a fake `## SYSTEM:` line) outside any `<untrusted>`
 * block (security NV1/F10). Applied once here, at fact-set construction, so
 * every consumer of `BriefFactDocument.path` — including `prompt.ts`, which
 * never re-sanitises it — only ever sees the safe form. Collapsed to a
 * space, not stripped, so the path stays readable.
 */
function sanitiseDocPath(path: string): string {
  // Char-code filter, not a control-character regex class (`no-control-regex`).
  return Array.from(path, (ch) => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f ? ' ' : ch)).join('');
}

/** D6's skipped-document reasons map 1:1 onto `ContextDocTrace.status`,
 *  except `'included'` (kept, no missing-input entry) — AC-11/NFR-4. */
async function resolveDocuments(
  input: BuildBriefFactsInput,
): Promise<{ documents: BriefFactDocument[]; missing: MissingInput[] }> {
  const { agentDocs, skills } = flattenAgentDocs(input.agentDocs);
  const result = await resolveProjectContext({
    checkoutRoot: input.pull.clonePath,
    agentDocs,
    skills,
    roots: input.docRoots,
    budgetTokens: BRIEF_DOC_TOKEN_BUDGET,
    maxDocBytes: input.maxDocBytes,
    source: input.projectDocs,
    tokenizer: input.tokenizer,
  });
  const missing: MissingInput[] = [];
  for (const entry of result.trace) {
    if (entry.status === 'included') continue;
    missing.push({ input: 'document', state: 'skipped', detail: `${entry.status}: ${sanitiseDocPath(entry.path)}` });
  }
  return {
    documents: result.specs.map((d) => ({ path: sanitiseDocPath(d.path), content: d.content })),
    missing,
  };
}

/**
 * Build the complete, model-call-free fact set (AC-1). Diff facts never
 * carry a hunk body line (AC-2); a finding never carries its rationale or
 * suggestion (AC-9). Every AC-3..AC-11 condition is recorded in
 * `missingInputs` (D6) as it is found.
 */
export async function buildBriefFacts(input: BuildBriefFactsInput): Promise<BriefFacts> {
  const missingInputs: MissingInput[] = [];

  let intent: BriefFactIntent | null = null;
  if (input.intent === null) {
    missingInputs.push({ input: 'intent', state: 'missing', detail: null });
  } else {
    intent = {
      text: input.intent.intent,
      inScope: input.intent.in_scope,
      outOfScope: input.intent.out_of_scope,
      stale: input.intent.stale,
    };
    if (input.intent.stale) missingInputs.push({ input: 'intent', state: 'stale', detail: null });
  }

  const description = input.pull.body !== null && input.pull.body.trim() !== '' ? input.pull.body : null;
  if (description === null) missingInputs.push({ input: 'description', state: 'missing', detail: null });

  const blast: BriefFactBlast = {
    summary: input.blast.summary,
    degraded: input.blast.degraded === true,
    reason: input.blast.reason ?? null,
  };
  if (blast.degraded) missingInputs.push({ input: 'blast', state: 'degraded', detail: blast.reason });

  const findings = selectFindings(input.reviews);
  const findingsStale =
    input.pull.lastReviewedSha !== null && input.pull.lastReviewedSha !== input.pull.headSha;
  if (findings.length === 0) {
    missingInputs.push({ input: 'findings', state: 'missing', detail: null });
  } else if (findingsStale) {
    missingInputs.push({ input: 'findings', state: 'stale', detail: null });
  }

  const files: BriefFactFile[] = input.files.map((f) => ({
    path: f.path,
    additions: f.additions,
    deletions: f.deletions,
    headers: extractHunkHeaders(f.patch),
  }));
  const totals = {
    files: files.length,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
  };

  const { documents, missing: documentMissing } = await resolveDocuments(input);
  missingInputs.push(...documentMissing);

  return {
    title: input.pull.title,
    description,
    intent,
    blast,
    files,
    totals,
    findings,
    findingsStale,
    documents,
    missingInputs,
  };
}

/**
 * A rendered chat message — kept structural (not imported from `prompt.ts`,
 * which type-imports `BriefFacts` FROM this file; a value import the other
 * way would be the `facts.ts` ↔ `prompt.ts` cycle `types.ts`'s header
 * comment already explains `pnpm arch`'s `no-circular` rule would flag).
 * `fitToBudget`'s caller (`service.ts`) passes `renderBriefMessages` itself.
 */
interface RenderedMessage {
  content: string;
}

const SEVERITY_DROP_ORDER: readonly Severity[] = ['SUGGESTION', 'WARNING', 'CRITICAL'];

function dropLastBySeverity(findings: BriefFactFinding[], severity: Severity): BriefFactFinding[] {
  for (let i = findings.length - 1; i >= 0; i--) {
    if (findings[i]!.severity === severity) return [...findings.slice(0, i), ...findings.slice(i + 1)];
  }
  return findings;
}

/**
 * D7/AC-14/NFR-2: once the fact set is over `budget` tokens, drop whole
 * items in this fixed order until it fits — project-context documents from
 * the end, then review findings from the lowest severity, then changed
 * files from the end of the file list. Every drop is recorded in
 * `missingInputs` (D6's `trimmed` entries): one per dropped document, one
 * combined count for findings, one combined count for files.
 *
 * `render` renders the CANDIDATE fact set into the actual messages that
 * would be sent to the model (the caller passes `renderBriefMessages`) —
 * the budget is measured on that rendered text, not on the raw fact
 * fields, so the system prompt, the injection guard, every
 * `<untrusted source="…">` wrapper, headings and the rendered finding/file
 * lines are all counted (F6/security fix: a budget over raw facts alone
 * let the real prompt exceed `BRIEF_INPUT_TOKEN_BUDGET`).
 */
export function fitToBudget(
  facts: BriefFacts,
  countTokens: (text: string) => number,
  budget: number,
  render: (facts: BriefFacts) => RenderedMessage[],
): BriefFacts {
  let documents = [...facts.documents];
  let findings = [...facts.findings];
  let files = [...facts.files];
  const missingInputs = [...facts.missingInputs];

  const renderedTokens = (view: {
    documents: BriefFactDocument[];
    findings: BriefFactFinding[];
    files: BriefFactFile[];
  }): number => {
    // `missingInputs` is intentionally left as the ORIGINAL fact set's list
    // here (not the growing trim log) — the same determinism the previous
    // raw-field estimate had: what gets dropped never depends on how much
    // was already dropped.
    const candidate: BriefFacts = { ...facts, ...view, missingInputs: facts.missingInputs };
    return render(candidate).reduce((sum, m) => sum + countTokens(m.content), 0);
  };

  const fits = () => renderedTokens({ documents, findings, files }) <= budget;

  const droppedDocPaths: string[] = [];
  while (!fits() && documents.length > 0) {
    const dropped = documents[documents.length - 1]!;
    documents = documents.slice(0, -1);
    droppedDocPaths.push(dropped.path);
  }
  for (const path of droppedDocPaths) missingInputs.push({ input: 'document', state: 'trimmed', detail: path });

  let droppedFindings = 0;
  for (const severity of SEVERITY_DROP_ORDER) {
    while (!fits()) {
      const before = findings.length;
      findings = dropLastBySeverity(findings, severity);
      if (findings.length === before) break; // no more of this severity left
      droppedFindings++;
    }
    if (fits()) break;
  }
  if (droppedFindings > 0) missingInputs.push({ input: 'findings', state: 'trimmed', detail: String(droppedFindings) });

  let droppedFiles = 0;
  while (!fits() && files.length > 0) {
    files = files.slice(0, -1);
    droppedFiles++;
  }
  if (droppedFiles > 0) missingInputs.push({ input: 'files', state: 'trimmed', detail: String(droppedFiles) });

  return { ...facts, documents, findings, files, missingInputs };
}
