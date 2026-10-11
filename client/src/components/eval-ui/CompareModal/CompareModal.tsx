/* CompareModal — two suite runs side by side: four metric tiles (recall, precision, citation,
   cost — `old → new` with a signed, toned delta), the full system-prompt diff with its
   old/new legend, the cases that flipped, and a Promote action that restores the newer
   version as a new agent version. The caller passes the ids already ordered [older, newer]
   (`orderPair`). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Modal, Skeleton } from "@devdigest/ui";
import type { EvalPromptDiffLine } from "@devdigest/shared/contracts/eval-ci";
import { useEvalCompare } from "@/lib/hooks/eval";
import { useAgent, useRestoreAgentVersion } from "@/lib/hooks/agents";
import { notify } from "@/lib/toast";
import { formatCost } from "@/lib/format-cost";
import { deltaTone, formatMetric, signedDelta, toneColor, type DeltaTone } from "@/lib/eval-metrics";
import { s } from "./styles";

const PREFIX: Record<EvalPromptDiffLine["op"], string> = { same: "  ", add: "+ ", del: "− " };

const MINUS = "−";

/** Signed dollar delta (`+$0.01` / `−$0.003`); `null` as an em dash. */
function signedCost(v: number | null): string {
  if (v == null) return formatCost(null);
  if (v === 0) return "±$0";
  return (v > 0 ? "+" : MINUS) + formatCost(Math.abs(v));
}

/** Cost tone is inverted (a cheaper run is the good one); exact sign, so sub-cent moves count. */
function costTone(delta: number | null): DeltaTone {
  return deltaTone(delta == null ? null : -Math.sign(delta));
}

function Tile({ label, from, to, text, tone }: { label: string; from: string; to: string; text: string; tone: DeltaTone }) {
  return (
    <div style={s.tile} data-testid="compare-tile">
      <span style={s.tileLabel}>{label}</span>
      <span className="tnum" style={s.tileValues}>
        {from} {"→"} {to}
      </span>
      <span className="tnum" data-tone={tone} style={s.delta(toneColor(tone))}>
        {text}
      </span>
    </div>
  );
}

export function CompareModal({ runA, runB, onClose }: { runA: string; runB: string; onClose: () => void }) {
  const t = useTranslations("eval");
  const { data, isLoading, isError, refetch } = useEvalCompare(runA, runB);
  const agent = useAgent(data?.a.agent_id);
  const restore = useRestoreAgentVersion();

  // Promote only a version that is not already the agent's current one, and only when its
  // prompt was stored (otherwise the diff the user judged by is not available).
  const canPromote = !!data && data.prompt_available && !!agent.data && agent.data.version !== data.b.agent_version;
  const onPromote = () => {
    if (!data) return;
    const version = data.b.agent_version;
    restore.mutate(
      { id: data.a.agent_id, version },
      {
        onSuccess: (updated) => {
          notify.success(t("compare.promoted", { from: version, to: updated.version }));
          onClose();
        },
        onError: () => notify.error(t("compare.promoteFailed", { version })),
      },
    );
  };

  let content: React.ReactNode;
  if (isLoading) {
    content = (
      <div style={s.skeletons}>
        <Skeleton height={64} />
        <Skeleton height={160} />
      </div>
    );
  } else if (isError || !data) {
    content = <ErrorState title={t("compare.loadFailed")} onRetry={() => refetch()} />;
  } else {
    const { a, b, delta } = data;
    content = (
      <div style={s.body}>
        <div style={s.tiles}>
          <Tile
            label={t("compare.tile.recall")}
            from={formatMetric(a.recall)}
            to={formatMetric(b.recall)}
            text={signedDelta(delta.recall)}
            tone={deltaTone(delta.recall)}
          />
          <Tile
            label={t("compare.tile.precision")}
            from={formatMetric(a.precision)}
            to={formatMetric(b.precision)}
            text={signedDelta(delta.precision)}
            tone={deltaTone(delta.precision)}
          />
          <Tile
            label={t("compare.tile.citation")}
            from={formatMetric(a.citation_accuracy)}
            to={formatMetric(b.citation_accuracy)}
            text={signedDelta(delta.citation_accuracy)}
            tone={deltaTone(delta.citation_accuracy)}
          />
          <Tile
            label={t("compare.tile.cost")}
            from={formatCost(a.cost_usd)}
            to={formatCost(b.cost_usd)}
            text={signedCost(delta.cost_usd)}
            tone={costTone(delta.cost_usd)}
          />
        </div>

        <div>
          <div style={s.headingRow}>
            <div style={s.headingText}>{t("compare.promptDiff")}</div>
            <span style={s.legend}>
              <span style={s.swatch("var(--crit)")} aria-hidden />
              {t("compare.legendOld", { version: a.agent_version })}
            </span>
            <span style={s.legend}>
              <span style={s.swatch("var(--ok)")} aria-hidden />
              {t("compare.legendNew", { version: b.agent_version })}
            </span>
          </div>
          {!data.prompt_available ? (
            <div style={s.note}>{t("compare.promptUnavailable")}</div>
          ) : data.prompt_diff.every((l) => l.op === "same") ? (
            <div style={s.note}>{t("compare.samePrompt")}</div>
          ) : (
            <div className="mono" style={s.diff}>
              {data.prompt_diff.map((l, i) => (
                <div key={i} data-op={l.op} style={s.diffLine(l.op)}>
                  {PREFIX[l.op]}
                  {l.text}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={s.heading}>{t("compare.flipped")}</div>
          {data.flips.length === 0 ? (
            <div style={s.note}>{t("compare.noFlips")}</div>
          ) : (
            <div style={s.list}>
              {data.flips.map((f) => (
                <div key={f.case_id}>
                  {f.name}: {t(f.direction === "pass_to_fail" ? "compare.passToFail" : "compare.failToPass")}
                </div>
              ))}
            </div>
          )}
          {data.only_in_a.length > 0 && (
            <div style={{ ...s.note, marginTop: 8 }}>
              {t("compare.onlyInA")}: {data.only_in_a.map((c) => c.name).join(", ")}
            </div>
          )}
          {data.only_in_b.length > 0 && (
            <div style={{ ...s.note, marginTop: 8 }}>
              {t("compare.onlyInB")}: {data.only_in_b.map((c) => c.name).join(", ")}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Modal
      width={860}
      title={data ? t("compare.titleVersions", { a: data.a.agent_version, b: data.b.agent_version }) : t("compare.title")}
      subtitle={data ? t("compare.subtitle") : undefined}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="secondary" onClick={onClose}>
            {t("compare.close")}
          </Button>
          {canPromote && data && (
            <Button kind="primary" disabled={restore.isPending} loading={restore.isPending} onClick={onPromote}>
              {t("compare.promote", { version: data.b.agent_version })}
            </Button>
          )}
        </div>
      }
    >
      {content}
    </Modal>
  );
}
