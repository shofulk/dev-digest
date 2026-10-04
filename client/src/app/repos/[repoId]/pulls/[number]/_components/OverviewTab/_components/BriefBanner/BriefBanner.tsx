/* BriefBanner — the Overview tab's PR Brief banner (AC-35, AC-37..AC-45,
   AC-63, AC-66, AC-69). Colocated under its only consumer, OverviewTab.
   The job id is the mutation's `job_id`, else the stored brief's `job.id`
   (S14); `useBriefJob`'s own `phase` starts `null` until the first SSE
   event, so the initial phase shown comes from the server's `job.phase`.
   Verdict label from `prReview.verdict.<labelKey>` via VerdictBanner's
   `VERDICT_META` (S14 precedent). Summary/missing-input text are plain text
   nodes — never Markdown/dangerouslySetInnerHTML/MonoLink (AC-69). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Card, Badge, Button, CircularScore } from "@devdigest/ui";
import { usePrBrief, useGenerateBrief, useBriefJob } from "@/lib/hooks/brief";
import { usePrReviews } from "@/lib/hooks/reviews";
import { ApiError } from "@/lib/api";
import { VERDICT_META } from "../../../VerdictBanner/constants";
import { blockerCount, formatCost, formatTokens, latestReview } from "./helpers";
import { s } from "./styles";

export function BriefBanner({ prId }: { prId: string | null }) {
  const t = useTranslations("brief");
  const tReview = useTranslations("prReview");

  const { data, isPending } = usePrBrief(prId);
  const { data: reviews } = usePrReviews(prId);
  const generateBrief = useGenerateBrief(prId);

  const brief = data?.brief ?? null;
  const outdated = !!data?.outdated;

  const jobId = generateBrief.data && "job_id" in generateBrief.data ? generateBrief.data.job_id : data?.job?.id ?? null;
  // `attempt` (F22): the server can return the SAME job id on a Retry/
  // Generate issued while a job is already running (`reused: true`,
  // server/src/modules/brief/service.ts:108-109) — `useBriefJob` needs this
  // counter, not just `jobId`, to know a new subscription attempt happened.
  const job = useBriefJob(prId, jobId, generateBrief.attempt);
  const serverPhase = data?.job?.phase ?? null;
  const phase = job.phase ?? serverPhase;
  const isGenerating = job.running || generateBrief.isPending;

  // F22/F22b: a Retry/Generate that resolves with the SAME job id (server
  // `reused: true`) clears `job.failed` via the hook's render-time reset
  // (brief.ts), so the Retry action can't stay conditioned on `job.failed`
  // alone — it would vanish the instant the retry is clicked, before the new
  // subscription has a chance to report anything. `canRetry` stays true from
  // the first failure through any in-flight retry attempt (`isGenerating`
  // covers both the mutation's own pending window and a resubscribed job
  // still running), and clears the moment neither is true any more — which
  // covers every resolution: the job reaching `done`, AND the retry
  // resolving to `GenerateBriefCurrent` (`{brief}`, no `job_id` — brief.ts
  // onSuccess writes `job: null`, so `jobId`/`job.running` both go away
  // without `job.done` ever becoming true, F22b). Clearing only on
  // `job.done` (the F22 fix) missed that second exit.
  const [canRetry, setCanRetry] = React.useState(false);
  if (job.failed && !canRetry) setCanRetry(true);
  else if (!isGenerating && !job.failed && canRetry) setCanRetry(false);

  const review = latestReview(reviews);
  const blockers = blockerCount(review);
  const verdictMeta = review?.verdict ? VERDICT_META[review.verdict] : null;

  const generateError = generateBrief.error instanceof ApiError ? generateBrief.error : null;
  const configError = generateError?.code === "config_error" ? generateError : null;

  let statusText: string | null = null;
  // The hook carries no user-facing copy (client/AGENTS.md); a native stream
  // drop surfaces only `code: "stream_error"` (brief.ts, F19) and is mapped
  // here, while a server-supplied `failed` event keeps its own `message`.
  if (job.failed?.code === "stream_error") statusText = t("banner.streamError");
  else if (job.failed) statusText = t("banner.failed", { message: job.failed.message });
  else if (configError) statusText = configError.message;
  // F14/AC-64, AC-43/AC-45 — every other generate failure (409
  // `no_changed_files`, a 429 rate limit, a network drop, a 5xx…) must still
  // surface in the status region, with translated copy — never the raw
  // error code or HTTP status.
  else if (generateError) {
    statusText =
      generateError.code === "no_changed_files"
        ? t("banner.noChangedFiles")
        : generateError.status === 429
          ? t("banner.rateLimited")
          : t("banner.generateFailed");
  } else if (isGenerating && phase) statusText = t(`banner.phase.${phase}`);
  else if (job.done) statusText = t("banner.done");

  const onGenerate = () => generateBrief.mutate({});
  const onRegenerate = () => generateBrief.mutate({ force: true });
  const onRetry = () => generateBrief.mutate({ force: !!brief });

  if (isPending || !prId) {
    return (
      <Card>
        <div style={s.wrap}>
          <div style={s.titleRow}>
            <span style={s.title}>{t("banner.title")}</span>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div style={s.wrap}>
        <div style={s.topRow}>
          <div style={s.verdictRow}>
            {verdictMeta && review ? (
              <>
                <span style={{ color: verdictMeta.c, fontWeight: 600 }}>
                  {tReview(`verdict.${verdictMeta.labelKey}`)}
                </span>
                <Badge color="var(--text-secondary)">
                  {tReview("verdict.findingsCount", { count: review.findings.length })}
                  {blockers > 0 ? tReview("verdict.blockers", { count: blockers }) : ""}
                </Badge>
              </>
            ) : (
              <span style={s.title}>{t("banner.title")}</span>
            )}
            {outdated && (
              <Badge color="var(--warn)" bg="var(--warn-bg)">
                {t("banner.outdated")}
              </Badge>
            )}
          </div>
          {review?.score != null && (
            <div style={s.scoreCol}>
              <CircularScore score={review.score} size={48} stroke={5} />
            </div>
          )}
        </div>

        <div role="status" style={s.statusRow}>
          {statusText}
        </div>

        {configError && (
          <div style={s.errorRow}>
            <Link href="/settings/api-keys" style={s.settingsLink}>
              {t("banner.openSettings")}
            </Link>
          </div>
        )}

        {brief ? (
          <>
            <p style={s.summary}>{brief.summary}</p>

            {brief.missing_inputs.length > 0 && (
              <div style={s.missingRow}>
                <span>{t("banner.generatedWithout")}</span>
                {brief.missing_inputs.map((m, i) => (
                  <span key={i}>
                    {m.detail != null
                      ? t("banner.missingItemDetail", {
                          input: t(`input.${m.input}`),
                          state: t(`state.${m.state}`),
                          detail: m.detail,
                        })
                      : t("banner.missingItem", {
                          input: t(`input.${m.input}`),
                          state: t(`state.${m.state}`),
                        })}
                  </span>
                ))}
              </div>
            )}

            <div style={s.footer}>
              <span>{brief.stats.cost_usd != null ? t("banner.cost", { cost: formatCost(brief.stats.cost_usd) }) : t("banner.costUnknown")}</span>
              <span>{t("banner.tokens", { tokensIn: formatTokens(brief.stats.tokens_in), tokensOut: formatTokens(brief.stats.tokens_out) })}</span>
              <span>{t("banner.meta", { model: brief.model, time: new Date(brief.generated_at).toLocaleString() })}</span>
            </div>
          </>
        ) : (
          <p style={s.summary}>{t("banner.noBrief")}</p>
        )}

        <div style={s.actionsRow}>
          {!brief ? (
            <Button kind="primary" disabled={isGenerating} onClick={onGenerate}>
              {t("banner.generate")}
            </Button>
          ) : (
            <Button kind={outdated ? "primary" : "secondary"} disabled={isGenerating} onClick={onRegenerate}>
              {t("banner.regenerate")}
            </Button>
          )}
          {canRetry && (
            <Button kind="secondary" disabled={isGenerating} onClick={onRetry}>
              {t("banner.retry")}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
