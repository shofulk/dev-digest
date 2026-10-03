import { describe, it, expect } from 'vitest';
import {
  mapFacadeBlast,
  summarizeBlast,
  deriveBlastStatus,
  type BlastFacadeCaller,
  type BlastFacadeResult,
} from '../src/modules/blast/helpers.js';
import { NO_SYMBOLS_SUMMARY } from '../src/modules/blast/constants.js';

function caller(overrides: Partial<BlastFacadeCaller>): BlastFacadeCaller {
  return {
    file: 'caller.ts',
    symbol: 'callerFn',
    viaSymbol: 'alpha',
    line: 1,
    rank: 0,
    depth: 1,
    via: null,
    ...overrides,
  };
}

describe('mapFacadeBlast (T3)', () => {
  it('groups interleaved callers by viaSymbol in first-appearance order', () => {
    const fb: BlastFacadeResult = {
      changedSymbols: [
        { file: 'a.ts', name: 'alpha', kind: 'function' },
        { file: 'b.ts', name: 'beta', kind: 'function' },
      ],
      callers: [
        caller({ viaSymbol: 'alpha', file: 'c1.ts', line: 1 }),
        caller({ viaSymbol: 'beta', file: 'c2.ts', line: 2 }),
        caller({ viaSymbol: 'alpha', file: 'c3.ts', line: 3 }),
      ],
      impactedEndpoints: [],
    };
    const { downstream } = mapFacadeBlast(fb);
    expect(downstream.map((d) => d.symbol)).toEqual(['alpha', 'beta']);
    expect(downstream[0]!.callers).toHaveLength(2);
    expect(downstream[1]!.callers).toHaveLength(1);
  });

  it('attributes endpoints/crons per symbol from its own callers’ files, deduped; crons never in endpoints_affected', () => {
    const fb: BlastFacadeResult = {
      changedSymbols: [
        { file: 'a.ts', name: 'alpha', kind: 'function' },
        { file: 'b.ts', name: 'beta', kind: 'function' },
      ],
      callers: [
        caller({ viaSymbol: 'alpha', file: 'route.ts', line: 1 }),
        caller({ viaSymbol: 'alpha', file: 'route.ts', line: 2 }),
        caller({ viaSymbol: 'beta', file: 'cron.ts', line: 1 }),
      ],
      impactedEndpoints: [],
      factsByFile: {
        'route.ts': { endpoints: ['GET /users'], crons: [] },
        'cron.ts': { endpoints: [], crons: ['job:cleanup'] },
      },
    };
    const { downstream } = mapFacadeBlast(fb);
    const alpha = downstream.find((d) => d.symbol === 'alpha')!;
    const beta = downstream.find((d) => d.symbol === 'beta')!;
    expect(alpha.endpoints_affected).toEqual(['GET /users']);
    expect(alpha.crons_affected).toEqual([]);
    expect(beta.endpoints_affected).toEqual([]);
    expect(beta.crons_affected).toEqual(['job:cleanup']);
  });

  it('a depth-2 caller keeps depth/via and its file’s endpoint feeds the symbol', () => {
    const fb: BlastFacadeResult = {
      changedSymbols: [{ file: 'a.ts', name: 'alpha', kind: 'function' }],
      callers: [
        caller({ viaSymbol: 'alpha', file: 'b.ts', symbol: 'handle', line: 10, depth: 1, via: null }),
        caller({ viaSymbol: 'alpha', file: 'c.ts', symbol: 'route', line: 30, depth: 2, via: 'handle' }),
      ],
      impactedEndpoints: [],
      factsByFile: { 'c.ts': { endpoints: ['POST /orders'], crons: [] } },
    };
    const { downstream } = mapFacadeBlast(fb);
    const alpha = downstream[0]!;
    expect(alpha.endpoints_affected).toEqual(['POST /orders']);
    const mapped = alpha.callers.find((c) => c.file === 'c.ts')!;
    expect(mapped.depth).toBe(2);
    expect(mapped.via).toBe('handle');
  });

  it('drops a duplicate file|name|line row (shallower depth wins) and a caller in the symbol’s declaring file', () => {
    const fb: BlastFacadeResult = {
      changedSymbols: [{ file: 'a.ts', name: 'alpha', kind: 'function' }],
      callers: [
        caller({ viaSymbol: 'alpha', file: 'b.ts', symbol: 'handle', line: 10, depth: 1 }),
        // duplicate file|name|line at a deeper depth -> dropped
        caller({ viaSymbol: 'alpha', file: 'b.ts', symbol: 'handle', line: 10, depth: 2, via: 'x' }),
        // caller in the declaring file of alpha -> dropped
        caller({ viaSymbol: 'alpha', file: 'a.ts', symbol: 'otherFn', line: 5, depth: 1 }),
        // a caller in a DIFFERENT changed file is kept
        caller({ viaSymbol: 'alpha', file: 'd.ts', symbol: 'keepFn', line: 1, depth: 1 }),
      ],
      impactedEndpoints: [],
    };
    const { downstream } = mapFacadeBlast(fb);
    const alpha = downstream[0]!;
    expect(alpha.callers).toHaveLength(2);
    expect(alpha.callers.find((c) => c.file === 'b.ts')!.depth).toBe(1);
    expect(alpha.callers.find((c) => c.file === 'a.ts')).toBeUndefined();
    expect(alpha.callers.find((c) => c.file === 'd.ts')).toBeDefined();
  });

  it('a caller line reaching two changed symbols (e.g. format(parse(x))) is kept in both groups', () => {
    const fb: BlastFacadeResult = {
      changedSymbols: [
        { file: 'a.ts', name: 'parse', kind: 'function' },
        { file: 'b.ts', name: 'format', kind: 'function' },
      ],
      callers: [
        // ui.ts:12 calls both `parse` and `format`, so the same file|symbol|line
        // shows up once per viaSymbol.
        caller({ viaSymbol: 'parse', file: 'ui.ts', symbol: 'render', line: 12 }),
        caller({ viaSymbol: 'format', file: 'ui.ts', symbol: 'render', line: 12 }),
      ],
      impactedEndpoints: [],
      factsByFile: { 'ui.ts': { endpoints: ['GET /x'], crons: [] } },
    };
    const { downstream } = mapFacadeBlast(fb);
    const parse = downstream.find((d) => d.symbol === 'parse')!;
    const format = downstream.find((d) => d.symbol === 'format')!;
    expect(parse.callers).toHaveLength(1);
    expect(format.callers).toHaveLength(1);
    expect(parse.callers[0]!.file).toBe('ui.ts');
    expect(format.callers[0]!.file).toBe('ui.ts');
    expect(parse.endpoints_affected).toEqual(['GET /x']);
    expect(format.endpoints_affected).toEqual(['GET /x']);
  });
});

