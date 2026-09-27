"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Skeleton, ErrorState } from "@devdigest/ui";
import { DiffViewer, orderBySmartDiff, type DiffCommentApi, type DiffFindingApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment, usePrReviews, useFindingAction } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/smart-diff";
import { notify } from "@/lib/toast";
import { FindingCard } from "../FindingCard";
import type { PrFile } from "@devdigest/shared";

type Order = "smart" | "original";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  additions: number;
  deletions: number;
  repoFullName: string | null;
  headSha: string | null;
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
}

/**
 * D5 — Smart/Original order toggle, local state, Smart by default. D2 — the
 * server owns roles/order (`useSmartDiff`); this tab overlays live finding
 * dots/counters/cards from `usePrReviews` on top of either order (AC3/AC4).
 */
export function DiffTab({
  prId,
  filesCount,
  files,
  additions,
  deletions,
  repoFullName,
  headSha,
  canComment,
}: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  const { data: reviews } = usePrReviews(prId);
  const action = useFindingAction();
  const {
    data: smartDiff,
    isLoading: smartDiffLoading,
    isError: smartDiffError,
    refetch: refetchSmartDiff,
  } = useSmartDiff(prId);

  const [order, setOrder] = React.useState<Order>("smart");
  // One toggle for GitHub comments AND agent finding cards, so the diff can be
  // made clean in one click. Starts visible: a finished review's findings are
  // the point of this tab. Line severity bars, file dots and group counters
  // stay visible either way.
  const [showComments, setShowComments] = React.useState(true);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : t("smartDiff.commentFailed"));
        throw err;
      }
    },
  };

  // D2 — the same `allFindings` set the page's severity counters use, so the
  // dots/counters here always agree with the header (no extra round-trip).
  const allFindings = React.useMemo(() => (reviews ?? []).flatMap((r) => r.findings), [reviews]);

  const toggleableCount = commentCount + allFindings.length;

  const findingApi: DiffFindingApi = {
    findings: allFindings,
    visible: showComments,
    renderFinding: (f) => (
      <FindingCard
        key={f.id}
        f={f}
        defaultExpanded
        pending={action.isPending}
        onAction={(a) => {
          if (prId) action.mutate({ findingId: f.id, action: a, prId });
        }}
        repoFullName={repoFullName}
        headSha={headSha}
      />
    ),
  };

  const groups = order === "smart" ? orderBySmartDiff(files, smartDiff ?? null) : null;
  const smartLoading = order === "smart" && smartDiffLoading;
  const smartFailed = order === "smart" && smartDiffError;

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div role="group" aria-label={t("smartDiff.orderLabel")} style={{ display: "flex", gap: 4 }}>
              <Button
                kind="ghost"
                size="sm"
                active={order === "smart"}
                aria-pressed={order === "smart"}
                onClick={() => setOrder("smart")}
              >
                {t("smartDiff.smartOrder")}
              </Button>
              <Button
                kind="ghost"
                size="sm"
                active={order === "original"}
                aria-pressed={order === "original"}
                onClick={() => setOrder("original")}
              >
                {t("smartDiff.originalOrder")}
              </Button>
            </div>
            {toggleableCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? t("smartDiff.hideComments") : t("smartDiff.showComments")} ({toggleableCount})
              </Button>
            )}
          </div>
        }
      >
        {t("smartDiff.title")} · {t("smartDiff.summary", { files: filesCount, additions, deletions })}
      </SectionLabel>

      {smartLoading ? (
        <Skeleton height={200} />
      ) : smartFailed ? (
        <ErrorState title={t("smartDiff.loadFailed")} onRetry={() => refetchSmartDiff()} />
      ) : (
        <DiffViewer files={files} commenting={commenting} groups={groups} findings={findingApi} />
      )}
    </section>
  );
}
