// Ring 3 — edge. The only cap/cut/success-path hint texts in the package (C4). rev 5: also
// owns the `run_agent_on_pr` "still running" hint and the `get_conventions` empty-list hint
// — every `result.hint` string in the package is built here, the same way every `fail()`
// text is built in tools/errors.ts. `src/domain/findings.ts` returns counts only — this
// module names `limit`, `min_severity`, `category` and `get_findings`, and wraps the
// domain's data-only `fitToBudget` for every list-returning tool. `tools/result.ts`'s
// `guard` is the last-resort net if a hint itself pushes the response back over budget.
import { fitToBudget, truncate } from '../domain/findings.js';

/** Default `limit` for `get_findings`, and the fixed count `run_agent_on_pr` uses (C4, O7). */
export const DEFAULT_LIMIT = 20;

/** Reserve so trimming for the hint text does not reopen the budget it just closed. Sized
 * for the longest possible joined cap+cut hint (both well under 150 chars each). */
const HINT_RESERVE = 350;

function joinHints(...hints: (string | undefined)[]): string | undefined {
  const parts = hints.filter((h): h is string => Boolean(h));
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function findingsCapHint(shown: number, total: number, viaGetFindings: boolean): string | undefined {
  if (shown >= total) return undefined;
  return viaGetFindings
    ? `Showing ${shown} of ${total} findings; raise limit (max 50) or set min_severity to narrow.`
    : `Showing ${shown} of ${total} findings; call get_findings with min_severity, limit or response_format=detailed for more.`;
}

function findingsCutHint(cut: number, viaGetFindings: boolean): string {
  return viaGetFindings
    ? `${cut} findings omitted to fit the response size budget; set min_severity or lower limit.`
    : `${cut} findings omitted to fit the response size budget; call get_findings with min_severity, limit or response_format=detailed for more.`;
}

/**
 * Applies the budget to a `{ findings, total, ... }` result. `viaGetFindings` picks between
 * the `get_findings` hint wording (which owns `limit`/`min_severity`) and the
 * `run_agent_on_pr` wording, which points at `get_findings` instead (O7: `run_agent_on_pr`
 * exposes no filter arguments of its own).
 */
export function budgetFindings<T extends { findings: unknown[]; total: number }>(
  value: T,
  maxChars: number,
  viaGetFindings: boolean,
): { value: T; hint?: string } {
  const capHint = findingsCapHint(value.findings.length, value.total, viaGetFindings);
  const { value: fitted, cut } = fitToBudget(value, 'findings', maxChars - HINT_RESERVE);
  const cutHint = cut > 0 ? findingsCutHint(cut, viaGetFindings) : undefined;
  return { value: fitted, hint: joinHints(capHint, cutHint) };
}

/** Applies the budget to `list_agents`'s `{ agents }` result. */
export function budgetAgents<T extends { agents: unknown[] }>(
  value: T,
  maxChars: number,
): { value: T; hint?: string } {
  const { value: fitted, cut } = fitToBudget(value, 'agents', maxChars - HINT_RESERVE);
  return { value: fitted, hint: cut > 0 ? `${cut} agents omitted to fit the response size budget.` : undefined };
}

/** Applies the budget to `get_conventions`'s `{ conventions }` result. */
export function budgetConventions<T extends { conventions: unknown[] }>(
  value: T,
  maxChars: number,
): { value: T; hint?: string } {
  const { value: fitted, cut } = fitToBudget(value, 'conventions', maxChars - HINT_RESERVE);
  return {
    value: fitted,
    hint: cut > 0 ? `${cut} conventions omitted to fit the response size budget; pass category to narrow.` : undefined,
  };
}

/**
 * `run_agent_on_pr`'s "still running" hint (rev 5) — the echoed `repo` and `agent` are
 * clipped to `textMax`, the same way every field `tools/errors.ts` echoes into an error is.
 */
export function runningHint(repo: string, pr: number, agent: string, textMax: number): string {
  return `Still running — call get_findings with repo=${truncate(repo, textMax)}, pr=${pr}, agent=${truncate(agent, textMax)} later.`;
}

/** `get_conventions`'s empty-list hint (rev 5) — `repo` is clipped the same way. */
export function noConventionsHint(repo: string, textMax: number): string {
  return `${truncate(repo, textMax)} has no accepted conventions yet — run a conventions scan from the DevDigest UI.`;
}

function blastCutHint(downstreamCut: number, symbolsCut: number): string | undefined {
  const parts: string[] = [];
  if (downstreamCut > 0) parts.push(`${downstreamCut} downstream symbol(s)`);
  if (symbolsCut > 0) parts.push(`${symbolsCut} changed symbol(s)`);
  if (parts.length === 0) return undefined;
  return `${parts.join(' and ')} omitted to fit the response size budget.`;
}

/**
 * Applies the budget to `get_blast_radius`'s `{ changed_symbols, downstream }` result.
 * `downstream` is trimmed first, from the tail (lowest-ranked symbols last — the route
 * already orders `downstream` by rank). If that alone does not fit, `changed_symbols` is
 * then trimmed too — also from the tail, but a symbol with no matching `downstream` entry
 * (already the least informative kind of row) is dropped before one that still has callers.
 */
export function budgetBlast<T extends { downstream: unknown[]; changed_symbols: unknown[] }>(
  value: T,
  maxChars: number,
): { value: T; hint?: string } {
  const budget = maxChars - HINT_RESERVE;
  const { value: afterDownstream, cut: downstreamCut } = fitToBudget(value, 'downstream', budget);

  const downstreamSymbols = new Set(
    (afterDownstream.downstream as { symbol: string }[]).map((d) => d.symbol),
  );
  const symbols = [...(afterDownstream.changed_symbols as { name: string }[])];
  const withoutDownstream: number[] = [];
  const withDownstream: number[] = [];
  symbols.forEach((s, i) => {
    (downstreamSymbols.has(s.name) ? withDownstream : withoutDownstream).push(i);
  });
  const dropOrder = [...withoutDownstream.reverse(), ...withDownstream.reverse()];

  const dropped = new Set<number>();
  let symbolsCut = 0;
  let current = { ...afterDownstream, changed_symbols: symbols } as T;
  let i = 0;
  while (JSON.stringify(current).length > budget && i < dropOrder.length) {
    dropped.add(dropOrder[i]!);
    i += 1;
    symbolsCut += 1;
    current = {
      ...afterDownstream,
      changed_symbols: symbols.filter((_, idx) => !dropped.has(idx)),
    } as T;
  }

  return { value: current, hint: blastCutHint(downstreamCut, symbolsCut) };
}
