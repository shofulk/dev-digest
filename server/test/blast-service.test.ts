import { describe, it, expect, vi } from 'vitest';
import { BlastService, type BlastIndexSource, type BlastPullSource } from '../src/modules/blast/service.js';
import { NotFoundError } from '../src/platform/errors.js';
import type { BlastFacadeResult } from '../src/modules/blast/helpers.js';

/**
 * T4 — `BlastService.forPull` with fake sources (hermetic). The fake
 * container only has `reviewRepo`, `repoIntel`, `config`, so any reach for an
 * LLM or clone-file adapter would throw at construction time already.
 */

function buildService(opts: {
  enabled?: boolean;
  pull?: { id: string; repoId: string } | undefined;
  files?: { path: string }[];
  indexState?: {
    status: 'full' | 'partial' | 'degraded' | 'failed';
    lastIndexedSha: string;
    degradedReason?: 'flag_off' | 'index_failed' | 'index_partial' | 'repo_too_large' | 'no_data';
  };
  facadeResult?: BlastFacadeResult;
  limits?: { maxCallersPerSymbol: number; bfsDepth: number };
}) {
  const getIndexState = vi.fn(async () => opts.indexState!);
  const getBlastRadius = vi.fn(async (): Promise<BlastFacadeResult> => opts.facadeResult ?? { changedSymbols: [], callers: [], impactedEndpoints: [] });
  const pulls: BlastPullSource = {
    getPull: async () => opts.pull,
    getPrFiles: async () => opts.files ?? [],
  };
  const index: BlastIndexSource = { getIndexState, getBlastRadius };
  const container = { reviewRepo: pulls, repoIntel: index, config: { repoIntelEnabled: opts.enabled ?? true } } as never;
  const svc = new BlastService(container, opts.limits ?? { maxCallersPerSymbol: 20, bfsDepth: 2 });
  return { svc, getIndexState, getBlastRadius };
}

function log() {
  const info = vi.fn();
  return { info };
}

describe('BlastService.forPull (T4)', () => {
  it('missing pull -> NotFoundError, index methods not called', async () => {
    const { svc, getIndexState, getBlastRadius } = buildService({ pull: undefined });
    await expect(svc.forPull('w1', 'p1', log())).rejects.toBeInstanceOf(NotFoundError);
    expect(getIndexState).not.toHaveBeenCalled();
    expect(getBlastRadius).not.toHaveBeenCalled();
  });

  it('no files -> NO_FILES_SUMMARY, index not called', async () => {
    const { svc, getIndexState, getBlastRadius } = buildService({ pull: { id: 'p1', repoId: 'r1' }, files: [] });
    const res = await svc.forPull('w1', 'p1', log());
    expect(res.summary).toMatch(/changed files/i);
    expect(getIndexState).not.toHaveBeenCalled();
    expect(getBlastRadius).not.toHaveBeenCalled();
  });

  it('flag off -> flag_off, getIndexState and getBlastRadius not called', async () => {
    const { svc, getIndexState, getBlastRadius } = buildService({
      enabled: false,
      pull: { id: 'p1', repoId: 'r1' },
      files: [{ path: 'a.ts' }],
    });
    const res = await svc.forPull('w1', 'p1', log());
    expect(res.degraded).toBe(true);
    expect(res.reason).toBe('flag_off');
    expect(getIndexState).not.toHaveBeenCalled();
    expect(getBlastRadius).not.toHaveBeenCalled();
  });

  it('index state degraded (synthesised) -> no_data, getBlastRadius not called, source: none', async () => {
    const { svc, getBlastRadius } = buildService({
      pull: { id: 'p1', repoId: 'r1' },
      files: [{ path: 'a.ts' }],
      indexState: { status: 'degraded', lastIndexedSha: '' },
    });
    const l = log();
    const res = await svc.forPull('w1', 'p1', l);
    expect(res.reason).toBe('no_data');
    expect(getBlastRadius).not.toHaveBeenCalled();
    expect(l.info).toHaveBeenCalledWith(expect.objectContaining({ source: 'none' }), 'blast: read from index');
  });

  it('failed -> index_failed', async () => {
    const { svc } = buildService({
      pull: { id: 'p1', repoId: 'r1' },
      files: [{ path: 'a.ts' }],
      indexState: { status: 'failed', lastIndexedSha: '' },
    });
    const res = await svc.forPull('w1', 'p1', log());
    expect(res.reason).toBe('index_failed');
  });

  it('partial -> map + index_partial', async () => {
    const facadeResult: BlastFacadeResult = {
      changedSymbols: [{ file: 'a.ts', name: 'alpha', kind: 'function' }],
      callers: [{ file: 'b.ts', symbol: 'h', viaSymbol: 'alpha', line: 1, rank: 1, depth: 1, via: null }],
      impactedEndpoints: [],
      degraded: false,
    };
    const { svc } = buildService({
      pull: { id: 'p1', repoId: 'r1' },
      files: [{ path: 'a.ts' }],
      indexState: { status: 'partial', lastIndexedSha: 'sha1' },
      facadeResult,
    });
    const res = await svc.forPull('w1', 'p1', log());
    expect(res.reason).toBe('index_partial');
    expect(res.downstream).toHaveLength(1);
  });

  it('full -> degraded:false and exactly one log.info with source:index, indexStatus:full, callers:2', async () => {
    const facadeResult: BlastFacadeResult = {
      changedSymbols: [{ file: 'a.ts', name: 'alpha', kind: 'function' }],
      callers: [
        { file: 'b.ts', symbol: 'h1', viaSymbol: 'alpha', line: 1, rank: 1, depth: 1, via: null },
        { file: 'c.ts', symbol: 'h2', viaSymbol: 'alpha', line: 1, rank: 1, depth: 1, via: null },
      ],
      impactedEndpoints: [],
      degraded: false,
    };
    const { svc } = buildService({
      pull: { id: 'p1', repoId: 'r1' },
      files: [{ path: 'a.ts' }],
      indexState: { status: 'full', lastIndexedSha: 'sha1' },
      facadeResult,
    });
    const l = log();
    const res = await svc.forPull('w1', 'p1', l);
    expect(res.degraded).toBe(false);
    expect(l.info).toHaveBeenCalledTimes(1);
    expect(l.info).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'index', indexStatus: 'full', callers: 2 }),
      'blast: read from index',
    );
  });

  it('facade returns degraded:true -> source: fallback, reason: no_data', async () => {
    const facadeResult: BlastFacadeResult = {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: true,
      reason: 'no_data',
    };
    const { svc } = buildService({
      pull: { id: 'p1', repoId: 'r1' },
      files: [{ path: 'a.ts' }],
      indexState: { status: 'full', lastIndexedSha: 'sha1' },
      facadeResult,
    });
    const l = log();
    const res = await svc.forPull('w1', 'p1', l);
    expect(res.reason).toBe('no_data');
    expect(l.info).toHaveBeenCalledWith(expect.objectContaining({ source: 'fallback' }), 'blast: read from index');
  });

  it('custom limits are echoed as limits.max_callers_per_symbol/bfs_depth', async () => {
    const { svc } = buildService({
      pull: { id: 'p1', repoId: 'r1' },
      files: [{ path: 'a.ts' }],
      indexState: { status: 'full', lastIndexedSha: 'sha1' },
      limits: { maxCallersPerSymbol: 7, bfsDepth: 3 },
    });
    const res = await svc.forPull('w1', 'p1', log());
    expect(res.limits).toEqual({ max_callers_per_symbol: 7, bfs_depth: 3 });
  });
});
