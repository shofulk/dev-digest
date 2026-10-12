/* useFindingCardActions — wires a FindingCard's accept/dismiss, eval-case and Learn
   buttons to their mutations, with the shared success/error toasts. "Eval case" loads
   the draft and opens the eval-case modal; the caller renders `evalModal`. Used by the
   PR Findings tab, the Diff tab and the multi-agent results Tabs view. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingActionKind, FindingRecord } from "@devdigest/shared";
import { useFindingAction } from "@/lib/hooks/reviews";
import { useEvalCaseDraft } from "@/lib/hooks/eval";
import { useLearnFinding } from "@/lib/hooks/multi-agent";
import { ApiError } from "@/lib/api";
import { caseErrorKey } from "@/lib/eval-metrics";
import { notify } from "@/lib/toast";
import { EvalCaseModal, type EvalCaseModalSource } from "@/components/eval-ui/EvalCaseModal";
import { evalSourceFor } from "./helpers";

type EvalModalState = { agentId: string; source: EvalCaseModalSource; opener: HTMLElement };

export function useFindingCardActions(prId: string | null | undefined) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const evalDraft = useEvalCaseDraft();
  const learn = useLearnFinding();
  const [modal, setModal] = React.useState<EvalModalState | null>(null);

  /** Accept / dismiss one finding (also the j/k-panel a/d shortcuts). */
  const act = (findingId: string, kind: FindingActionKind) => {
    if (prId) action.mutate({ findingId, action: kind, prId });
  };

  /** The action props of one `FindingCard`. */
  const cardProps = (f: FindingRecord) => ({
    pending: action.isPending,
    onAction: (kind: FindingActionKind) => act(f.id, kind),
    evalPending: evalDraft.isPending,
    onEvalCase: (opener: HTMLElement) =>
      evalDraft.mutate(f.id, {
        onSuccess: (r) => {
          const source = evalSourceFor(f.id, r);
          if (source) setModal({ agentId: r.agent_id, source, opener });
          else notify.error(t(caseErrorKey(undefined)));
        },
        onError: (e) => notify.error(t(caseErrorKey(e instanceof ApiError ? e.code : undefined))),
      }),
    learnPending: learn.isPending,
    onLearn: () => learn.mutate({ findingId: f.id, prId: prId ?? undefined }),
  });

  /** The open eval-case modal, or null; render it once next to the cards. */
  const evalModal = modal
    ? React.createElement(EvalCaseModal, {
        agentId: modal.agentId,
        source: modal.source,
        returnFocusTo: modal.opener,
        onClose: () => setModal(null),
      })
    : null;

  return { act, cardProps, actionPending: action.isPending, evalModal, evalModalOpen: modal !== null };
}
