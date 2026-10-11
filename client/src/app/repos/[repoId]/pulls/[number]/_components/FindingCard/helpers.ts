import type { FindingRecord } from "@devdigest/shared";
import type { EvalExpectationType } from "@devdigest/shared/contracts/eval-ci";

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
