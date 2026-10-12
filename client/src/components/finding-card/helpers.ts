import type { FindingRecord } from "@devdigest/shared";
import type { EvalCaseDraftResponse, EvalExpectationType } from "@devdigest/shared/contracts/eval-ci";
import type { EvalCaseModalSource } from "@/components/eval-ui/EvalCaseModal";

/** Format a finding's line range ("11" when single-line, else "11-15"). */
export function lineLabel(f: Pick<FindingRecord, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

/** The eval case type a finding would freeze into: accepted -> must_find, dismissed ->
 *  must_not_flag, untriaged -> null (the server rejects it, the button stays disabled). */
export function evalCaseTypeOf(
  f: Pick<FindingRecord, "accepted_at" | "dismissed_at">,
): EvalExpectationType | null {
  if (f.accepted_at) return "must_find";
  if (f.dismissed_at) return "must_not_flag";
  return null;
}

/** What the eval-case modal opens on after the draft route answers: the saved case (edit,
 *  flagged "already in the set") or the pre-filled draft; null when the answer carries neither. */
export function evalSourceFor(findingId: string, r: EvalCaseDraftResponse): EvalCaseModalSource | null {
  if (r.existing_case) return { kind: "edit", evalCase: r.existing_case, alreadyInSet: true };
  if (r.draft) return { kind: "finding", findingId, draft: r.draft };
  return null;
}
