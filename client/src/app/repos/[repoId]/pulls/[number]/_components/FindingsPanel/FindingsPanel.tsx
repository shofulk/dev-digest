/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { FindingCard, evalSourceFor } from "../FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { useEvalCaseDraft } from "../../../../../../../lib/hooks/eval";
import { ApiError } from "../../../../../../../lib/api";
import { caseErrorKey } from "../../../../../../../lib/eval-metrics";
import { notify } from "../../../../../../../lib/toast";
import { EvalCaseModal, type EvalCaseModalSource } from "../../../../../../../components/eval-ui/EvalCaseModal";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

type EvalModalState = { agentId: string; source: EvalCaseModalSource; opener: HTMLElement };

export function FindingsPanel({
  findings,
  severity = null,
  prId,
  repoFullName,
  headSha,
}: {
  findings: FindingRecord[];
  /** Severity selected in the PR header, or null for all findings. */
  severity?: Severity | null;
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const evalDraft = useEvalCaseDraft();
  const [evalModal, setEvalModal] = React.useState<EvalModalState | null>(null);
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);

  const shown = React.useMemo(
    () => visibleFindings(findings, { hideLow, severity }),
    [findings, hideLow, severity],
  );

  // The j/k cursor is an index into `shown`, so a narrower list would leave it past the end
  // and make a/d silently no-op on an undefined finding.
  React.useEffect(() => {
    setFocusIdx(0);
  }, [severity, hideLow]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (evalModal !== null) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target?.isContentEditable || target?.closest?.("[role=dialog]")) return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId, evalModal]);

  return (
    <div>
      <div style={s.toolbar}>
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
              evalPending={evalDraft.isPending}
              onEvalCase={(opener) =>
                evalDraft.mutate(f.id, {
                  onSuccess: (r) => {
                    const source = evalSourceFor(f.id, r);
                    if (source) setEvalModal({ agentId: r.agent_id, source, opener });
                    else notify.error(t(caseErrorKey(undefined)));
                  },
                  onError: (e) => notify.error(t(caseErrorKey(e instanceof ApiError ? e.code : undefined))),
                })
              }
            />
          ))
        )}
      </div>
      {evalModal && (
        <EvalCaseModal
          agentId={evalModal.agentId}
          source={evalModal.source}
          returnFocusTo={evalModal.opener}
          onClose={() => setEvalModal(null)}
        />
      )}
    </div>
  );
}
