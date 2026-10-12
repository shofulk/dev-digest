/**
 * RED (L2, T2) — the PR Brief's one model call and the limits applied to its
 * output (AC-12, AC-15, AC-16, AC-17, AC-32, AC-65, NFR-3, NFR-5). Hermetic:
 * `BriefService` + fake `BriefServiceDeps` + a real `RunBus`. The LLM is
 * sometimes a hand-rolled fake (not `MockLLMProvider`, which hardcodes
 * `attempts: 1`) so a test can assert `attempts: 2` and timeout/failure
 * behaviour precisely.
 */
import { describe, it, expect } from 'vitest';
import { BriefService, type BriefServiceDeps, type BriefPull, type BriefPrFile } from '../src/modules/brief/service.js';
import { RunBus } from '../src/platform/sse.js';
import { MockProjectDocsSource } from '../src/adapters/mocks.js';
import { TimeoutError } from '../src/platform/resilience.js';
import {
  BRIEF_ERROR_MODEL_TIMEOUT,
  BRIEF_ERROR_MODEL_TIMEOUT_MESSAGE,
  BRIEF_ERROR_MODEL_FAILED,
  BRIEF_ERROR_MODEL_FAILED_MESSAGE,
} from '../src/modules/brief/constants.js';
import type { BlastRadius, LLMProvider, PrBrief } from '@devdigest/shared';

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

const BASE_FILES: BriefPrFile[] = [
  { path: 'src/a.ts', additions: 1, deletions: 0, patch: '@@ -1,1 +1,20 @@\n context' },
  { path: 'src/b.ts', additions: 1, deletions: 0, patch: '@@ -1,1 +1,20 @@\n context' },
  { path: 'src/c.ts', additions: 1, deletions: 0, patch: '@@ -1,1 +1,20 @@\n context' },
  { path: 'src/d.ts', additions: 1, deletions: 0, patch: '@@ -1,1 +1,20 @@\n context' },
  { path: 'src/e.ts', additions: 1, deletions: 0, patch: '@@ -1,1 +1,20 @@\n context' },
  { path: 'src/f.ts', additions: 1, deletions: 0, patch: '@@ -1,1 +1,20 @@\n context' },
  { path: 'src/g.ts', additions: 1, deletions: 0, patch: '@@ -1,1 +1,20 @@\n context' },
  { path: 'src/h.ts', additions: 1, deletions: 0, patch: '@@ -1,1 +1,20 @@\n context' },
];

const BASE_BLAST: BlastRadius = { changed_symbols: [], downstream: [], summary: 'nothing downstream', degraded: false };

function baseDeps(llm: LLMProvider, bus: RunBus): { deps: BriefServiceDeps; saved: PrBrief[] } {
  const saved: PrBrief[] = [];
  const deps: BriefServiceDeps = {
    getPull: async () => BASE_PULL,
    getPrFiles: async () => BASE_FILES,
    getBrief: async () => null,
    saveBrief: async (b) => {
      saved.push(b);
    },
    readIntent: async () => null,
    readBlast: async () => BASE_BLAST,
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
  return { deps, saved };
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

/** A fake `LLMProvider` whose `completeStructured` is fully scripted — unlike
 *  `MockLLMProvider`, which hardcodes `attempts: 1` and never throws. */
function fakeLlm(impl: (req: unknown) => Promise<unknown>): LLMProvider & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    id: 'openai',
    calls,
    listModels: async () => [],
    complete: async () => {
      throw new Error('not used');
    },
    embed: async () => [],
    completeStructured: (async (req: unknown) => {
      calls.push(req);
      return impl(req);
    }) as LLMProvider['completeStructured'],
  };
}

function riskRef(i: number) {
  return { path: `src/${String.fromCharCode(97 + i)}.ts` };
}

