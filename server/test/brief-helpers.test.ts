/**
 * IMPL (L4, T12) — internals of `facts.ts`, `prompt.ts` and `grounding.ts`
 * (AC-2, AC-14, AC-19, AC-20). These three files are pure ring-1 helpers with
 * no I/O; `BriefService` wires them together in a later lane (L5), which is
 * where the red suites (`brief-facts.test.ts`, `brief-grounding.test.ts`,
 * `brief-model.test.ts`, `brief-untrusted.test.ts`) turn green.
 */
import { describe, it, expect } from 'vitest';
import {
  buildBriefFacts,
  fitToBudget,
  selectFindings,
  type BriefFacts,
  type BriefFactFile,
  type BriefFactFinding,
  type BuildBriefFactsInput,
} from '../src/modules/brief/facts.js';
import { renderBriefMessages, BRIEF_INJECTION_GUARD } from '../src/modules/brief/prompt.js';
import {
  buildGroundingIndex,
  groundDraft,
  groundFileRef,
  parseFileRef,
  parseHunkRange,
} from '../src/modules/brief/grounding.js';
import { MockProjectDocsSource } from '../src/adapters/mocks.js';
import type { BlastRadius, ChatMessage } from '@devdigest/shared';
import type { BriefPull, BriefReview } from '../src/modules/brief/service.js';

/** Mirrors the OLD raw-field token estimate `fitToBudget` used before the
 *  F6 fix — used only to keep these algorithm-level tests' budgets (80/30/9
 *  chars) meaningful; the real production `render` is `renderBriefMessages`
 *  (see `brief-fixes.test.ts` for a test against that real renderer). */
function renderRawFields(f: BriefFacts): ChatMessage[] {
  const parts = [f.title, f.description ?? ''];
  if (f.intent) parts.push(f.intent.text, f.intent.inScope.join(' '), f.intent.outOfScope.join(' '));
  parts.push(f.blast.summary);
  for (const d of f.documents) parts.push(d.path, d.content);
  for (const fi of f.findings) parts.push(fi.title, fi.file);
  for (const file of f.files) {
    parts.push(file.path);
    for (const h of file.headers) parts.push(h);
  }
  return [{ role: 'user', content: parts.join('') }];
}

const BASE_PULL: BriefPull = {
  id: 'pr-1',
  title: 'Add rate limiting',
  body: 'Adds a limiter.',
  headSha: 'head-sha-1',
  lastReviewedSha: 'head-sha-1',
  clonePath: '/clones/acme/payments-api',
};

function baseInput(overrides: Partial<BuildBriefFactsInput> = {}): BuildBriefFactsInput {
  return {
    pull: BASE_PULL,
    files: [],
    intent: null,
    blast: { changed_symbols: [], downstream: [], summary: 'nothing downstream', degraded: false } as BlastRadius,
    reviews: [] as BriefReview[],
    agentDocs: [],
    projectDocs: new MockProjectDocsSource({}),
    docRoots: ['**/*.md'],
    maxDocBytes: 1_000_000,
    tokenizer: { count: (s: string) => s.length },
    ...overrides,
  };
}

describe('facts.ts — AC-2 (no hunk body line reaches a fact)', () => {
  it('extracts only hunk header lines from a patch, never a body line', async () => {
    const facts = await buildBriefFacts(
      baseInput({
        files: [
          {
            path: 'src/config.ts',
            additions: 1,
            deletions: 0,
            patch: '@@ -1,2 +1,3 @@\n context\n+  secret: "sk_live_x",\n other',
          },
        ],
      }),
    );
    expect(facts.files[0]!.headers).toEqual(['@@ -1,2 +1,3 @@']);
    const rendered = renderBriefMessages(facts).map((m) => m.content).join('\n');
    expect(rendered).toContain('@@ -1,2 +1,3 @@');
    expect(rendered).not.toContain('sk_live_x');
  });
});

