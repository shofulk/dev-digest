import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import type { FullSymbolRow, ResolvedCallerRow } from '../src/modules/repo-intel/repository.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';

/**
 * T2 — persistent-index blast BFS (`tryPersistentBlast`), hermetic. No Postgres:
 * `RepoIntelService.repo` is patched with an in-memory fake that honours its
 * `declFiles`/`names` arguments as the real SQL does — an independent
 * cross product, not a paired match — so the facade's own JS pair filter is
 * really exercised, per AC7/AC8.
 */

interface FakeSymbol {
  name: string;
  kind: string;
  line: number;
  exported: boolean;
}

interface FakeReference {
  fromPath: string;
  toSymbol: string;
  line: number;
  rank: number;
  declFile: string | null;
}

function buildService(opts: {
  symbols: Record<string, FakeSymbol[]>;
  references: FakeReference[];
  facts?: Record<string, { endpoints: string[]; crons: string[] }>;
  indexState?: IndexState | null;
  onResolvedCallers?: (declFiles: string[], names: string[]) => void;
}): RepoIntelService {
  const indexState: IndexState = opts.indexState ?? {
    repoId: 'r1',
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 1,
    lastIndexedSha: 'abc',
    indexerVersion: 1,
    updatedAt: new Date(),
  };
  const container = {
    config: { repoIntelEnabled: true },
    db: {} as never,
    codeIndex: { symbols: async () => [], references: async () => [] } as never,
  } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    tryGetIndexState: async () => indexState,
    getSymbolRows: async (_repoId: string, paths: string[]): Promise<FullSymbolRow[]> => {
      const out: FullSymbolRow[] = [];
      for (const p of paths) {
        for (const s of opts.symbols[p] ?? []) {
          out.push({
            path: p,
            name: s.name,
            kind: s.kind,
            line: s.line,
            endLine: s.line,
            exported: s.exported,
            signature: null,
          });
        }
      }
      return out;
    },
    getResolvedCallers: async (
      _repoId: string,
      declFiles: string[],
      names: string[],
    ): Promise<ResolvedCallerRow[]> => {
      opts.onResolvedCallers?.(declFiles, names);
      return opts.references
        .filter((r) => r.declFile != null && declFiles.includes(r.declFile) && names.includes(r.toSymbol))
        .map((r) => ({ fromPath: r.fromPath, toSymbol: r.toSymbol, line: r.line, rank: r.rank, declFile: r.declFile }));
    },
    getFileFacts: async (_repoId: string, files: string[]) =>
      files
        .filter((f) => opts.facts?.[f])
        .map((f) => ({ filePath: f, endpoints: opts.facts![f]!.endpoints, crons: opts.facts![f]!.crons })),
  };
  return svc;
}

