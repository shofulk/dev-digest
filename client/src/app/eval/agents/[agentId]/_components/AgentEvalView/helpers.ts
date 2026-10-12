import type { EvalSuiteRun } from "@devdigest/shared/contracts/eval-ci";
import { latestTwoCompleted } from "@/lib/eval-metrics";

export type MetricKey = "recall" | "precision" | "citation_accuracy";

/** Tie order: the first metric listed wins. */
const METRICS: readonly MetricKey[] = ["recall", "precision", "citation_accuracy"];

/**
 * The metric that moved most (whole points) between the newest completed run and the one
 * before it, or `null` when nothing moved by at least a point.
 */
export function metricCallout(
  runs: readonly EvalSuiteRun[],
): { metric: MetricKey; direction: "up" | "down"; points: number; version: number } | null {
  const { latest, previous } = latestTwoCompleted(runs);
  if (!latest || !previous) return null;
  let best: { metric: MetricKey; points: number } | null = null;
  for (const metric of METRICS) {
    const now = latest[metric];
    const before = previous[metric];
    if (now == null || before == null) continue;
    const points = Math.round((now - before) * 100);
    if (Math.abs(points) >= 1 && (!best || Math.abs(points) > Math.abs(best.points))) best = { metric, points };
  }
  if (!best) return null;
  return {
    metric: best.metric,
    direction: best.points > 0 ? "up" : "down",
    points: Math.abs(best.points),
    version: latest.agent_version,
  };
}

/**
 * Completed runs as chart points, oldest first. A run with any metric `null` is dropped: the
 * vendor LineChart plots a missing value as 0.
 */
export function trendPoints(
  runs: readonly EvalSuiteRun[],
): { run_id: string; started_at: string; recall: number; precision: number; citation_accuracy: number }[] {
  const points: { run_id: string; started_at: string; recall: number; precision: number; citation_accuracy: number }[] = [];
  const done = runs
    .filter((r) => r.status === "completed")
    .sort((x, y) => Date.parse(x.started_at) - Date.parse(y.started_at));
  for (const r of done) {
    if (r.recall == null || r.precision == null || r.citation_accuracy == null) continue;
    points.push({
      run_id: r.run_id,
      started_at: r.started_at,
      recall: r.recall,
      precision: r.precision,
      citation_accuracy: r.citation_accuracy,
    });
  }
  return points;
}