describe('facts.ts — selectFindings (D6 grouping)', () => {
  it('keeps only the newest review per agent, drops dismissed findings', () => {
    const reviews: BriefReview[] = [
      {
        kind: 'review',
        agentId: 'a1',
        createdAt: new Date('2026-01-01'),
        findings: [
          {
            title: 'OLD',
            severity: 'high',
            file: 'f.ts',
            startLine: 1,
            endLine: 1,
            rationale: 'x',
            suggestion: null,
            dismissedAt: null,
          },
        ],
      },
      {
        kind: 'review',
        agentId: 'a1',
        createdAt: new Date('2026-02-01'),
        findings: [
          {
            title: 'NEW',
            severity: 'high',
            file: 'f.ts',
            startLine: 1,
            endLine: 1,
            rationale: 'x',
            suggestion: null,
            dismissedAt: null,
          },
          {
            title: 'DISMISSED',
            severity: 'low',
            file: 'f.ts',
            startLine: 2,
            endLine: 2,
            rationale: 'x',
            suggestion: null,
            dismissedAt: new Date('2026-02-02'),
          },
        ],
      },
      {
        kind: 'summary',
        agentId: 'a2',
        createdAt: new Date('2026-03-01'),
        findings: [
          {
            title: 'SUMMARY_KIND',
            severity: 'low',
            file: 'f.ts',
            startLine: 1,
            endLine: 1,
            rationale: 'x',
            suggestion: null,
            dismissedAt: null,
          },
        ],
      },
    ];
    const out = selectFindings(reviews);
    expect(out.map((f) => f.title)).toEqual(['NEW']);
  });
});

describe('facts.ts — fitToBudget (AC-14)', () => {
  const fixedOnly: BriefFacts = {
    title: 'T',
    description: null,
    intent: null,
    blast: { summary: 'S', degraded: false, reason: null },
    files: [],
    totals: { files: 0, additions: 0, deletions: 0 },
    findings: [],
    findingsStale: false,
    documents: [],
    missingInputs: [],
  };

  it('drops documents from the end first', () => {
    const facts: BriefFacts = {
      ...fixedOnly,
      documents: [
        { path: 'a.md', content: 'A'.repeat(50) },
        { path: 'b.md', content: 'B'.repeat(50) },
      ],
    };
    const trimmed = fitToBudget(facts, (s) => s.length, 80, renderRawFields);
    expect(trimmed.documents.map((d) => d.path)).toEqual(['a.md']);
    expect(trimmed.missingInputs).toContainEqual({ input: 'document', state: 'trimmed', detail: 'b.md' });
  });

  // F2 fix: real finding severities are the contract `Severity` enum
  // (`CRITICAL`/`WARNING`/`SUGGESTION`, `contracts/findings.ts`), not
  // `low`/`medium`/`high` — `SEVERITY_DROP_ORDER` drops `SUGGESTION` first.
  it('drops the lowest-severity findings once documents are exhausted', () => {
    const findings: BriefFactFinding[] = [
      { title: 'H'.repeat(20), severity: 'CRITICAL', file: 'f.ts', startLine: 1, endLine: 1 },
      { title: 'L'.repeat(20), severity: 'SUGGESTION', file: 'f.ts', startLine: 1, endLine: 1 },
    ];
    const facts: BriefFacts = { ...fixedOnly, findings };
    const trimmed = fitToBudget(facts, (s) => s.length, 30, renderRawFields);
    expect(trimmed.findings.map((f) => f.severity)).toEqual(['CRITICAL']);
    expect(trimmed.missingInputs).toContainEqual({ input: 'findings', state: 'trimmed', detail: '1' });
  });

  it('drops files from the end once documents and findings are exhausted', () => {
    const files: BriefFactFile[] = [
      { path: 'a.ts', additions: 1, deletions: 0, headers: [] },
      { path: 'b.ts', additions: 1, deletions: 0, headers: [] },
    ];
    const facts: BriefFacts = { ...fixedOnly, files };
    const trimmed = fitToBudget(facts, (s) => s.length, 9, renderRawFields);
    expect(trimmed.files.map((f) => f.path)).toEqual(['a.ts']);
    expect(trimmed.missingInputs).toContainEqual({ input: 'files', state: 'trimmed', detail: '1' });
  });
});

