import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvalCaseFields } from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { MockLLMProvider } from '../../adapters/mocks.js';
import type { AgentRow } from '../../db/rows.js';
import type { Container } from '../../platform/container.js';
import { AppError } from '../../platform/errors.js';
import { buildFrozenDiff } from './frozen-input.js';
import { sanitizeErrorReason } from './helpers.js';
import { EvalService } from './service.js';

/**
 * `EvalService.dryRun` over a hand-rolled container: no database, no network.
 * Every `evalRepo` write is a `vi.fn`, and none of them may ever be called —
 * a dry run stores nothing (AC60).
 */

const PATCH = ['@@ -1,3 +1,4 @@', ' const a = 1;', '+const b = 2;', ' const c = 3;', ' export {};'].join('\n');
const DEADLINE_MS = 120_000;

const REVIEW_WITH_ONE_HIT = {
  verdict: 'comment',
  summary: 'ok',
  score: 70,
  findings: [
    {
      id: 'm-1',
      severity: 'WARNING',
      category: 'test',
      title: 'in hunk',
      file: 'src/a.ts',
      start_line: 2,
      end_line: 2,
      rationale: 'because',
      confidence: 0.8,
    },
  ],
};

const fields: EvalCaseFields = {
  name: '',
  input_diff: buildFrozenDiff('src/a.ts', PATCH),
  expectation: {
    type: 'must_find',
    file: 'src/a.ts',
    start_line: 2,
    end_line: 2,
    severity: 'WARNING',
    category: 'test',
    title: 'ex',
  },
};

const agent = {
  id: 'agent-1',
  workspaceId: 'ws-1',
  name: 'Agent',
  provider: 'openrouter',
  model: 'm',
  systemPrompt: 'You review code.',
  strategy: 'single-pass',
  version: 4,
} as unknown as AgentRow;

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function setup() {
  const llm = new MockLLMProvider('openrouter', { structured: REVIEW_WITH_ONE_HIT });
  const writes = {
    insertCase: vi.fn(),
    updateCase: vi.fn(),
    deleteCase: vi.fn(),
    insertPendingRows: vi.fn(),
    completeRow: vi.fn(),
    errorRow: vi.fn(),
  };
  const evalRepo = {
    ...writes,
    hasPendingForAgent: vi.fn(async () => false),
    agentSkillRows: vi.fn(async () => []),
    reconcileStalePending: vi.fn(async () => 0),
  };
  const container = {
    evalRepo,
    reviewRepo: {},
    agentsRepo: {
      getById: vi.fn(async () => agent),
      list: vi.fn(async () => [agent]),
      getVersion: vi.fn(async () => undefined),
      ensureVersionSnapshot: vi.fn(async () => undefined),
    },
    canUseLlm: vi.fn(async () => true),
    llm: vi.fn(async () => llm),
  } as unknown as Container;
  const service = new EvalService(container, parseUnifiedDiff);
  const dryRun = () => service.dryRun('ws-1', 'agent-1', fields, logger);
  const expectNoWrites = () => {
    for (const [name, fn] of Object.entries(writes)) {
      expect(fn, `evalRepo.${name} must not be called by a dry run`).not.toHaveBeenCalled();
    }
  };
  /** The next provider call never settles; later calls use the scripted review again. */
  const hangNextCall = () =>
    vi.spyOn(llm, 'completeStructured').mockImplementationOnce((() => new Promise(() => {})) as never);
  return { llm, dryRun, expectNoWrites, hangNextCall };
}

/** Tracks a promise's state without awaiting it (and without an unhandled rejection). */
function track<T>(p: Promise<T>) {
  const box: { state: 'pending' | 'resolved' | 'rejected'; error?: unknown } = { state: 'pending' };
  p.then(
    () => (box.state = 'resolved'),
    (error: unknown) => {
      box.state = 'rejected';
      box.error = error;
    },
  );
  return box;
}

describe('EvalService.dryRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC61: gives up with 504 dry_run_timeout exactly at the 120 s deadline', async () => {
    const { dryRun, hangNextCall, expectNoWrites } = setup();
    hangNextCall();
    const run = dryRun();
    const box = track(run);

    await vi.advanceTimersByTimeAsync(DEADLINE_MS - 1);
    expect(box.state).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    await expect(run).rejects.toMatchObject({ code: 'dry_run_timeout', statusCode: 504 });
    expectNoWrites();
  });

  it('AC61: releases the agent lock at the deadline, so the next dry run is not refused with run_in_flight', async () => {
    const { dryRun, hangNextCall } = setup();
    hangNextCall();
    const first = dryRun();
    track(first);
    await vi.advanceTimersByTimeAsync(DEADLINE_MS);
    await expect(first).rejects.toMatchObject({ code: 'dry_run_timeout' });

    await expect(dryRun()).resolves.toMatchObject({ pass: true, agent_version: 4 });
  });

  it('AC62: turns a provider failure into 502 dry_run_failed with the sanitised reason', async () => {
    const { llm, dryRun, expectNoWrites } = setup();
    const failure = new Error('upstream 500 api_key=sk-test-123456789');
    vi.spyOn(llm, 'completeStructured').mockRejectedValue(failure);

    const error: unknown = await dryRun().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'dry_run_failed', statusCode: 502 });
    const message = (error as AppError).message;
    expect(message).toBe(sanitizeErrorReason(failure));
    expect(message).toContain('[redacted]');
    expect(message).not.toContain('sk-test-123456789');
    expectNoWrites();
  });

  it('AC59: returns the scored result of a grounded in-hunk finding', async () => {
    const { dryRun, expectNoWrites } = setup();
    await expect(dryRun()).resolves.toMatchObject({
      pass: true,
      grounding_kept: 1,
      agent_version: 4,
      findings: [{ file: 'src/a.ts', start_line: 2, matched: true }],
    });
    expectNoWrites();
  });

  it('AC59: makes exactly one provider review call', async () => {
    const { llm, dryRun } = setup();
    await dryRun().catch(() => undefined);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
  });
});
