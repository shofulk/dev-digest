import { describe, it, expect, vi } from 'vitest';
import { RunBus } from '../src/platform/sse.js';
import { NotFoundError } from '../src/platform/errors.js';

/**
 * SPEC-04 — `MultiRunService.list`, hermetic: a fake repo stands in for
 * Postgres (same pattern as multi-run-service.test.ts) and the executor is
 * stubbed. The container's `github` / `llm` are spies, so "makes no GitHub or
 * model call" (AC-88, H-NFR-2) is observable.
 */

vi.mock('../src/modules/reviews/run-executor.js', () => ({
  ReviewRunExecutor: class {
    executeRuns = vi.fn(async () => undefined);
  },
}));

const { MultiRunService } = await import('../src/modules/reviews/multi-run-service.js');

const WS = 'ws-1';
const REPO = '44444444-4444-4444-8444-444444444444';
const PR = '11111111-1111-4111-8111-111111111111';
const A1 = '22222222-2222-4222-8222-222222222221';
const A2 = '22222222-2222-4222-8222-222222222222';
const M1 = '33333333-3333-4333-8333-333333333331';
const M2 = '33333333-3333-4333-8333-333333333332';
const M3 = '33333333-3333-4333-8333-333333333333';
const TITLE_MARKER = 'SECRET-pr-title-<script>';

type MultiRow = { id: string; prId: string; ranAt: Date; prNumber: number; prTitle: string };
type RunRow = {
  id: string;
  multiAgentRunId: string;
  agentId: string | null;
  status: string | null;
  durationMs: number | null;
  costUsd: number | null;
};

const multi = (id: string, over: Partial<MultiRow> = {}): MultiRow => ({
  id,
  prId: PR,
  ranAt: new Date('2026-03-04T05:06:07.000Z'),
  prNumber: 482,
  prTitle: 'Add rate limiting',
  ...over,
});
const run = (id: string, multiAgentRunId: string, agentId: string | null, status: string | null, over: Partial<RunRow> = {}): RunRow => ({
  id,
  multiAgentRunId,
  agentId,
  status,
  durationMs: 1000,
  costUsd: 0.01,
  ...over,
});

function build(
  rows: { multiRuns: MultiRow[]; runs: RunRow[] } = { multiRuns: [], runs: [] },
  over: { repo?: Record<string, unknown>; github?: () => unknown } = {},
) {
  const repo = {
    repoInWorkspace: vi.fn(async () => true),
    getPull: vi.fn(async () => ({ id: PR, repoId: REPO, number: 482, workspaceId: WS })),
    listMultiRunSummaryRows: vi.fn(async () => rows),
    ...over.repo,
  };
  const githubFactory = vi.fn(over.github ?? (() => ({ getPull: vi.fn(), listPulls: vi.fn() })));
  const llmFactory = vi.fn(async () => ({ complete: vi.fn() }));
  const container = {
    reviewRepo: repo,
    agentsRepo: {},
    runBus: new RunBus(),
    tokenizer: {},
    github: githubFactory,
    llm: llmFactory,
  } as never;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { svc: new MultiRunService(container), repo, githubFactory, llmFactory, logger };
}