describe('summarizeBlast (T3)', () => {
  it('matches for an empty changed-symbols set', () => {
    expect(summarizeBlast([], [])).toBe(NO_SYMBOLS_SUMMARY);
  });

  it('summarises counts', () => {
    const text = summarizeBlast(
      [{ file: 'a.ts', name: 'alpha', kind: 'function' }],
      [
        {
          symbol: 'alpha',
          callers: [{ name: 'c', file: 'c.ts', line: 1 }],
          endpoints_affected: ['GET /x'],
          crons_affected: [],
        },
      ],
    );
    expect(text).toContain('1 changed symbol');
    expect(text).toContain('1 caller');
    expect(text).toContain('1 endpoint');
  });
});

describe('deriveBlastStatus (T3)', () => {
  it('flag off', () => {
    expect(deriveBlastStatus({ enabled: false, indexStatus: 'full' })).toEqual({
      degraded: true,
      reason: 'flag_off',
    });
  });

  it('degraded without a reason -> no_data', () => {
    expect(deriveBlastStatus({ enabled: true, indexStatus: 'degraded' })).toEqual({
      degraded: true,
      reason: 'no_data',
    });
  });

  it('degraded with repo_too_large stamped', () => {
    expect(
      deriveBlastStatus({ enabled: true, indexStatus: 'degraded', indexReason: 'repo_too_large' }),
    ).toEqual({ degraded: true, reason: 'repo_too_large' });
  });

  it('failed -> index_failed', () => {
    expect(deriveBlastStatus({ enabled: true, indexStatus: 'failed' })).toEqual({
      degraded: true,
      reason: 'index_failed',
    });
  });

  it('partial -> index_partial', () => {
    expect(deriveBlastStatus({ enabled: true, indexStatus: 'partial' })).toEqual({
      degraded: true,
      reason: 'index_partial',
    });
  });

  it('full -> not degraded', () => {
    expect(deriveBlastStatus({ enabled: true, indexStatus: 'full' })).toEqual({
      degraded: false,
      reason: null,
    });
  });

  it('full + facade degraded -> no_data', () => {
    expect(
      deriveBlastStatus({ enabled: true, indexStatus: 'full', facadeDegraded: true }),
    ).toEqual({ degraded: true, reason: 'no_data' });
  });

  it('an unknown reason string is not blind-cast: falls back to a sensible default', () => {
    expect(
      deriveBlastStatus({ enabled: true, indexStatus: 'failed', indexReason: 'totally_bogus' }),
    ).toEqual({ degraded: true, reason: 'index_failed' });
    expect(
      deriveBlastStatus({ enabled: true, indexStatus: 'degraded', indexReason: 'totally_bogus' }),
    ).toEqual({ degraded: true, reason: 'no_data' });
    expect(
      deriveBlastStatus({ enabled: true, indexStatus: 'full', facadeDegraded: true, facadeReason: 'totally_bogus' }),
    ).toEqual({ degraded: true, reason: 'no_data' });
  });
});
