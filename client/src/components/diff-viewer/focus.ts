/* focus.ts — resolves the Files changed tab's `?file=&line=` target (D4,
   AC-58) into the shape `DiffViewer`/`FileGroup`/`FileCard` force-open and
   scroll to. Pure logic, no `use` prefix (frontend-ui-architecture
   "logic placement") — the URL is the only state kept, so this is a plain
   function of `files` + the two query params, called on every render. */
import type { PrFile } from "@/lib/types";
import { parsePatch } from "./helpers";

export type DiffFocus =
  | { kind: "none" }
  | { kind: "missing"; path: string }
  | { kind: "target"; path: string; line: number | null };

/**
 * `file` must name one of `files` (else `missing`, so the tab can show
 * `smartDiff.focusFileMissing`). `line`, when present, is parsed as an
 * integer; a non-numeric value, or one that is not a shown new-side
 * add/ctx line of that file's patch, is treated as absent (`line: null`,
 * AC-60) — the file still resolves as the target (D4, D7 "Focus items").
 */
export function resolveDiffFocus(
  files: PrFile[],
  file?: string | null,
  line?: string | null,
): DiffFocus {
  if (!file) return { kind: "none" };

  const match = files.find((f) => f.path === file);
  if (!match) return { kind: "missing", path: file };

  const parsed = line == null ? NaN : parseInt(line, 10);
  if (!Number.isInteger(parsed)) return { kind: "target", path: file, line: null };

  const shown = parsePatch(match.patch).some(
    (ln) => (ln.kind === "add" || ln.kind === "ctx") && ln.newNo === parsed,
  );
  return { kind: "target", path: file, line: shown ? parsed : null };
}
