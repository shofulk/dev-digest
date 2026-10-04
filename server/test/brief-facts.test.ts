/**
 * RED (L2, T1) — PR Brief fact-set assembly (AC-1..AC-11, AC-14, NFR-2, NFR-4).
 * Hermetic: `BriefService` with a fake `BriefServiceDeps`, a real `RunBus`, a
 * `MockLLMProvider` standing in for the one model call, and a
 * `MockProjectDocsSource` for project-context documents. No DB, no network.
 *
 * Every assertion is observed through the ONE model call the job makes (its
 * rendered prompt messages) and through the brief `saveBrief` persists — the
 * only two externally-visible effects of fact-set assembly. `facts.ts` and
 * `prompt.ts`'s `renderBriefMessages` are implementation internals of a later
 * lane; this test never imports or calls them directly.
 */
import { describe, it, expect } from 'vitest';
import { BriefService, type BriefServiceDeps, type BriefPull, type BriefPrFile, type BriefReview } from '../src/modules/brief/service.js';
import { RunBus } from '../src/platform/sse.js';
import { MockLLMProvider, MockProjectDocsSource } from '../src/adapters/mocks.js';
import type { BlastRadius, PrBrief, PrIntentRecord, Severity } from '@devdigest/shared';

const WS = 'ws-1';
const PR_ID = 'pr-1';

const BASE_PULL: BriefPull = {
  id: PR_ID,
  title: 'Add rate limiting to public API endpoints',
  body: 'Adds a token bucket limiter in front of every public route.',
  headSha: 'head-sha-1',
  lastReviewedSha: 'head-sha-1',
  clonePath: '/clones/acme/payments-api',
};

const BASE_FILES: BriefPrFile[] = [
  {
    path: 'src/config.ts',
    additions: 4,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_SECRETVALUE",\n   redisUrl: x,',
  },
];

const BASE_BLAST: BlastRadius = {
  changed_symbols: [],
  downstream: [],
  summary: 'No downstream callers of the changed symbols.',
  degraded: false,
};

const BASE_INTENT: PrIntentRecord = {
  intent: 'Add a token bucket limiter to protect public routes.',
  in_scope: ['rate limiting'],
  out_of_scope: [],
  pr_id: PR_ID,
  confidence: 'high',
  missing_context: false,
  sources: [],
  head_sha: 'head-sha-1',
  current_head_sha: 'head-sha-1',
  stale: false,
};

const DRAFT_FIXTURE = {
  summary: 'Adds a rate limiter in front of public routes.',
  risks: [
    {
      kind: 'config_secrets',
      title: 'Secret committed',
      explanation: 'A live key sits in config.',
      severity: 'high',
      file_refs: ['src/config.ts'],
    },
  ],
  review_focus: [{ file: 'src/config.ts', line: null, reason: 'Start here' }],
};

interface Scenario {
  pull?: Partial<BriefPull>;
  files?: BriefPrFile[];
  intent?: PrIntentRecord | null;
  blast?: BlastRadius;
  reviews?: BriefReview[];
  agentDocs?: { contextDocs: string[]; skills: { name: string; contextDocs: string[] }[] }[];
  docFiles?: Record<string, string>;
  docRoots?: string[];
  maxDocBytes?: number;
  tokenizer?: { count(text: string): number };
}

function buildDeps(scn: Scenario = {}) {
  const saved: PrBrief[] = [];
  const llm = new MockLLMProvider('openai', { structured: DRAFT_FIXTURE });
  const bus = new RunBus();
  const deps: BriefServiceDeps = {
    getPull: async () => ({ ...BASE_PULL, ...scn.pull }),
    getPrFiles: async () => scn.files ?? BASE_FILES,
    getBrief: async () => null,
    saveBrief: async (brief) => {
      saved.push(brief);
    },
    readIntent: async () => (scn.intent === undefined ? BASE_INTENT : scn.intent),
    readBlast: async () => scn.blast ?? BASE_BLAST,
    listReviews: async () => scn.reviews ?? [],
    listEnabledAgentDocs: async () => scn.agentDocs ?? [],
    projectDocs: new MockProjectDocsSource(scn.docFiles ?? {}),
    docRoots: scn.docRoots ?? ['**/*.md'],
    maxDocBytes: scn.maxDocBytes ?? 1_000_000,
    tokenizer: scn.tokenizer ?? { count: (s: string) => s.length },
    resolveLlm: async () => ({ choice: { provider: 'openai', model: 'gpt-4.1' }, llm }),
    bus,
    now: () => new Date('2026-06-01T00:00:00.000Z'),
  };
  return { deps, llm, bus, saved };
}

