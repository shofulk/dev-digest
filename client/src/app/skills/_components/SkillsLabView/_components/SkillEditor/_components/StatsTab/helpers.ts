/* Pure helpers for the Stats tab — the donut's data mapping. No DOM, no React. */
import { MAX_DONUT_SLOTS, OTHER_COLOR } from "./constants";

export interface CategorySlice {
  category: string;
  count: number;
}

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

/**
 * Findings-by-category → donut segments. Empty and non-positive counts are dropped; the rest
 * are ordered by count (name breaks ties) and take the categorical slots in that fixed order.
 * Past `MAX_DONUT_SLOTS` the tail folds into one neutral `otherLabel` segment — a ninth hue is
 * never generated.
 */
export function toDonutSegments(slices: readonly CategorySlice[], otherLabel: string): DonutSegment[] {
  const sorted = slices
    .filter((c) => Number.isFinite(c.count) && c.count > 0)
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  const head = sorted.slice(0, MAX_DONUT_SLOTS).map((c, i) => ({
    label: c.category,
    value: c.count,
    color: `var(--series-${i + 1})`,
  }));
  const rest = sorted.slice(MAX_DONUT_SLOTS).reduce((sum, c) => sum + c.count, 0);
  return rest > 0 ? [...head, { label: otherLabel, value: rest, color: OTHER_COLOR }] : head;
}

/** Sum of the segment values — the number shown in the donut's centre. */
export function totalOf(segments: readonly DonutSegment[]): number {
  return segments.reduce((sum, s) => sum + s.value, 0);
}
