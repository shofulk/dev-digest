/* Pure helpers for the Versions tab — the line diff shown by DiffDialog. No DOM, no React. */

export type DiffKind = "same" | "add" | "del";

export interface DiffLine {
  kind: DiffKind;
  text: string;
  /** 1-based line number in the OLD text; absent on an added line. */
  oldNo?: number;
  /** 1-based line number in the NEW text; absent on a deleted line. */
  newNo?: number;
}

/**
 * Cap on the cells of the LCS table (after the common prefix/suffix is trimmed). A
 * `Uint32Array` of this size is 16 MB; a middle section larger than that degrades to a plain
 * "delete all, add all" instead of exhausting memory on a pathological body.
 */
export const MAX_LCS_CELLS = 4_000_000;

/** Split text into lines: `""` has none, and a trailing newline does not add an empty line. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Longest-common-subsequence table over suffixes: `t[i][j]` = LCS of `a[i..]` and `b[j..]`. */
function lcsTable(a: string[], b: string[]): Uint32Array {
  const w = b.length + 1;
  const t = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      t[i * w + j] =
        a[i] === b[j] ? t[(i + 1) * w + j + 1]! + 1 : Math.max(t[(i + 1) * w + j]!, t[i * w + j + 1]!);
    }
  }
  return t;
}

/**
 * Line-level diff of `oldText` → `newText`: lines only in the old text are `del`, lines only
 * in the new text are `add`, the rest `same`. A small LCS diff — no dependency. Within a
 * changed block, deletions come before additions.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  // Trim the common prefix and suffix: bodies usually differ in a few places, so the LCS
  // table only has to cover the middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const out: DiffLine[] = [];
  for (let k = 0; k < start; k++) out.push({ kind: "same", text: a[k]!, oldNo: k + 1, newNo: k + 1 });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  let oldNo = start + 1;
  let newNo = start + 1;
  const del = (text: string) => out.push({ kind: "del", text, oldNo: oldNo++ });
  const add = (text: string) => out.push({ kind: "add", text, newNo: newNo++ });

  if (midA.length * midB.length > MAX_LCS_CELLS) {
    midA.forEach(del);
    midB.forEach(add);
  } else {
    const w = midB.length + 1;
    const t = lcsTable(midA, midB);
    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
      if (midA[i] === midB[j]) {
        out.push({ kind: "same", text: midA[i]!, oldNo: oldNo++, newNo: newNo++ });
        i++;
        j++;
      } else if (t[(i + 1) * w + j]! >= t[i * w + j + 1]!) {
        del(midA[i++]!);
      } else {
        add(midB[j++]!);
      }
    }
    while (i < midA.length) del(midA[i++]!);
    while (j < midB.length) add(midB[j++]!);
  }

  for (let k = endA; k < a.length; k++) {
    out.push({ kind: "same", text: a[k]!, oldNo: oldNo++, newNo: newNo++ });
  }
  return out;
}

/** How many lines were added and removed. */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === "add") added++;
    else if (l.kind === "del") removed++;
  }
  return { added, removed };
}

/** The viewer's IANA time zone — passed to the date formatter so server and client agree on it. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
