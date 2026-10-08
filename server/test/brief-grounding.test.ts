/**
 * RED (L2, T3) — grounding the model's draft against the PR's changed files,
 * hunk ranges and blast callers before anything is stored (AC-18..AC-24).
 * Hermetic: `BriefService` + fake `BriefServiceDeps` + a real `RunBus`. The
 * only observable surface is the brief `saveBrief` persists — grounding
 * itself (`grounding.ts`) is a later lane's implementation detail.
 */
import { describe, it, expect } from 'vitest';
import { BriefService, type BriefServiceDeps, type BriefPull, type BriefPrFile } from '../src/modules/brief/service.js';
import { RunBus } from '../src/platform/sse.js';
import { MockLLMProvider, MockProjectDocsSource } from '../src/adapters/mocks.js';
import type { BlastRadius, PrBrief } from '@devdigest/shared';

const WS = 'ws-1';
const PR_ID = 'pr-1';

const BASE_PULL: BriefPull = {
  id: PR_ID,
  title: 'Add rate limiting',
  body: 'Adds a limiter.',
  headSha: 'head-sha-1',
  lastReviewedSha: 'head-sha-1',
  clonePath: '/clones/acme/payments-api',
};

// Hunk header `@@ -1,2 +1,10 @@` → new-side range 1..10 (AC-19/AC-23).
const FILES: BriefPrFile[] = [{ path: 'src/a.ts', additions: 8, deletions: 0, patch: '@@ -1,2 +1,10 @@\n context' }];

// `src/caller.ts` is only a blast-caller file, line 42 (AC-20).
const BLAST: BlastRadius = {
  changed_symbols: [],
  downstream: [
    {
      symbol: 'rateLimit',
      callers: [{ name: 'handle', file: 'src/caller.ts', line: 42 }],
      endpoints_affected: [],
      crons_affected: [],
    },
  ],
  summary: 'one downstream caller',
  degraded: false,
};

const DRAFT = {
  summary: 'ok',
  risks: [
    // AC-18: one unknown ref dropped, one valid ref kept.
    { kind: 'other', title: 'R1_mixed', explanation: 'x', severity: 'low', file_refs: ['src/unknown.ts', 'src/a.ts'] },
    // AC-19: range outside the hunk → file kept, range removed.
    { kind: 'other', title: 'R2_out_of_hunk', explanation: 'x', severity: 'low', file_refs: ['src/a.ts:50-60'] },
    // AC-19 positive: range overlapping the hunk → kept as-is.
    { kind: 'other', title: 'R2b_in_hunk', explanation: 'x', severity: 'low', file_refs: ['src/a.ts:5-8'] },
    // AC-20: a blast-caller file whose line is not a caller's line → file kept, line removed.
    { kind: 'other', title: 'R3_bad_caller_line', explanation: 'x', severity: 'low', file_refs: ['src/caller.ts:99'] },
    // AC-20 positive: the real caller line → kept.
    { kind: 'other', title: 'R3b_good_caller_line', explanation: 'x', severity: 'low', file_refs: ['src/caller.ts:42'] },
    // AC-21: every ref invalid → the whole risk is dropped.
    { kind: 'other', title: 'R4_fully_dropped', explanation: 'x', severity: 'low', file_refs: ['src/does-not-exist.ts'] },
  ],
  review_focus: [
    // AC-22: not a changed file → dropped entirely.
    { file: 'src/not_changed.ts', line: null, reason: 'F1_dropped' },
    // AC-23: a line outside every hunk → item kept, line becomes null.
    { file: 'src/a.ts', line: 999, reason: 'F2_out_of_hunk' },
    // AC-23 positive: a line inside the hunk → kept with its line.
    { file: 'src/a.ts', line: 5, reason: 'F3_in_hunk' },
  ],
};

