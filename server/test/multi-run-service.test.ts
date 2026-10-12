import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunBus } from '../src/platform/sse.js';
import { AppError, NotFoundError } from '../src/platform/errors.js';

/**
 * SPEC-05 — `MultiRunService` use cases and `learnFromFinding`, hermetic: a
 * fake repo/agents pair stands in for Postgres and the executor is stubbed, so
 * nothing runs a model. Also pins NFR-6 (log lines carry ids/counts/statuses/
 * durations only).
 */

const executeRuns = vi.fn<(...args: unknown[]) => Promise<void>>();
vi.mock('../src/modules/reviews/run-executor.js', () => ({
  ReviewRunExecutor: class {
    executeRuns = executeRuns;
  },
}));

const { MultiRunService } = await import('../src/modules/reviews/multi-run-service.js');
const { learnFromFinding } = await import('../src/modules/reviews/learn.js');

const WS = 'ws-1';
const PR = '11111111-1111-4111-8111-111111111111';
const A1 = '22222222-2222-4222-8222-222222222221';
const A2 = '22222222-2222-4222-8222-222222222222';
const MULTI = '33333333-3333-4333-8333-333333333333';
const SECRET = 'SECRET-agent-name-and-error-text';

const pull = { id: PR, repoId: 'r1', number: 7, headSha: 'sha-1', workspaceId: WS };
const agent = (id: string, name = SECRET) => ({ id, name, provider: 'openai', model: 'm' });

function finding(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    severity: 'WARNING',
    category: 'bug',
    title: `title-${id}`,
    file: 'a.ts',
    startLine: 3,
    endLine: 4,
    rationale: 'why',
    suggestion: null,
    confidence: 0.5,
    kind: null,
    trifectaComponents: null,
    scope: null,
    reviewId: 'rev-1',
    acceptedAt: null,
    dismissedAt: null,
    ...over,
  };
}

function build(over: { repo?: Record<string, unknown>; agents?: Record<string, unknown> } = {}) {
  const bus = new RunBus();
  const repo = {
    getPull: vi.fn(async () => pull),
    getRepo: vi.fn(async () => ({ id: 'r1', owner: 'o', name: 'n' })),
    createMultiRunWithRuns: vi.fn(async (v: { runs: { agentId: string }[] }) => ({
      multiRunId: MULTI,
      runs: v.runs.map((r, i) => ({ runId: `run-${i}`, agentId: r.agentId })),
    })),
    getMultiRun: vi.fn(async () => ({ id: MULTI, prId: PR, headSha: 'sha-1', ranAt: new Date('2026-01-01T00:00:00Z') })),
    runsForMultiRun: vi.fn(async () => []),
    reviewsWithFindingsForRuns: vi.fn(async () => []),
    findLearnings: vi.fn(async () => new Set<string>()),
    cancelRunIfRunning: vi.fn(async () => true),
    createAgentRun: vi.fn(async () => 'run-retry'),
    createRetryRun: vi.fn(async (): Promise<unknown> => ({ status: 'created', runId: 'run-retry' })),
    estimateRunRows: vi.fn(async () => []),
    ...over.repo,
  };
  const agents = {
    getById: vi.fn(async (_w: string, id: string) => (id === A1 || id === A2 ? agent(id) : undefined)),
    list: vi.fn(async () => [agent(A1)]),
    ...over.agents,
  };
  const container = { reviewRepo: repo, agentsRepo: agents, runBus: bus, tokenizer: {} } as never;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { svc: new MultiRunService(container), repo, agents, bus, logger };
}

beforeEach(() => {
  executeRuns.mockReset();
  executeRuns.mockResolvedValue(undefined);
});

describe('MultiRunService.start', () => {
  it('creates one run per deduped agent, answers, and hands the jobs to the executor', async () => {
    const { svc, repo } = build();
    const res = await svc.start(WS, PR, [A1, A2, A1]);
    expect(repo.createMultiRunWithRuns).toHaveBeenCalledTimes(1);
    expect(res.multi_agent_run_id).toBe(MULTI);
    expect(res.runs.map((r) => r.agent_id)).toEqual([A1, A2]);
    expect(executeRuns).toHaveBeenCalledTimes(1);
    expect(executeRuns.mock.calls[0]![5]).toEqual({ multiRunId: MULTI });
  });

  it('unknown or malformed PR / agent -> NotFoundError and nothing is created', async () => {
    const { svc, repo } = build();
    await expect(svc.start(WS, 'not-a-uuid', [A1])).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.start(WS, PR, [A1, '99999999-9999-4999-8999-999999999999'])).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.start(WS, PR, ['not-a-uuid'])).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.createMultiRunWithRuns).not.toHaveBeenCalled();
    expect(executeRuns).not.toHaveBeenCalled();
  });
});