function log() {
  return { info: () => undefined, warn: () => undefined, error: () => undefined };
}

async function runGenerate(deps: BriefServiceDeps, bus: RunBus) {
  const service = new BriefService(deps);
  const result = await service.generate(WS, PR_ID, {}, log());
  if (result.kind === 'started') {
    await new Promise<void>((resolve) => bus.onDone(result.job_id, resolve));
  }
  return result;
}

function promptText(llm: MockLLMProvider): string {
  const call = llm.calls.find((c) => c.method === 'completeStructured');
  expect(call, 'no completeStructured call was made').toBeDefined();
  const req = call!.req as { messages: { role: string; content: string }[] };
  return req.messages.map((m) => m.content).join('\n');
}

describe('BriefService fact-set assembly (red, T1)', () => {
  it('AC-1: the one model call carries title, description, intent, blast summary and findings — no model call before it', async () => {
    const { deps, llm, bus } = buildDeps({
      reviews: [
        {
          kind: 'review',
          agentId: 'agent-1',
          createdAt: new Date('2026-05-30T00:00:00Z'),
          findings: [
            {
              title: 'Rate limiter missing a backoff',
              severity: 'medium',
              file: 'src/config.ts',
              startLine: 11,
              endLine: 11,
              rationale: 'because',
              suggestion: null,
              dismissedAt: null,
            },
          ],
        },
      ],
    });
    await runGenerate(deps, bus);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    const text = promptText(llm);
    expect(text).toContain('Add rate limiting to public API endpoints');
    expect(text).toContain('token bucket limiter');
    expect(text).toContain('No downstream callers');
    expect(text).toContain('Rate limiter missing a backoff');
  });

  it('AC-2: the diff is described by hunk header lines only — no hunk body line reaches the prompt', async () => {
    const { deps, llm, bus } = buildDeps();
    await runGenerate(deps, bus);
    const text = promptText(llm);
    expect(text).toContain('@@ -10,3 +10,4 @@');
    expect(text).not.toContain('sk_live_SECRETVALUE');
  });

  it('AC-3: no stored intent → brief built without it, no extra model call, `intent: missing`', async () => {
    const { deps, llm, bus, saved } = buildDeps({ intent: null });
    await runGenerate(deps, bus);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(saved[0]!.missing_inputs).toContainEqual({ input: 'intent', state: 'missing', detail: null });
  });

  it('AC-4: a stale intent is still passed, marked stale, with `intent: stale`', async () => {
    const { deps, llm, bus, saved } = buildDeps({
      intent: { ...BASE_INTENT, stale: true, head_sha: 'an-older-sha' },
    });
    await runGenerate(deps, bus);
    expect(saved[0]!.missing_inputs).toContainEqual({ input: 'intent', state: 'stale', detail: null });
    expect(promptText(llm)).toContain('token bucket limiter');
  });

  it('AC-5: a degraded blast response is passed, with `blast: degraded` and its reason', async () => {
    const { deps, bus, saved, llm } = buildDeps({
      blast: { ...BASE_BLAST, degraded: true, reason: 'no_data', summary: 'Blast radius is degraded.' },
    });
    await runGenerate(deps, bus);
    expect(saved[0]!.missing_inputs).toContainEqual({ input: 'blast', state: 'degraded', detail: 'no_data' });
    expect(promptText(llm)).toContain('Blast radius is degraded.');
  });

  it('AC-6: an empty PR description adds `description: missing`', async () => {
    const { deps, bus, saved } = buildDeps({ pull: { body: '' } });
    await runGenerate(deps, bus);
    expect(saved[0]!.missing_inputs).toContainEqual({ input: 'description', state: 'missing', detail: null });
  });

  it('AC-7: no review findings input → brief built without them, `findings: missing`', async () => {
    const { deps, bus, saved } = buildDeps({ reviews: [] });
    await runGenerate(deps, bus);
    expect(saved[0]!.missing_inputs).toContainEqual({ input: 'findings', state: 'missing', detail: null });
  });

  it('AC-8: findings from an older head are still passed, marked stale, `findings: stale`', async () => {
    const { deps, bus, saved, llm } = buildDeps({
      pull: { headSha: 'new-sha', lastReviewedSha: 'old-sha' },
      reviews: [
        {
          kind: 'review',
          agentId: 'agent-1',
          createdAt: new Date('2026-05-30T00:00:00Z'),
          findings: [
            {
              title: 'Possible overflow',
              severity: 'high',
              file: 'src/config.ts',
              startLine: 1,
              endLine: 2,
              rationale: 'because',
              suggestion: null,
              dismissedAt: null,
            },
          ],
        },
      ],
    });
    await runGenerate(deps, bus);
    expect(saved[0]!.missing_inputs).toContainEqual({ input: 'findings', state: 'stale', detail: null });
    expect(promptText(llm)).toContain('Possible overflow');
  });

  it('AC-9: a finding is passed by title/severity/file/line only — rationale and suggestion never reach the prompt', async () => {
    const { deps, bus, llm } = buildDeps({
      reviews: [
        {
          kind: 'review',
          agentId: 'agent-1',
          createdAt: new Date('2026-05-30T00:00:00Z'),
          findings: [
            {
              title: 'Finding title marker',
              severity: 'high',
              file: 'src/config.ts',
              startLine: 1,
              endLine: 2,
              rationale: 'RATIONALE_SECRET_TEXT',
              suggestion: 'SUGGESTION_SECRET_TEXT',
              dismissedAt: null,
            },
          ],
        },
      ],
    });
    await runGenerate(deps, bus);
    const text = promptText(llm);
    expect(text).toContain('Finding title marker');
    expect(text).not.toContain('RATIONALE_SECRET_TEXT');
    expect(text).not.toContain('SUGGESTION_SECRET_TEXT');
  });

  it('AC-10: resolves the union of enabled agents + their enabled skills, deduped, from the checkout', async () => {
    const { deps, bus, llm } = buildDeps({
      agentDocs: [
        {
          contextDocs: ['docs/a.md'],
          skills: [{ name: 'skillX', contextDocs: ['docs/a.md', 'docs/b.md'] }],
        },
      ],
      docFiles: { 'docs/a.md': 'UNIQUESTR_A', 'docs/b.md': 'UNIQUESTR_B' },
      docRoots: ['docs/**/*.md'],
    });
    await runGenerate(deps, bus);
    const text = promptText(llm);
    expect(text).toContain('UNIQUESTR_A');
    expect(text).toContain('UNIQUESTR_B');
    // `docs/a.md` is attached by the agent AND the skill — it is read once.
    expect(text.split('UNIQUESTR_A')).toHaveLength(2);
  });

  it('AC-11: a missing document is skipped with its reason and listed in missing inputs', async () => {
    const { deps, bus, saved } = buildDeps({
      agentDocs: [{ contextDocs: ['docs/missing.md'], skills: [] }],
      docFiles: {},
      docRoots: ['docs/**/*.md'],
    });
    await runGenerate(deps, bus);
    expect(saved[0]!.missing_inputs).toContainEqual({
      input: 'document',
      state: 'skipped',
      detail: 'missing: docs/missing.md',
    });
  });

  it('NFR-4: a document over its own 3,000-token budget is skipped `budget`, the earlier one kept', async () => {
    const { deps, bus, saved, llm } = buildDeps({
      agentDocs: [{ contextDocs: ['docs/a.md', 'docs/b.md'], skills: [] }],
      docFiles: { 'docs/a.md': 'A'.repeat(2000), 'docs/b.md': 'B'.repeat(2000) },
      docRoots: ['docs/**/*.md'],
    });
    await runGenerate(deps, bus);
    expect(saved[0]!.missing_inputs).toContainEqual({
      input: 'document',
      state: 'skipped',
      detail: 'budget: docs/b.md',
    });
    expect(promptText(llm)).toContain('A'.repeat(2000));
  });

  it('AC-14/NFR-2: over the total input budget, project-context documents are dropped first, from the end', async () => {
    const { deps, bus, saved, llm } = buildDeps({
      // A big, NON-trimmable section (blast summary is never dropped by AC-14)
      // pushes the total fact set over BRIEF_INPUT_TOKEN_BUDGET (8000) once
      // the budget is measured on the RENDERED messages (system prompt +
      // injection guard + every <untrusted> wrapper), not on raw fact text —
      // even though the two documents already fit NFR-4's own 3,000-token
      // cap. Only AC-14's own trim can bring it back under budget.
      blast: { ...BASE_BLAST, summary: `BLAST_SUMMARY_MARKER ${'S'.repeat(3480)}` },
      agentDocs: [{ contextDocs: ['docs/a.md', 'docs/b.md'], skills: [] }],
      docFiles: { 'docs/a.md': 'A'.repeat(1500), 'docs/b.md': 'B'.repeat(1500) },
      docRoots: ['docs/**/*.md'],
      reviews: [
        {
          kind: 'review',
          agentId: 'agent-1',
          createdAt: new Date('2026-05-30T00:00:00Z'),
          findings: [
            {
              title: 'HIGH_FINDING',
              severity: 'high',
              file: 'src/config.ts',
              startLine: 1,
              endLine: 2,
              rationale: 'x',
              suggestion: null,
              dismissedAt: null,
            },
          ],
        },
      ],
    });
    await runGenerate(deps, bus);
    // Only the LAST document (docs/b.md) needed to be dropped to fit — the
    // first one (docs/a.md) stays, findings/files are untouched.
    expect(saved[0]!.missing_inputs).toContainEqual({ input: 'document', state: 'trimmed', detail: 'docs/b.md' });
    const text = promptText(llm);
    expect(text).toContain('A'.repeat(1500));
    expect(text).not.toContain('B'.repeat(1500));
    expect(text).toContain('HIGH_FINDING');
  });

  it('AC-14: once documents are exhausted, review findings are dropped from the lowest severity', async () => {
    // Severities are the real contract `Severity` enum (CRITICAL/WARNING/
    // SUGGESTION), typed with `satisfies Severity` so a typo here fails to
    // compile now, and keeps compiling once `BriefFinding.severity` is
    // retyped from `string` to `Severity`. The drop order under test
    // (`facts.ts`'s `SEVERITY_DROP_ORDER`) is SUGGESTION, then WARNING, then
    // CRITICAL — CRITICAL/WARNING below must survive in full, SUGGESTION is
    // the one severity allowed to lose entries.
    const findings: BriefReview['findings'] = [
      ...Array.from({ length: 3 }, (_, i) => ({
        title: `HIGH_${i}_${'x'.repeat(200)}`,
        severity: 'CRITICAL' satisfies Severity,
        file: 'src/config.ts',
        startLine: 1,
        endLine: 1,
        rationale: 'x',
        suggestion: null,
        dismissedAt: null,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        title: `MED_${i}_${'x'.repeat(200)}`,
        severity: 'WARNING' satisfies Severity,
        file: 'src/config.ts',
        startLine: 1,
        endLine: 1,
        rationale: 'x',
        suggestion: null,
        dismissedAt: null,
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        title: `LOW_${i}_${'x'.repeat(700)}`,
        severity: 'SUGGESTION' satisfies Severity,
        file: 'src/config.ts',
        startLine: 1,
        endLine: 1,
        rationale: 'x',
        suggestion: null,
        dismissedAt: null,
      })),
    ];
    const { deps, bus, saved, llm } = buildDeps({
      reviews: [{ kind: 'review', agentId: 'agent-1', createdAt: new Date('2026-05-30T00:00:00Z'), findings }],
    });
    await runGenerate(deps, bus);
    expect(saved[0]!.missing_inputs).toEqual(
      expect.arrayContaining([expect.objectContaining({ input: 'findings', state: 'trimmed' })]),
    );
    const text = promptText(llm);
    // Every CRITICAL/WARNING finding survives; at least one SUGGESTION one does not.
    for (let i = 0; i < 3; i++) expect(text).toContain(`HIGH_${i}_`);
    for (let i = 0; i < 3; i++) expect(text).toContain(`MED_${i}_`);
    const lowKept = Array.from({ length: 10 }, (_, i) => i).filter((i) => text.includes(`LOW_${i}_`));
    expect(lowKept.length).toBeLessThan(10);
    expect(saved[0]!.missing_inputs).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ input: 'files', state: 'trimmed' })]),
    );
  });

  it('AC-14: once documents and findings are exhausted, changed files are dropped from the end of the list', async () => {
    const files: BriefPrFile[] = Array.from({ length: 60 }, (_, i) => ({
      path: `src/file_${String(i).padStart(3, '0')}.ts`,
      additions: 1,
      deletions: 0,
      patch: `@@ -1,1 +1,1 @@ ${'h'.repeat(200)}`,
    }));
    const { deps, bus, saved, llm } = buildDeps({ files });
    await runGenerate(deps, bus);
    expect(saved[0]!.missing_inputs).toEqual(
      expect.arrayContaining([expect.objectContaining({ input: 'files', state: 'trimmed' })]),
    );
    const text = promptText(llm);
    expect(text).toContain('src/file_000.ts');
    expect(text).not.toContain('src/file_059.ts');
  });
});
