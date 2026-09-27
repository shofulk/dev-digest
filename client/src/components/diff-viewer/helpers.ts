/** Pure helpers for the DiffViewer. */
import type { PrFile, SmartDiff, SmartDiffRole } from "@devdigest/shared";
import { HUNK_HEADER_RE } from "./constants";

export interface Line {
  kind: "add" | "del" | "ctx" | "hunk";
  text: string;
  oldNo?: number;
  newNo?: number;
}

/** Parse unified-diff patch text into renderable lines with old/new line numbers. */
export function parsePatch(patch: string | null | undefined): Line[] {
  if (!patch) return [];
  const out: Line[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = raw.match(HUNK_HEADER_RE);
      if (m) {
        oldNo = parseInt(m[1]!, 10);
        newNo = parseInt(m[2]!, 10);
      }
      out.push({ kind: "hunk", text: raw });
    } else if (raw.startsWith("+")) {
      out.push({ kind: "add", text: raw.slice(1), newNo });
      newNo++;
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", text: raw.slice(1), oldNo });
      oldNo++;
    } else {
      out.push({ kind: "ctx", text: raw.slice(raw.startsWith(" ") ? 1 : 0), oldNo, newNo });
      oldNo++;
      newNo++;
    }
  }
  return out;
}

export interface SmartDiffFileGroup {
  role: SmartDiffRole;
  files: PrFile[];
}

/**
 * D3 — groups `files` (`PrDetail.files`, GitHub order) by the server's
 * `SmartDiff` response, keeping `PrDetail.files` order *inside* each group
 * (AC1: "Within a group, files keep their `PrDetail.files` (GitHub) order"),
 * not the response's own per-group file order. A `PrFile` missing from the
 * response (R1: the `pr_files` rewrite race) goes into `core` rather than
 * disappearing. Empty roles are already absent from `smartDiff.groups`
 * (server-side, AC7), and a role that only exists because of a missing file
 * is dropped if it would otherwise be empty.
 */
export function orderBySmartDiff(files: PrFile[], smartDiff: SmartDiff | null | undefined): SmartDiffFileGroup[] {
  if (!smartDiff) return [];

  const roleByPath = new Map<string, SmartDiffRole>();
  for (const g of smartDiff.groups) {
    for (const gf of g.files) roleByPath.set(gf.path, g.role);
  }

  // Bucket `files` in `PrDetail.files` (GitHub) order, keeping that order
  // inside each role's bucket.
  const byRole = new Map<SmartDiffRole, PrFile[]>();
  for (const f of files) {
    const role: SmartDiffRole = roleByPath.get(f.path) ?? "core";
    const bucket = byRole.get(role);
    if (bucket) bucket.push(f);
    else byRole.set(role, [f]);
  }

  // Display order follows the response's group order; a "core" bucket that
  // exists only from missing files (R1) is displayed first.
  const roleOrder: SmartDiffRole[] = smartDiff.groups.map((g) => g.role);
  if (byRole.has("core") && !roleOrder.includes("core")) roleOrder.unshift("core");

  const groups: SmartDiffFileGroup[] = [];
  for (const role of roleOrder) {
    const bucket = byRole.get(role);
    if (bucket && bucket.length > 0) groups.push({ role, files: bucket });
  }
  return groups;
}
