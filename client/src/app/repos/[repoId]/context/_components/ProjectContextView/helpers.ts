/* ProjectContextView/helpers.ts — pure helpers for the read-only Project Context page
   (client/.spec/project-context.spec.md, S23). `docName`/`docFolder` are the same path
   rules the attach picker uses (client/src/components/context-docs/helpers.ts); grouping
   here operates on the server's `SpecFile` rows directly, with no attachment state. */
import type { SpecFile } from "@devdigest/shared";
import { docFolder, docName } from "@/components/context-docs/helpers";

export interface DocRow {
  path: string;
  name: string;
  folder: string;
  type: SpecFile["type"];
  tokens: number | null;
  usedBy: number;
}

export interface DocRowGroup {
  folder: string;
  rows: DocRow[];
}

function toRow(file: SpecFile): DocRow {
  return {
    path: file.path,
    name: docName(file.path),
    folder: docFolder(file.path),
    type: file.type ?? null,
    tokens: file.tokens ?? null,
    usedBy: file.used_by ?? 0,
  };
}

/** Group the scanned files by folder, in first-seen order — the server already returns
 *  `files` sorted by path, so this preserves that order within and across folders. */
export function groupDocsByFolder(files: SpecFile[]): DocRowGroup[] {
  const groups: DocRowGroup[] = [];
  const byFolder = new Map<string, DocRowGroup>();
  for (const file of files) {
    const row = toRow(file);
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

/** The path the preview opens by default (AC-4): the first file in scan order. */
export function firstDocPath(files: SpecFile[]): string | null {
  return files[0]?.path ?? null;
}
