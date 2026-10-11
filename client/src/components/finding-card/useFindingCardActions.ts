/* useFindingCardActions — wires a FindingCard's accept/dismiss, eval-case and Learn
   buttons to their mutations, with the shared success/error toasts. Used by the PR
   Findings tab, the Diff tab and the multi-agent results Tabs view. */
"use client";

import { useTranslations } from "next-intl";
import type { FindingActionKind, FindingRecord } from "@devdigest/shared";
import { useFindingAction } from "@/lib/hooks/reviews";
import { useCreateEvalCase } from "@/lib/hooks/eval";
import { useLearnFinding } from "@/lib/hooks/multi-agent";
import { ApiError } from "@/lib/api";
import { caseErrorKey } from "@/lib/eval-metrics";
import { notify } from "@/lib/toast";

export function useFindingCardActions(prId: string | null | undefined) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const evalCase = useCreateEvalCase();
  const learn = useLearnFinding();

  /** Accept / dismiss one finding (also the j/k-panel a/d shortcuts). */
  const act = (findingId: string, kind: FindingActionKind) => {
    if (prId) action.mutate({ findingId, action: kind, prId });
  };

  /** The action props of one `FindingCard`. */
  const cardProps = (f: FindingRecord) => ({
    pending: action.isPending,
    onAction: (kind: FindingActionKind) => act(f.id, kind),
    evalPending: evalCase.isPending,
    onEvalCase: () =>
      evalCase.mutate(f.id, {
        onSuccess: (r) => notify.success(r.created ? t("finding.evalCaseCreated") : t("finding.evalCaseExists")),
        onError: (e) => notify.error(t(caseErrorKey(e instanceof ApiError ? e.code : undefined))),
      }),
    learnPending: learn.isPending,
    onLearn: () => learn.mutate({ findingId: f.id, prId: prId ?? undefined }),
  });

  return { act, cardProps, actionPending: action.isPending };
}