function buildDeps() {
  const saved: PrBrief[] = [];
  const llm = new MockLLMProvider('openai', { structured: DRAFT });
  const bus = new RunBus();
  const deps: BriefServiceDeps = {
    getPull: async () => BASE_PULL,
    getPrFiles: async () => FILES,
    getBrief: async () => null,
    saveBrief: async (b) => {
      saved.push(b);
    },
    readIntent: async () => null,
    readBlast: async () => BLAST,
    listReviews: async () => [],
    listEnabledAgentDocs: async () => [],
    projectDocs: new MockProjectDocsSource({}),
    docRoots: ['**/*.md'],
    maxDocBytes: 1_000_000,
    tokenizer: { count: (s: string) => s.length },
    resolveLlm: async () => ({ choice: { provider: 'openai', model: 'gpt-4.1' }, llm }),
    bus,
    now: () => new Date('2026-06-01T00:00:00.000Z'),
  };
  return { deps, bus, saved };
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

describe('BriefService grounding (red, T3)', () => {
  it('AC-18/AC-24: a reference to a file that is neither changed nor a blast caller is dropped, the valid one kept', async () => {
    const { deps, bus, saved } = buildDeps();
    await runGenerate(deps, bus);
    const risk = saved[0]!.risks.find((r) => r.title === 'R1_mixed');
    expect(risk).toBeDefined();
    expect(risk!.file_refs).toEqual(['src/a.ts']);
  });

  it('AC-19: a changed-file range that does not overlap any hunk keeps the file, drops the range', async () => {
    const { deps, bus, saved } = buildDeps();
    await runGenerate(deps, bus);
    const risk = saved[0]!.risks.find((r) => r.title === 'R2_out_of_hunk');
    expect(risk).toBeDefined();
    expect(risk!.file_refs).toEqual(['src/a.ts']);
  });

  it('AC-19: a changed-file range overlapping a hunk is kept as-is', async () => {
    const { deps, bus, saved } = buildDeps();
    await runGenerate(deps, bus);
    const risk = saved[0]!.risks.find((r) => r.title === 'R2b_in_hunk');
    expect(risk).toBeDefined();
    expect(risk!.file_refs).toEqual(['src/a.ts:5-8']);
  });

  it('AC-20: a blast-caller-only file with a line that is not a caller line keeps the file, drops the line', async () => {
    const { deps, bus, saved } = buildDeps();
    await runGenerate(deps, bus);
    const risk = saved[0]!.risks.find((r) => r.title === 'R3_bad_caller_line');
    expect(risk).toBeDefined();
    expect(risk!.file_refs).toEqual(['src/caller.ts']);
  });

  it('AC-20: a blast-caller-only file whose line matches the real caller line is kept', async () => {
    const { deps, bus, saved } = buildDeps();
    await runGenerate(deps, bus);
    const risk = saved[0]!.risks.find((r) => r.title === 'R3b_good_caller_line');
    expect(risk).toBeDefined();
    expect(risk!.file_refs).toEqual(['src/caller.ts:42-42']);
  });

  it('AC-21/AC-24: a risk with no file reference left after grounding is dropped entirely', async () => {
    const { deps, bus, saved } = buildDeps();
    await runGenerate(deps, bus);
    expect(saved[0]!.risks.find((r) => r.title === 'R4_fully_dropped')).toBeUndefined();
  });

  it('AC-22/AC-24: a review-focus item naming a file that is not a changed file is dropped entirely', async () => {
    const { deps, bus, saved } = buildDeps();
    await runGenerate(deps, bus);
    expect(saved[0]!.review_focus.find((f) => f.reason === 'F1_dropped')).toBeUndefined();
  });

  it('AC-23: a review-focus line outside every hunk of its file is kept with a null line', async () => {
    const { deps, bus, saved } = buildDeps();
    await runGenerate(deps, bus);
    const item = saved[0]!.review_focus.find((f) => f.reason === 'F2_out_of_hunk');
    expect(item).toBeDefined();
    expect(item).toMatchObject({ file: 'src/a.ts', line: null });
  });

  it('AC-23: a review-focus line inside a hunk of its file is kept as-is', async () => {
    const { deps, bus, saved } = buildDeps();
    await runGenerate(deps, bus);
    const item = saved[0]!.review_focus.find((f) => f.reason === 'F3_in_hunk');
    expect(item).toBeDefined();
    expect(item).toMatchObject({ file: 'src/a.ts', line: 5 });
  });
});
