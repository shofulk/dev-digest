// RING 1 — pure application helpers. Imports only `@devdigest/shared` types
// (type-only) and `./constants.js`; no persistence layer, no HTTP, no index
// facade — the index read result arrives already shaped as `BlastFacadeResult`.
import type { BlastCaller, BlastDegradedReason, ChangedSymbol, DownstreamImpact } from '@devdigest/shared';
import { NO_SYMBOLS_SUMMARY } from './constants.js';

/**
 * Structural mirror of the index facade's blast result (declared locally so
 * this file names no other module's internals). A caller row carries how many
 * hops it sits from the changed symbol (`depth`) and, for a depth-2 row, the
 * hop-1 caller's symbol name (`via`).
 */
export interface BlastFacadeChangedSymbol {
  file: string;
  name: string;
  kind: string;
}

export interface BlastFacadeCaller {
  file: string;
  symbol: string;
  viaSymbol: string;
  line: number;
  rank: number;
  depth: number;
  via: string | null;
}

export interface BlastFacadeResult {
  changedSymbols: BlastFacadeChangedSymbol[];
  callers: BlastFacadeCaller[];
  impactedEndpoints: string[];
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  degraded?: boolean;
  reason?: string;
}

export interface MappedBlast {
  changed_symbols: ChangedSymbol[];
  downstream: DownstreamImpact[];
}

/**
 * Group the facade's flat caller list by the changed symbol it reaches
 * (`viaSymbol`), in first-appearance order. The facade already orders
 * `callers` depth ascending then rank descending, so grouping preserves that
 * order within and across groups.
 *
 * A duplicate `file|name|line` row is dropped (the shallower copy wins,
 * because of the facade's own ordering); a caller whose file is a declaring
 * file of the symbol it reaches is dropped at any depth.
 */
export function mapFacadeBlast(fb: BlastFacadeResult): MappedBlast {
  const changed_symbols: ChangedSymbol[] = fb.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));

  const declaringFilesByName = new Map<string, Set<string>>();
  for (const s of fb.changedSymbols) {
    let files = declaringFilesByName.get(s.name);
    if (!files) {
      files = new Set();
      declaringFilesByName.set(s.name, files);
    }
    files.add(s.file);
  }

  const order: string[] = [];
  const callersByViaSymbol = new Map<string, BlastCaller[]>();
  const dedupe = new Set<string>();

  for (const c of fb.callers) {
    if (declaringFilesByName.get(c.viaSymbol)?.has(c.file)) continue;
    const key = `${c.viaSymbol}|${c.file}|${c.symbol}|${c.line}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);

    let group = callersByViaSymbol.get(c.viaSymbol);
    if (!group) {
      group = [];
      callersByViaSymbol.set(c.viaSymbol, group);
      order.push(c.viaSymbol);
    }
    group.push({
      name: c.symbol,
      file: c.file,
      line: c.line,
      depth: c.depth === 2 ? 2 : 1,
      via: c.via,
    });
  }

  const downstream: DownstreamImpact[] = order.map((viaSymbol) => {
    const callers = callersByViaSymbol.get(viaSymbol) ?? [];
    const files = new Set(callers.map((c) => c.file));
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const file of files) {
      const facts = fb.factsByFile?.[file];
      if (!facts) continue;
      for (const e of facts.endpoints) endpoints.add(e);
      for (const cr of facts.crons) crons.add(cr);
    }
    return {
      symbol: viaSymbol,
      callers,
      endpoints_affected: [...endpoints],
      crons_affected: [...crons],
    };
  });

  return { changed_symbols, downstream };
}

/** Human-readable summary line (English data — MCP/LLM consumers, D8). */
export function summarizeBlast(changed: ChangedSymbol[], downstream: DownstreamImpact[]): string {
  if (changed.length === 0) return NO_SYMBOLS_SUMMARY;
  const totalCallers = downstream.reduce((n, d) => n + d.callers.length, 0);
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  for (const d of downstream) {
    for (const e of d.endpoints_affected) endpoints.add(e);
    for (const c of d.crons_affected) crons.add(c);
  }
  const symbolWord = changed.length === 1 ? 'symbol' : 'symbols';
  const callerWord = totalCallers === 1 ? 'caller' : 'callers';
  return (
    `${changed.length} changed ${symbolWord}, ${totalCallers} ${callerWord}, ` +
    `${endpoints.size} endpoint(s), ${crons.size} cron(s) affected.`
  );
}

export interface DeriveBlastStatusInput {
  enabled: boolean;
  indexStatus: 'full' | 'partial' | 'degraded' | 'failed';
  indexReason?: string | null;
  facadeDegraded?: boolean;
  facadeReason?: string | null;
}

export interface BlastStatus {
  degraded: boolean;
  reason: BlastDegradedReason | null;
}

/** The closed set of reasons the contract's `BlastDegradedReason` enum admits. */
const KNOWN_REASONS = new Set<BlastDegradedReason>([
  'flag_off',
  'index_failed',
  'index_partial',
  'repo_too_large',
  'no_data',
]);

/**
 * Validate an untyped reason string (from the index state or the facade)
 * against the closed reason set; an unknown or missing value falls back to
 * `fallback` rather than being blind-cast.
 */
function asBlastDegradedReason(value: string | null | undefined, fallback: BlastDegradedReason): BlastDegradedReason {
  if (value != null && KNOWN_REASONS.has(value as BlastDegradedReason)) return value as BlastDegradedReason;
  return fallback;
}

/**
 * D2 — honest `degraded`/`reason`, derived here rather than by changing the
 * index facade's own degraded semantics (which also feed the index-state
 * badge and must not shift for that consumer).
 */
export function deriveBlastStatus(input: DeriveBlastStatusInput): BlastStatus {
  if (!input.enabled) return { degraded: true, reason: 'flag_off' };
  switch (input.indexStatus) {
    case 'failed':
      return { degraded: true, reason: asBlastDegradedReason(input.indexReason, 'index_failed') };
    case 'degraded':
      return { degraded: true, reason: asBlastDegradedReason(input.indexReason, 'no_data') };
    case 'partial':
      return { degraded: true, reason: 'index_partial' };
    case 'full':
      if (input.facadeDegraded) {
        return { degraded: true, reason: asBlastDegradedReason(input.facadeReason, 'no_data') };
      }
      return { degraded: false, reason: null };
    default:
      return { degraded: true, reason: 'no_data' };
  }
}
