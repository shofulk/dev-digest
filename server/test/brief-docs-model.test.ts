/**
 * AFTER (test-writer, fix list F7) — PR Brief project-context document skip
 * reasons `too_large` and `invalid_path` (AC-11). Hermetic: `BriefService`
 * with a fake `BriefServiceDeps`, a real `RunBus`, a `MockLLMProvider`
 * standing in for the one model call, and a `MockProjectDocsSource` for
 * project-context documents. No DB, no network.
 *
 * Follows `brief-facts.test.ts`'s pattern (same fixtures, same
 * `buildDeps`/`runGenerate` shape) so both files stay interchangeable.
 */
import { describe, it, expect } from 'vitest';
import { BriefService, type BriefServiceDeps, type BriefPull, type BriefPrFile } from '../src/modules/brief/service.js';
import { RunBus } from '../src/platform/sse.js';
import { MockLLMProvider, MockProjectDocsSource } from '../src/adapters/mocks.js';
import type { BlastRadius, PrBrief, PrIntentRecord } from '@devdigest/shared';

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
  agentDocs?: { contextDocs: string[]; skills: { name: string; contextDocs: string[] }[] }[];
  docFiles?: Record<string, string>;
  docRoots?: string[];
  maxDocBytes?: number;
}

function buildDeps(scn: Scenario = {}) {
  const saved: PrBrief[] = [];
  const llm = new MockLLMProvider('openai', { structured: DRAFT_FIXTURE });
  const bus = new RunBus();
  const deps: BriefServiceDeps = {
    getPull: async () => ({ ...BASE_PULL }),
    getPrFiles: async () => BASE_FILES,
    getBrief: async () => null,
    saveBrief: async (brief) => {
      saved.push(brief);
    },
    readIntent: async () => BASE_INTENT,
    readBlast: async () => BASE_BLAST,
    listReviews: async () => [],
    listEnabledAgentDocs: async () => scn.agentDocs ?? [],
    projectDocs: new MockProjectDocsSource(scn.docFiles ?? {}),
    docRoots: scn.docRoots ?? ['**/*.md'],
    maxDocBytes: scn.maxDocBytes ?? 1_000_000,
    tokenizer: { count: (s: string) => s.length },
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

describe('BriefService project-context document skip reasons (fix list F7, AC-11)', () => {
  it('AC-11: a too-large document is skipped with `too_large` and listed in missing inputs', async () => {
    const { deps, bus, saved } = buildDeps({
      agentDocs: [{ contextDocs: ['docs/big.md'], skills: [] }],
      docFiles: { 'docs/big.md': 'X'.repeat(50) },
      docRoots: ['docs/**/*.md'],
      maxDocBytes: 10,
    });
    await runGenerate(deps, bus);
    expect(saved[0]!.missing_inputs).toContainEqual({
      input: 'document',
      state: 'skipped',
      detail: 'too_large: docs/big.md',
    });
  });

  it('AC-11: a document with an invalid path is skipped with `invalid_path` and listed in missing inputs', async () => {
    const { deps, bus, saved } = buildDeps({
      agentDocs: [{ contextDocs: ['../secret.md'], skills: [] }],
      docFiles: {},
      docRoots: ['docs/**/*.md'],
    });
    await runGenerate(deps, bus);
    expect(saved[0]!.missing_inputs).toContainEqual({
      input: 'document',
      state: 'skipped',
      detail: 'invalid_path: ../secret.md',
    });
  });

  it('AC-11: both `too_large` and `invalid_path` skips appear together in one generation', async () => {
    const { deps, bus, saved } = buildDeps({
      agentDocs: [{ contextDocs: ['docs/big.md', '../secret.md'], skills: [] }],
      docFiles: { 'docs/big.md': 'X'.repeat(50) },
      docRoots: ['docs/**/*.md'],
      maxDocBytes: 10,
    });
    await runGenerate(deps, bus);
    expect(saved[0]!.missing_inputs).toContainEqual({
      input: 'document',
      state: 'skipped',
      detail: 'too_large: docs/big.md',
    });
    expect(saved[0]!.missing_inputs).toContainEqual({
      input: 'document',
      state: 'skipped',
      detail: 'invalid_path: ../secret.md',
    });
  });
});