describe('MultiRunService.list', () => {
  it('AC-78: builds every list-item field from the stub rows, ran_at as ISO', async () => {
    const { svc, repo } = build({
      multiRuns: [multi(M1, { prNumber: 7, prTitle: 'Fix the thing', ranAt: new Date('2026-01-02T03:04:05.678Z') })],
      runs: [
        run('r1', M1, A1, 'done', { durationMs: 4000, costUsd: 0.25 }),
        run('r2', M1, A2, 'done', { durationMs: 9000, costUsd: 0.5 }),
      ],
    });
    const out = await svc.list(WS, REPO);
    expect(repo.listMultiRunSummaryRows).toHaveBeenCalledTimes(1);
    expect(repo.listMultiRunSummaryRows).toHaveBeenCalledWith(WS, REPO, undefined, 20);
    expect(out).toEqual([
      {
        id: M1,
        pr_id: PR,
        pr_number: 7,
        pr_title: 'Fix the thing',
        ran_at: '2026-01-02T03:04:05.678Z',
        agent_count: 2,
        status: 'done',
        total_duration_ms: 9000,
        total_cost_usd: 0.75,
      },
    ]);
  });

  it('AC-78: keeps the order of the repository rows', async () => {
    const { svc } = build({
      multiRuns: [multi(M3), multi(M1), multi(M2)],
      runs: [run('r1', M1, A1, 'done'), run('r2', M2, A1, 'failed'), run('r3', M3, A1, 'running')],
    });
    const out = await svc.list(WS, REPO);
    expect(out.map((i) => i.id)).toEqual([M3, M1, M2]);
    expect(out.map((i) => i.status)).toEqual(['running', 'done', 'failed']);
  });

  it('AC-106, AC-79: an agent retried after a failure counts only the newer done run', async () => {
    // Runs arrive ran_at desc: the retry is listed before the failed original.
    const { svc } = build({
      multiRuns: [multi(M1)],
      runs: [
        run('retry', M1, A1, 'done', { durationMs: 3000, costUsd: 0.2 }),
        run('first', M1, A1, 'failed', { durationMs: 9999, costUsd: 5 }),
      ],
    });
    const [item] = await svc.list(WS, REPO);
    expect(item!.agent_count).toBe(1);
    expect(item!.status).toBe('done');
    expect(item!.total_duration_ms).toBe(3000);
    expect(item!.total_cost_usd).toBe(0.2);
  });

  it('AC-81: a multi-run whose runs all have null agent ids -> agent_count 0 and status failed', async () => {
    const { svc } = build({
      multiRuns: [multi(M1)],
      runs: [run('r1', M1, null, 'done'), run('r2', M1, null, 'running')],
    });
    const [item] = await svc.list(WS, REPO);
    expect(item!.agent_count).toBe(0);
    expect(item!.status).toBe('failed');
    expect(item!.total_duration_ms).toBe(0);
    expect(item!.total_cost_usd).toBeNull();
  });

  it('AC-81: a multi-run without any agent run row -> agent_count 0 and status failed', async () => {
    const { svc } = build({ multiRuns: [multi(M1)], runs: [] });
    const [item] = await svc.list(WS, REPO);
    expect(item).toMatchObject({ id: M1, agent_count: 0, status: 'failed', total_duration_ms: 0, total_cost_usd: null });
  });

  it('AC-88, H-NFR-2: GitHub failing with "no token" gives the same output as a working client, and neither github nor llm is called', async () => {
    const rows = {
      multiRuns: [multi(M1), multi(M2)],
      runs: [run('r1', M1, A1, 'done'), run('r2', M1, A2, 'failed'), run('r3', M2, A1, 'running')],
    };
    const broken = build(rows, {
      github: () => {
        throw new Error('no token');
      },
    });
    const working = build(rows);
    const fromBroken = await broken.svc.list(WS, REPO);
    const fromWorking = await working.svc.list(WS, REPO);
    expect(fromBroken).toHaveLength(2);
    expect(fromBroken).toEqual(fromWorking);
    for (const env of [broken, working]) {
      expect(env.githubFactory).toHaveBeenCalledTimes(0);
      expect(env.llmFactory).toHaveBeenCalledTimes(0);
    }
  });

  it('H-NFR-4: logs no PR title and only keys from { repoId, prId, count }', async () => {
    const { svc, logger } = build(
      { multiRuns: [multi(M1, { prTitle: `${TITLE_MARKER}` })], runs: [run('r1', M1, A1, 'done')] },
    );
    // The item must exist, so a skeleton that throws before logging cannot pass vacuously.
    const out = await svc.list(WS, REPO, PR, logger);
    expect(out).toHaveLength(1);
    expect(out[0]!.pr_title).toBe(TITLE_MARKER);
    const allowed = new Set(['repoId', 'prId', 'count']);
    const calls = [logger.info, logger.warn, logger.error, logger.debug].flatMap((fn) => fn.mock.calls as unknown[][]);
    for (const args of calls) {
      expect(JSON.stringify(args)).not.toContain('SECRET-pr-title');
      const [obj] = args;
      if (obj && typeof obj === 'object') {
        for (const k of Object.keys(obj)) expect(allowed.has(k)).toBe(true);
      }
    }
  });

  it('AC-86: repo not in the workspace -> NotFoundError and the rows are never read', async () => {
    const { svc, repo } = build(undefined, { repo: { repoInWorkspace: vi.fn(async () => false) } });
    await expect(svc.list(WS, REPO)).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.repoInWorkspace).toHaveBeenCalledWith(WS, REPO);
    expect(repo.listMultiRunSummaryRows).not.toHaveBeenCalled();
  });

  it('AC-85: a pr_id that is unknown, or whose pull belongs to another repo -> NotFoundError', async () => {
    const other = build(undefined, {
      repo: { getPull: vi.fn(async () => ({ id: PR, repoId: 'some-other-repo', number: 1, workspaceId: WS })) },
    });
    await expect(other.svc.list(WS, REPO, PR)).rejects.toBeInstanceOf(NotFoundError);
    expect(other.repo.listMultiRunSummaryRows).not.toHaveBeenCalled();

    const unknown = build(undefined, { repo: { getPull: vi.fn(async () => undefined) } });
    await expect(unknown.svc.list(WS, REPO, PR)).rejects.toBeInstanceOf(NotFoundError);
    expect(unknown.repo.listMultiRunSummaryRows).not.toHaveBeenCalled();
  });

  it('AC-84: a pr_id of this repo is passed to the repository query', async () => {
    const { svc, repo } = build({ multiRuns: [multi(M1)], runs: [run('r1', M1, A1, 'done')] });
    const out = await svc.list(WS, REPO, PR);
    expect(repo.listMultiRunSummaryRows).toHaveBeenCalledWith(WS, REPO, PR, 20);
    expect(out).toHaveLength(1);
  });
});
