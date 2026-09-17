/**
 * USD cost formatting, shared by every surface that shows what a run cost:
 * the PR list column, the run timeline, the review-run header and the trace
 * drawer's COST tile. One module so that "unknown" looks identical everywhere.
 */

/** What every surface shows when a cost is unknown. */
export const NO_COST = "—";

/**
 * Format a run cost in USD.
 *
 * Review runs are routinely sub-cent, so a fixed 2-decimal format would collapse
 * most of them to "$0.00". Scale the precision instead: cheap runs keep four
 * decimals ($0.0013), larger ones stay tidy ($0.014, $1.25).
 *
 * null/undefined means the model is not in the price book — render the em dash
 * rather than a zero, which would understate real spend.
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return NO_COST;
  if (usd === 0) return "$0";
  // A dollar or more is money and keeps the usual two decimals ($1.20).
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  // Below that, widen the precision so sub-cent runs survive, then drop the
  // trailing zeros it introduces: 0.06 → "$0.06", not "$0.060".
  const decimals = usd < 0.01 ? 4 : 3;
  const trimmed = usd.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
  return `$${trimmed}`;
}

/** Token count with thin-space grouping, e.g. "9 119 tok". */
export function formatTokenCount(tokens: number | null | undefined): string | null {
  if (tokens == null) return null;
  return `${tokens.toLocaleString("en-US").replace(/,/g, " ")} tok`;
}