describe('MultiRunService.read', () => {
  it('unknown multi-run -> NotFoundError', async () => {
    const { svc } = build({ repo: { getMultiRun: vi.fn(async () => undefined) } });
    await expect(svc.read(WS, MULTI)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('builds sorted columns with the learned flag from the shared mapper and flags a moved head as stale', async () => {
    const run = (id: string, agentId: string, agentName: string) => ({
      run: { id, agentId, status: 'done', provider: 'openai', model: 'm', score: 80, durationMs: 10, costUsd: 0.5, error: null },
      agentName,
    });
    const rev = (runId: string, ids: string[]) => ({
      review: { runId, verdict: 'approve', score: 80, summary: 's' },
      findings: ids.map((i) => finding(i)),
    });
    const { svc, repo } = build({
      repo: {
        getPull: vi.fn(async () => ({ ...pull, headSha: 'sha-2' })),
        runsForMultiRun: vi.fn(async () => [run('r-b', A2, 'Beta'), run('r-a', A1, 'alpha')]),
        reviewsWithFindingsForRuns: vi.fn(async () => [rev('r-a', ['f2', 'f1']), rev('r-b', [])]),
        findLearnings: vi.fn(async () => new Set(['f1'])),
      },
    });
    const out = await svc.read(WS, MULTI);
    expect(repo.findLearnings).toHaveBeenCalledWith(WS, expect.arrayContaining(['f1', 'f2']));
    expect(out.columns.map((c) => c.agent_name)).toEqual(['alpha', 'Beta']);
    const f = out.columns[0]!.findings;
    expect(f.map((x) => [x.id, x.learned])).toEqual([
      ['f1', true],
      ['f2', false],
    ]);
    expect(out.stale).toBe(true);
    expect(out.pr_number).toBe(7);
    expect(out.agent_count).toBe(2);
  });
});

describe('MultiRunService.cancel', () => {
  it('cancels only running runs and signals the bus', async () => {
    const mk = (id: string, status: string) => ({ run: { id, status }, agentName: 'x' });
    const { svc, repo, bus } = build({
      repo: { runsForMultiRun: vi.fn(async () => [mk('r1', 'running'), mk('r2', 'done')]) },
    });
    const cancelSpy = vi.spyOn(bus, 'cancel');
    const res = await svc.cancel(WS, MULTI);
    expect(res).toEqual({ ok: true, run_ids: ['r1'] });
    expect(repo.cancelRunIfRunning).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledWith('r1');
  });

  it('unknown multi-run -> NotFoundError', async () => {
    const { svc } = build({ repo: { getMultiRun: vi.fn(async () => undefined) } });
    await expect(svc.cancel(WS, MULTI)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('MultiRunService.retry (D15)', () => {
  it('D15: hands the whole decision to repo.createRetryRun once, and never reads runs or creates a run itself', async () => {
    const { svc, repo } = build();
    await svc.retry(WS, MULTI, A1);
    expect(repo.createRetryRun).toHaveBeenCalledTimes(1);
    expect(repo.createRetryRun).toHaveBeenCalledWith({
      workspaceId: WS,
      multiRunId: MULTI,
      agentId: A1,
      prId: PR,
      provider: 'openai',
      model: 'm',
    });
    expect(repo.createAgentRun).not.toHaveBeenCalled();
    expect(repo.runsForMultiRun).not.toHaveBeenCalled();
  });

  it('D15: { status: running } -> AppError 409 agent_running and the executor is not called', async () => {
    const { svc } = build({ repo: { createRetryRun: vi.fn(async () => ({ status: 'running' })) } });
    const err = await svc.retry(WS, MULTI, A1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(409);
    expect((err as AppError).code).toBe('agent_running');
    expect(executeRuns).not.toHaveBeenCalled();
  });

  it('D15: { status: no_run } -> NotFoundError and the executor is not called', async () => {
    const { svc } = build({ repo: { createRetryRun: vi.fn(async () => ({ status: 'no_run' })) } });
    await expect(svc.retry(WS, MULTI, A1)).rejects.toBeInstanceOf(NotFoundError);
    expect(executeRuns).not.toHaveBeenCalled();
  });

  it('D15: { status: created, runId } -> answers { run_id } and hands exactly one job to the executor', async () => {
    const { svc } = build({ repo: { createRetryRun: vi.fn(async () => ({ status: 'created', runId: 'run-new' })) } });
    const res = await svc.retry(WS, MULTI, A1);
    expect(res).toEqual({ run_id: 'run-new' });
    expect(executeRuns).toHaveBeenCalledTimes(1);
    const jobs = executeRuns.mock.calls[0]![3] as { runId: string }[];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.runId).toBe('run-new');
  });

  it('AC-45: unknown multi-run or unknown agent -> NotFoundError and no retry is attempted', async () => {
    const gone = build({ repo: { getMultiRun: vi.fn(async () => undefined) } });
    await expect(gone.svc.retry(WS, MULTI, A1)).rejects.toBeInstanceOf(NotFoundError);
    const noAgent = build();
    await expect(noAgent.svc.retry(WS, MULTI, 'nope')).rejects.toBeInstanceOf(NotFoundError);
    expect(gone.repo.createRetryRun).not.toHaveBeenCalled();
    expect(noAgent.repo.createRetryRun).not.toHaveBeenCalled();
  });
});

describe('MultiRunService.assertRunsInMultiRun (D17)', () => {
  const R1 = '44444444-4444-4444-8444-444444444441';
  const R2 = '44444444-4444-4444-8444-444444444442';
  const OTHER = '44444444-4444-4444-8444-444444444449';
  const two = () =>
    vi.fn(async () => [
      { run: { id: R1, agentId: A1, status: 'done' }, agentName: 'x' },
      { run: { id: R2, agentId: A2, status: 'done' }, agentName: 'y' },
    ]);

  it('D17: resolves when every id is a run of the multi-run, returning the ids no longer running in the DB', async () => {
    const { svc } = build({ repo: { runsForMultiRun: two() } });
    await expect(svc.assertRunsInMultiRun(WS, MULTI, [R1, R2])).resolves.toEqual([R1, R2]);
    const mixed = build({
      repo: {
        runsForMultiRun: vi.fn(async () => [
          { run: { id: R1, agentId: A1, status: 'running' }, agentName: 'x' },
          { run: { id: R2, agentId: A2, status: 'failed' }, agentName: 'y' },
        ]),
      },
    });
    await expect(mixed.svc.assertRunsInMultiRun(WS, MULTI, [R1, R2])).resolves.toEqual([R2]);
  });

  it('D17: an id that is not a run of the multi-run rejects with NotFoundError', async () => {
    const { svc } = build({ repo: { runsForMultiRun: two() } });
    await expect(svc.assertRunsInMultiRun(WS, MULTI, [R1, OTHER])).rejects.toBeInstanceOf(NotFoundError);
  });

  it('D17: an unknown multi-run rejects with NotFoundError', async () => {
    const { svc } = build({ repo: { getMultiRun: vi.fn(async () => undefined), runsForMultiRun: two() } });
    await expect(svc.assertRunsInMultiRun(WS, MULTI, [R1])).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('MultiRunService logging (NFR-6)', () => {
  it('a crashed background execution logs only ids — no agent name, error text or titles', async () => {
    executeRuns.mockRejectedValue(new Error(`${SECRET} stack with prompt and diff`));
    const { svc, logger } = build({
      repo: { runsForMultiRun: vi.fn(async () => [{ run: { id: 'old', agentId: A1, status: 'done' }, agentName: SECRET }]) },
    });
    await svc.start(WS, PR, [A1], logger);
    await svc.retry(WS, MULTI, A1, logger);
    await new Promise((r) => setTimeout(r, 10));
    expect(logger.error).toHaveBeenCalledTimes(2);
    const idPattern = /^[\w-]+$/;
    for (const [obj, msg] of logger.error.mock.calls as [Record<string, unknown>, string][]) {
      for (const v of Object.values(obj)) expect(String(v)).toMatch(idPattern);
      const dump = JSON.stringify([obj, msg]);
      expect(dump).not.toContain(SECRET);
      expect(dump).not.toContain('stack');
      expect(Object.keys(obj).sort()).toEqual(
        Object.keys(obj).filter((k) => ['prId', 'runId', 'agentId', 'multiRunId'].includes(k)).sort(),
      );
    }
  });
});

describe('MultiRunService.estimates', () => {
  it('returns one estimate per workspace agent', async () => {
    const { svc } = build();
    const res = await svc.estimates(WS);
    expect(res.map((e) => e.agent_id)).toEqual([A1]);
  });
});

describe('learnFromFinding', () => {
  const ctx = (workspaceId: string) => ({
    finding: finding('f1', { title: 'T', rationale: 'R' }),
    pull: { ...pull, workspaceId },
  });
  const memRow = { id: 'm1', content: 'T\n\nR', kind: 'learning', scope: 'repo' };

  it('stores one learning memory row from title + rationale and reports created', async () => {
    const repo = { findingContext: vi.fn(async () => ctx(WS)), learnOnce: vi.fn(async () => ({ row: memRow, created: true })) };
    const out = await learnFromFinding(repo as never, WS, 'f1');
    expect(repo.learnOnce).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, repoId: 'r1', content: 'T\n\nR', prNumber: 7, findingId: 'f1' }),
    );
    expect(out).toEqual({ id: 'm1', content: 'T\n\nR', kind: 'learning', scope: 'repo', created: true });
  });

  it('is idempotent: a repeat reports created=false', async () => {
    const repo = { findingContext: vi.fn(async () => ctx(WS)), learnOnce: vi.fn(async () => ({ row: memRow, created: false })) };
    expect((await learnFromFinding(repo as never, WS, 'f1')).created).toBe(false);
  });

  it('a missing finding or another workspace -> NotFoundError and nothing is stored', async () => {
    const missing = { findingContext: vi.fn(async () => undefined), learnOnce: vi.fn() };
    await expect(learnFromFinding(missing as never, WS, 'f1')).rejects.toBeInstanceOf(NotFoundError);
    const other = { findingContext: vi.fn(async () => ctx('ws-other')), learnOnce: vi.fn() };
    await expect(learnFromFinding(other as never, WS, 'f1')).rejects.toBeInstanceOf(NotFoundError);
    expect(missing.learnOnce).not.toHaveBeenCalled();
    expect(other.learnOnce).not.toHaveBeenCalled();
  });
});
