/* context-docs/helpers.ts — D11 pure helpers shared by the agent and skill Context tabs
   (client/.spec/project-context.spec.md). No hooks, no React — plain functions so they
   are testable with no renderer (frontend-ui-architecture: logic that needs no React goes
   in a plain module). Exercised by client/src/components/context-docs/helpers.test.ts. */
import type { ContextDocType, SpecFile } from "@devdigest/shared";

/** One row of the attach picker: a document plus its attachment state. */
export interface AttachRow {
  path: string;
  name: string;
  folder: string;
  type: ContextDocType | null;
  tokens: number | null;
  attached: boolean;
  /** Attached but no longer found by the scan. */
  missing: boolean;
}

/** One folder's worth of rows, for the grouped picker list. */
export interface AttachRowGroup {
  folder: string;
  rows: AttachRow[];
}

/** The last path segment. */
export function docName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/** Every path segment but the last, joined back with "/" ("" for a root-level file). */
export function docFolder(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/** Group rows by `docFolder`, folders in first-seen order. */
export function groupByFolder(rows: AttachRow[]): AttachRowGroup[] {
  const groups: AttachRowGroup[] = [];
  const byFolder = new Map<string, AttachRowGroup>();
  for (const row of rows) {
    let group = byFolder.get(row.folder);
    if (!group) {
      group = { folder: row.folder, rows: [] };
      byFolder.set(row.folder, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

/**
 * Build the picker rows from the scanned files and the saved attachment order:
 * attached rows first, in saved order (a saved path missing from `files` is still
 * listed, flagged `missing: true` with `tokens: null`); then the remaining files,
 * unattached, ordered by path.
 */
export function buildAttachRows(files: SpecFile[], attached: string[]): AttachRow[] {
  const byPath = new Map(files.map((f) => [f.path, f] as const));
  const rows: AttachRow[] = [];
  const seen = new Set<string>();

  const toRow = (path: string, attached: boolean): AttachRow => {
    const file = byPath.get(path);
    const missing = !file;
    return {
      path,
      name: docName(path),
      folder: docFolder(path),
      type: file?.type ?? null,
      tokens: missing ? null : file?.tokens ?? null,
      attached,
      missing,
    };
  };

  for (const path of attached) {
    if (seen.has(path)) continue;
    seen.add(path);
    rows.push(toRow(path, true));
  }

  const remaining = files
    .filter((f) => !seen.has(f.path))
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const file of remaining) {
    rows.push(toRow(file.path, false));
  }

  return rows;
}

/** Keep only rows whose path contains `query`, case-insensitive; attachment state of
 *  hidden rows is simply not in the returned array — callers must not derive it from
 *  this result (AC-13). */
export function filterRows(rows: AttachRow[], query: string): AttachRow[] {
  if (!query) return rows;
  const needle = query.toLowerCase();
  return rows.filter((r) => r.path.toLowerCase().includes(needle));
}

/** Sum of `tokens` over the attached rows (nulls contribute 0). */
export function attachedTokens(rows: AttachRow[]): number {
  return rows.filter((r) => r.attached).reduce((sum, r) => sum + (r.tokens ?? 0), 0);
}

/** Toggle `path`'s membership in the saved order: drop it if present, else append it. */
export function toggleDoc(attached: string[], path: string): string[] {
  return attached.includes(path) ? attached.filter((p) => p !== path) : [...attached, path];
}

/** Move `path` one slot within the saved order (`dir` -1 = up, 1 = down); a no-op at
 *  either end. */
export function moveDoc(attached: string[], path: string, dir: -1 | 1): string[] {
  const idx = attached.indexOf(path);
  if (idx === -1) return attached;
  const target = idx + dir;
  if (target < 0 || target >= attached.length) return attached;
  const next = attached.slice();
  const a = next[idx] as string;
  const b = next[target] as string;
  next[idx] = b;
  next[target] = a;
  return next;
}

/** The "Serializes as" preview: the `## Project context` heading plus one `- <path>`
 *  line per attached path, in order. */
export function serializeAs(attached: string[]): string {
  return ["## Project context", ...attached.map((p) => `- ${p}`)].join("\n");
}

/** Reorder the saved attached list so `dragPath` lands at `overPath`'s position. Returns
 *  the SAME array reference (not a copy) when either path is not in the saved order (e.g.
 *  a drop onto an unattached row) or the two paths already occupy the same slot — callers
 *  rely on that reference equality to skip a redundant `onChange`/save (F14). */
export function reorderAttached(attached: string[], dragPath: string, overPath: string): string[] {
  const from = attached.indexOf(dragPath);
  const to = attached.indexOf(overPath);
  if (from === -1 || to === -1 || from === to) return attached;
  const next = attached.slice();
  next.splice(from, 1);
  next.splice(to, 0, dragPath);
  return next;
}