describe('RepoIntelService persistent blast — BFS depth, precision, cap (T2)', () => {
  it('(a) 2-hop chain: a depth-2 caller carries via/viaSymbol and its file reaches factsByFile', async () => {
    const svc = buildService({
      symbols: {
        'a.ts': [{ name: 'alpha', kind: 'function', line: 1, exported: true }],
        'b.ts': [{ name: 'handle', kind: 'function', line: 5, exported: true }],
        'c.ts': [{ name: 'route', kind: 'function', line: 25, exported: false }],
      },
      references: [
        { fromPath: 'b.ts', toSymbol: 'alpha', line: 10, rank: 50, declFile: 'a.ts' },
        { fromPath: 'c.ts', toSymbol: 'handle', line: 30, rank: 40, declFile: 'b.ts' },
      ],
      facts: { 'c.ts': { endpoints: [], crons: [] } },
    });
    const blast = await svc.getBlastRadius('r1', ['a.ts']);
    expect(blast.degraded).toBe(false);
    expect(blast.changedSymbols).toEqual([{ file: 'a.ts', name: 'alpha', kind: 'function' }]);
    const direct = blast.callers.find((c) => c.file === 'b.ts');
    expect(direct).toMatchObject({ symbol: 'handle', viaSymbol: 'alpha', line: 10, depth: 1, via: null });
    const hop2 = blast.callers.find((c) => c.file === 'c.ts');
    expect(hop2).toMatchObject({ symbol: 'route', viaSymbol: 'alpha', line: 30, depth: 2, via: 'handle' });
    expect(blast.factsByFile).toHaveProperty('c.ts');
  });

  it('(a cont.) x.ts calling alpha directly AND handle is listed once at depth 1; a second hop-1 parent to the same hop-2 caller is listed once', async () => {
    const svc = buildService({
      symbols: {
        'a.ts': [{ name: 'alpha', kind: 'function', line: 1, exported: true }],
        'b.ts': [{ name: 'handle', kind: 'function', line: 5, exported: true }],
        'y.ts': [{ name: 'g2', kind: 'function', line: 1, exported: true }],
        'c.ts': [{ name: 'route', kind: 'function', line: 25, exported: false }],
        'x.ts': [{ name: 'g', kind: 'function', line: 1, exported: true }],
      },
      references: [
        // hop 1: b.ts/handle -> alpha, y.ts/g2 -> alpha, x.ts/g -> alpha (direct)
        { fromPath: 'b.ts', toSymbol: 'alpha', line: 10, rank: 50, declFile: 'a.ts' },
        { fromPath: 'y.ts', toSymbol: 'alpha', line: 1, rank: 30, declFile: 'a.ts' },
        { fromPath: 'x.ts', toSymbol: 'alpha', line: 1, rank: 1, declFile: 'a.ts' },
        // hop 2: c.ts reaches BOTH handle (via b.ts) and g2 (via y.ts) -> one caller row, kept once
        { fromPath: 'c.ts', toSymbol: 'handle', line: 30, rank: 40, declFile: 'b.ts' },
        { fromPath: 'c.ts', toSymbol: 'g2', line: 31, rank: 39, declFile: 'y.ts' },
        // hop 2: x.ts also reaches handle -> would duplicate the (alpha, x.ts, g) key already seen at depth 1
        { fromPath: 'x.ts', toSymbol: 'handle', line: 2, rank: 1, declFile: 'b.ts' },
      ],
    });
    const blast = await svc.getBlastRadius('r1', ['a.ts']);
    const xCallers = blast.callers.filter((c) => c.file === 'x.ts');
    expect(xCallers).toHaveLength(1);
    expect(xCallers[0]).toMatchObject({ depth: 1 });
    const cCallers = blast.callers.filter((c) => c.file === 'c.ts');
    expect(cCallers).toHaveLength(1);
    expect(cCallers[0]!.depth).toBe(2);
  });

  it('(b) pair precision: cross-product rows whose (declFile, toSymbol) is not a real frontier pair are dropped', async () => {
    const svc = buildService({
      symbols: {
        'a.ts': [{ name: 'alpha', kind: 'function', line: 1, exported: true }],
        'd.ts': [{ name: 'beta', kind: 'function', line: 1, exported: true }],
        'b.ts': [{ name: 'handle', kind: 'function', line: 5, exported: true }],
        'e.ts': [{ name: 'other', kind: 'function', line: 1, exported: true }],
      },
      references: [
        // hop 1 frontier: (b.ts -> handle) reaches alpha; (e.ts -> other) reaches beta
        { fromPath: 'b.ts', toSymbol: 'alpha', line: 10, rank: 50, declFile: 'a.ts' },
        { fromPath: 'e.ts', toSymbol: 'beta', line: 3, rank: 20, declFile: 'd.ts' },
        // cross-product traps: declFile in frontierFiles, toSymbol in frontierNames, but NOT a real pair
        { fromPath: 'x.ts', toSymbol: 'other', line: 1, rank: 10, declFile: 'b.ts' },
        { fromPath: 'y.ts', toSymbol: 'handle', line: 1, rank: 10, declFile: 'e.ts' },
      ],
    });
    const blast = await svc.getBlastRadius('r1', ['a.ts', 'd.ts']);
    expect(blast.callers.find((c) => c.file === 'x.ts')).toBeUndefined();
    expect(blast.callers.find((c) => c.file === 'y.ts')).toBeUndefined();
  });

  it('(d) a hop-2 caller in the declaring file of the changed symbol is dropped', async () => {
    const svc = buildService({
      symbols: {
        'a.ts': [
          { name: 'alpha', kind: 'function', line: 1, exported: true },
          { name: 'helper', kind: 'function', line: 20, exported: true },
        ],
        'b.ts': [{ name: 'handle', kind: 'function', line: 5, exported: true }],
      },
      references: [
        { fromPath: 'b.ts', toSymbol: 'alpha', line: 10, rank: 50, declFile: 'a.ts' },
        // a.ts itself, at another function, reaches handle -> would be a depth-2
        // caller of alpha but its file (a.ts) declares alpha -> dropped.
        { fromPath: 'a.ts', toSymbol: 'handle', line: 21, rank: 5, declFile: 'b.ts' },
      ],
    });
    const blast = await svc.getBlastRadius('r1', ['a.ts']);
    expect(blast.callers.find((c) => c.file === 'a.ts')).toBeUndefined();
  });

  it('(e) the per-symbol cap is global across hops (direct first, then rank), and per changed symbol', async () => {
    // The frontier for depth 2 is `d0.ts`'s own enclosing symbol (`d0`), so it
    // reuses one of the 18 direct callers rather than adding a 19th.
    const directAlpha: FakeReference[] = Array.from({ length: 18 }, (_, i) => ({
      fromPath: `d${i}.ts`,
      toSymbol: 'alpha',
      line: 1,
      rank: 50 - i,
      declFile: 'a.ts',
    }));
    const symbols: Record<string, FakeSymbol[]> = {
      'a.ts': [{ name: 'alpha', kind: 'function', line: 1, exported: true }],
    };
    for (let i = 0; i < 18; i += 1) symbols[`d${i}.ts`] = [{ name: `d${i}`, kind: 'function', line: 1, exported: true }];
    for (let i = 0; i < 5; i += 1) symbols[`h${i}.ts`] = [{ name: `h${i}`, kind: 'function', line: 1, exported: true }];
    const hop2Callers: FakeReference[] = Array.from({ length: 5 }, (_, i) => ({
      fromPath: `h${i}.ts`,
      toSymbol: 'd0',
      line: 1,
      rank: 99 - i,
      declFile: 'd0.ts',
    }));
    const svc = buildService({
      symbols,
      references: [...directAlpha, ...hop2Callers],
    });
    const blast = await svc.getBlastRadius('r1', ['a.ts']);
    const alphaCallers = blast.callers.filter((c) => c.viaSymbol === 'alpha');
    expect(alphaCallers).toHaveLength(20);
    expect(alphaCallers.filter((c) => c.depth === 1)).toHaveLength(18);
    expect(alphaCallers.filter((c) => c.depth === 2)).toHaveLength(2);
    // The two depth-2 survivors are the highest-ranked (99, 98).
    expect(alphaCallers.filter((c) => c.depth === 2).map((c) => c.rank).sort((x, y) => y - x)).toEqual([99, 98]);
  });

  it('(e cont.) the cap is per changed symbol, not global: 25 alpha + 3 beta -> 20 alpha + 3 beta', async () => {
    const symbols: Record<string, FakeSymbol[]> = {
      'a.ts': [{ name: 'alpha', kind: 'function', line: 1, exported: true }],
      'd.ts': [{ name: 'beta', kind: 'function', line: 1, exported: true }],
    };
    const references: FakeReference[] = [];
    for (let i = 0; i < 25; i += 1) {
      symbols[`da${i}.ts`] = [{ name: `da${i}`, kind: 'function', line: 1, exported: true }];
      references.push({ fromPath: `da${i}.ts`, toSymbol: 'alpha', line: 1, rank: 100 - i, declFile: 'a.ts' });
    }
    for (let i = 0; i < 3; i += 1) {
      symbols[`db${i}.ts`] = [{ name: `db${i}`, kind: 'function', line: 1, exported: true }];
      references.push({ fromPath: `db${i}.ts`, toSymbol: 'beta', line: 1, rank: 3 - i, declFile: 'd.ts' });
    }
    const svc = buildService({ symbols, references });
    const blast = await svc.getBlastRadius('r1', ['a.ts', 'd.ts']);
    expect(blast.callers.filter((c) => c.viaSymbol === 'alpha')).toHaveLength(20);
    expect(blast.callers.filter((c) => c.viaSymbol === 'beta')).toHaveLength(3);
  });

  it('(g) hop-1 is capped per symbol by rank BEFORE seeding the hop-2 frontier', async () => {
    // 25 hop-1 callers of `alpha`; only the top 20 by rank may seed the
    // hop-2 frontier (and be carried forward as hop-1 callers themselves).
    const symbols: Record<string, FakeSymbol[]> = {
      'a.ts': [{ name: 'alpha', kind: 'function', line: 1, exported: true }],
    };
    const references: FakeReference[] = [];
    for (let i = 0; i < 25; i += 1) {
      symbols[`da${i}.ts`] = [{ name: `da${i}`, kind: 'function', line: 1, exported: true }];
      references.push({ fromPath: `da${i}.ts`, toSymbol: 'alpha', line: 1, rank: 100 - i, declFile: 'a.ts' });
    }
    const calls: Array<{ declFiles: string[]; names: string[] }> = [];
    const svc = buildService({
      symbols,
      references,
      onResolvedCallers: (declFiles, names) => calls.push({ declFiles: [...declFiles], names: [...names] }),
    });
    const blast = await svc.getBlastRadius('r1', ['a.ts']);

    expect(calls).toHaveLength(2); // hop 1, then hop 2
    const hop2Files = calls[1]!.declFiles;
    expect(hop2Files).toHaveLength(20);
    // The bottom 5 by rank (da20..da24) never reach the hop-2 query.
    for (let i = 20; i < 25; i += 1) expect(hop2Files).not.toContain(`da${i}.ts`);
    // The top 20 (da0..da19) all seed it.
    for (let i = 0; i < 20; i += 1) expect(hop2Files).toContain(`da${i}.ts`);

    const alphaCallers = blast.callers.filter((c) => c.viaSymbol === 'alpha');
    expect(alphaCallers.length).toBeLessThanOrEqual(20);
  });

  it('(f) degraded is false on the persistent path', async () => {
    const svc = buildService({
      symbols: { 'a.ts': [{ name: 'alpha', kind: 'function', line: 1, exported: true }] },
      references: [],
    });
    const blast = await svc.getBlastRadius('r1', ['a.ts']);
    expect(blast.degraded).toBe(false);
    expect(blast.callers).toEqual([]);
  });
});