describe('BriefService model call + limits (red, T2)', () => {
  it('AC-12/AC-32: makes exactly one structured request; a schema-repair attempt is counted as part of it', async () => {
    const bus = new RunBus();
    const llm = fakeLlm(async () => ({
      data: { summary: 'ok', risks: [], review_focus: [] },
      model: 'gpt-4.1',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.002,
      raw: '{}',
      attempts: 2,
    }));
    const { deps, saved } = baseDeps(llm, bus);
    await runGenerate(deps, bus);
    expect(llm.calls).toHaveLength(1);
    expect(saved[0]!.stats.attempts).toBe(2);
  });

  it('AC-15/NFR-3: cuts the stored summary to 400 characters', async () => {
    const bus = new RunBus();
    const longSummary = 'S'.repeat(500);
    const llm = fakeLlm(async () => ({
      data: { summary: longSummary, risks: [], review_focus: [] },
      model: 'gpt-4.1',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.002,
      raw: '{}',
      attempts: 1,
    }));
    const { deps, saved } = baseDeps(llm, bus);
    await runGenerate(deps, bus);
    expect(saved[0]!.summary).toHaveLength(400);
    expect(saved[0]!.summary).toBe(longSummary.slice(0, 400));
  });

  it('AC-15/NFR-3: cuts to the first 6 risks and first 5 review-focus items, in model order', async () => {
    const bus = new RunBus();
    const risks = Array.from({ length: 8 }, (_, i) => ({
      kind: 'other',
      title: `R${i}`,
      explanation: 'x',
      severity: 'low' as const,
      file_refs: [riskRef(i).path],
    }));
    const review_focus = Array.from({ length: 7 }, (_, i) => ({
      file: riskRef(i).path,
      line: null,
      reason: `F${i}`,
    }));
    const llm = fakeLlm(async () => ({
      data: { summary: 'ok', risks, review_focus },
      model: 'gpt-4.1',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.002,
      raw: '{}',
      attempts: 1,
    }));
    const { deps, saved } = baseDeps(llm, bus);
    await runGenerate(deps, bus);
    expect(saved[0]!.risks).toHaveLength(6);
    expect(saved[0]!.risks.map((r) => r.title)).toEqual(['R0', 'R1', 'R2', 'R3', 'R4', 'R5']);
    expect(saved[0]!.review_focus).toHaveLength(5);
    expect(saved[0]!.review_focus.map((f) => f.reason)).toEqual(['F0', 'F1', 'F2', 'F3', 'F4']);
  });

  it('AC-16: a risk is stored with kind/title/explanation/severity and at least one file reference', async () => {
    const bus = new RunBus();
    const llm = fakeLlm(async () => ({
      data: {
        summary: 'ok',
        risks: [
          {
            kind: 'api_contract',
            title: 'Breaking change',
            explanation: 'The response shape changed.',
            severity: 'medium',
            file_refs: ['src/a.ts'],
          },
        ],
        review_focus: [],
      },
      model: 'gpt-4.1',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.002,
      raw: '{}',
      attempts: 1,
    }));
    const { deps, saved } = baseDeps(llm, bus);
    await runGenerate(deps, bus);
    expect(saved[0]!.risks).toHaveLength(1);
    expect(saved[0]!.risks[0]).toMatchObject({
      kind: 'api_contract',
      title: 'Breaking change',
      explanation: 'The response shape changed.',
      severity: 'medium',
    });
    expect(saved[0]!.risks[0]!.file_refs.length).toBeGreaterThan(0);
  });

  it('AC-17: an unknown risk kind is stored as `other`, never dropped', async () => {
    const bus = new RunBus();
    const llm = fakeLlm(async () => ({
      data: {
        summary: 'ok',
        risks: [
          {
            kind: 'something_the_model_invented',
            title: 'Odd risk',
            explanation: 'x',
            severity: 'low',
            file_refs: ['src/a.ts'],
          },
        ],
        review_focus: [],
      },
      model: 'gpt-4.1',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.002,
      raw: '{}',
      attempts: 1,
    }));
    const { deps, saved } = baseDeps(llm, bus);
    await runGenerate(deps, bus);
    const kept = saved[0]!.risks.find((r) => r.title === 'Odd risk');
    expect(kept).toBeDefined();
    expect(kept!.kind).toBe('other');
  });

  it('AC-32/AC-65/NFR-5: a timed-out model call fails the job with `model_timeout`, no retry', async () => {
    const bus = new RunBus();
    const llm = fakeLlm(async () => {
      throw new TimeoutError(90_000);
    });
    const { deps, saved } = baseDeps(llm, bus);
    const result = await runGenerate(deps, bus);
    expect(llm.calls).toHaveLength(1);
    expect(saved).toHaveLength(0);
    if (result.kind === 'started') {
      const events = bus.buffer(result.job_id);
      const failed = events.find((e) => (e.data as { type?: string } | undefined)?.type === 'failed');
      expect(failed).toBeDefined();
      expect((failed!.data as { code: string; message: string }).code).toBe(BRIEF_ERROR_MODEL_TIMEOUT);
      expect((failed!.data as { code: string; message: string }).message).toBe(BRIEF_ERROR_MODEL_TIMEOUT_MESSAGE);
    } else {
      throw new Error('expected a started job');
    }
  });

  it('AC-32/AC-65: a failed model call fails the job with `model_failed`, no retry, old brief untouched', async () => {
    const bus = new RunBus();
    const llm = fakeLlm(async () => {
      throw new Error('upstream exploded');
    });
    const { deps, saved } = baseDeps(llm, bus);
    const result = await runGenerate(deps, bus);
    expect(llm.calls).toHaveLength(1);
    expect(saved).toHaveLength(0);
    if (result.kind === 'started') {
      const events = bus.buffer(result.job_id);
      const failed = events.find((e) => (e.data as { type?: string } | undefined)?.type === 'failed');
      expect(failed).toBeDefined();
      expect((failed!.data as { code: string; message: string }).code).toBe(BRIEF_ERROR_MODEL_FAILED);
      expect((failed!.data as { code: string; message: string }).message).toBe(BRIEF_ERROR_MODEL_FAILED_MESSAGE);
      // The raw error text is never surfaced.
      expect(JSON.stringify(failed!.data)).not.toContain('upstream exploded');
    } else {
      throw new Error('expected a started job');
    }
  });
});