describe('prompt.ts — the injection guard sits in the system prompt', () => {
  it('wraps every untrusted text and keeps the guard in the system message', () => {
    const facts: BriefFacts = {
      title: 'Hostile title',
      description: 'Hostile description',
      intent: { text: 'Hostile intent', inScope: [], outOfScope: [], stale: false },
      blast: { summary: 'Hostile blast', degraded: false, reason: null },
      files: [{ path: 'src/a.ts', additions: 1, deletions: 0, headers: ['@@ -1,1 +1,2 @@'] }],
      totals: { files: 1, additions: 1, deletions: 0 },
      findings: [{ title: 'Hostile finding', severity: 'high', file: 'src/a.ts', startLine: 1, endLine: 1 }],
      findingsStale: false,
      documents: [{ path: 'docs/a.md', content: 'Hostile doc' }],
      missingInputs: [],
    };
    const [system, user] = renderBriefMessages(facts);
    expect(system!.role).toBe('system');
    expect(system!.content).toContain(BRIEF_INJECTION_GUARD);
    expect(user!.content).toContain('Hostile title');
    expect(user!.content).toContain('Hostile intent');
    expect(user!.content).toContain('Hostile finding');
    expect(user!.content).toContain('Hostile doc');
    expect(user!.content).toContain('Hostile blast');
    const opens = user!.content.match(/<untrusted source="/g) ?? [];
    const closes = user!.content.match(/<\/untrusted>/g) ?? [];
    expect(opens.length).toBe(closes.length);
    expect(opens.length).toBeGreaterThanOrEqual(5);
  });
});

describe('grounding.ts — AC-19 (changed-file ranges)', () => {
  const files = [{ path: 'src/a.ts', headers: ['@@ -1,2 +1,10 @@'] }];
  const blast: BlastRadius = { changed_symbols: [], downstream: [], summary: '', degraded: false };
  const index = buildGroundingIndex(files, blast);

  it('parses a hunk header into its new-side range', () => {
    expect(parseHunkRange('@@ -1,2 +1,10 @@')).toEqual({ start: 1, end: 10 });
    expect(parseHunkRange('@@ -1,2 +5 @@')).toEqual({ start: 5, end: 5 });
    expect(parseHunkRange('@@ -1,2 +5,0 @@')).toBeNull();
  });

  it('parses a bare, single-line and ranged ref', () => {
    expect(parseFileRef('src/a.ts')).toEqual({ path: 'src/a.ts', range: null });
    expect(parseFileRef('src/a.ts:5')).toEqual({ path: 'src/a.ts', range: { start: 5, end: 5 } });
    expect(parseFileRef('src/a.ts:5-8')).toEqual({ path: 'src/a.ts', range: { start: 5, end: 8 } });
  });

  it('keeps a range overlapping the hunk, drops a range outside it', () => {
    expect(groundFileRef('src/a.ts:5-8', index)).toBe('src/a.ts:5-8');
    expect(groundFileRef('src/a.ts:50-60', index)).toBe('src/a.ts');
  });

  it('drops a reference to a file that is neither changed nor a blast caller', () => {
    expect(groundFileRef('src/unknown.ts', index)).toBeNull();
  });
});

describe('grounding.ts — AC-20 (blast-caller-only files)', () => {
  const files = [{ path: 'src/a.ts', headers: ['@@ -1,2 +1,10 @@'] }];
  const blast: BlastRadius = {
    changed_symbols: [],
    downstream: [{ symbol: 'f', callers: [{ name: 'c', file: 'src/caller.ts', line: 42 }], endpoints_affected: [], crons_affected: [] }],
    summary: '',
    degraded: false,
  };
  const index = buildGroundingIndex(files, blast);

  it('keeps the real caller line, drops a line that is not a caller line', () => {
    expect(groundFileRef('src/caller.ts:42', index)).toBe('src/caller.ts:42-42');
    expect(groundFileRef('src/caller.ts:99', index)).toBe('src/caller.ts');
  });

  it('a caller file that is ALSO a changed file is grounded by hunks, not caller lines', () => {
    const changedCallerFiles = [{ path: 'src/caller.ts', headers: ['@@ -1,1 +1,5 @@'] }];
    const idx = buildGroundingIndex(changedCallerFiles, blast);
    // line 42 is not a caller line here (caller.ts is now a changed file, so
    // its caller-line entry is skipped) and 42 is outside the 1..5 hunk.
    expect(groundFileRef('src/caller.ts:42', idx)).toBe('src/caller.ts');
    expect(groundFileRef('src/caller.ts:3', idx)).toBe('src/caller.ts:3-3');
  });
});

describe('grounding.ts — groundDraft limits (AC-15)', () => {
  it('cuts the summary, risks and focus items to their stored limits, in model order', () => {
    const files = Array.from({ length: 8 }, (_, i) => ({ path: `src/${i}.ts`, headers: ['@@ -1,1 +1,1 @@'] }));
    const blast: BlastRadius = { changed_symbols: [], downstream: [], summary: '', degraded: false };
    const index = buildGroundingIndex(files, blast);
    const draft = {
      summary: 'S'.repeat(500),
      risks: Array.from({ length: 8 }, (_, i) => ({
        kind: 'other',
        title: `R${i}`,
        explanation: 'x',
        severity: 'low' as const,
        file_refs: [`src/${i}.ts`],
      })),
      review_focus: Array.from({ length: 7 }, (_, i) => ({ file: `src/${i}.ts`, line: null, reason: `F${i}` })),
    };
    const out = groundDraft(draft, index);
    expect(out.summary).toHaveLength(400);
    expect(out.risks.map((r) => r.title)).toEqual(['R0', 'R1', 'R2', 'R3', 'R4', 'R5']);
    expect(out.review_focus.map((f) => f.reason)).toEqual(['F0', 'F1', 'F2', 'F3', 'F4']);
  });
});
