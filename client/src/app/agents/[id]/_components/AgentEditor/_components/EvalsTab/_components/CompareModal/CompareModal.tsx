/* CompareModal — two suite runs side by side: four metric tiles (`old → new` with a signed,
   toned delta), the system-prompt line diff and the cases that flipped. The caller passes
   the ids already ordered [older, newer] (`orderPair`). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Modal, Skeleton } from "@devdigest/ui";
import type { EvalCompare, EvalPromptDiffLine } from "@devdigest/shared/contracts/eval-ci";
import { useEvalCompare } from "@/lib/hooks/eval";
import { deltaTone, formatMetric, signedDelta, toneColor } from "@/lib/eval-metrics";
import { s } from "./styles";

const PREFIX: Record<EvalPromptDiffLine["op"], string> = { same: "  ", add: "+ ", del: "− " };

/** Pass-rate difference for the passed/total tile; `null` when either side ran nothing. */
function passRateDelta(a: EvalCompare["a"], b: EvalCompare["b"]): number | null {
  if (a.traces_total === 0 || b.traces_total === 0) return null;
  return b.traces_passed / b.traces_total - a.traces_passed / a.traces_total;
}

function Tile({ label, from, to, delta }: { label: string; from: string; to: string; delta: number | null }) {
  const tone = deltaTone(delta);
  return (
    <div style={s.tile} data-testid="compare-tile">
      <span style={s.tileLabel}>{label}</span>
      <span className="tnum" style={s.tileValues}>
        {from} {"→"} {to}
      </span>
      <span className="tnum" data-tone={tone} style={s.delta(toneColor(tone))}>
        {signedDelta(delta)}
      </span>
    </div>
  );
}

export function CompareModal({ runA, runB, onClose }: { runA: string; runB: string; onClose: () => void }) {
  const t = useTranslations("eval");
  const { data, isLoading, isError, refetch } = useEvalCompare(runA, runB);

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
          <Tile label={t("suite.columns.recall")} from={formatMetric(a.recall)} to={formatMetric(b.recall)} delta={delta.recall} />
          <Tile label={t("suite.columns.precision")} from={formatMetric(a.precision)} to={formatMetric(b.precision)} delta={delta.precision} />
          <Tile
            label={t("suite.columns.citation")}
            from={formatMetric(a.citation_accuracy)}
            to={formatMetric(b.citation_accuracy)}
            delta={delta.citation_accuracy}
          />
          <Tile
            label={t("suite.columns.passed")}
            from={`${a.traces_passed}/${a.traces_total}`}
            to={`${b.traces_passed}/${b.traces_total}`}
            delta={passRateDelta(a, b)}
          />
        </div>

        <div>
          <div style={s.heading}>{t("compare.promptDiff")}</div>
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
      title={t("compare.title")}
      subtitle={data ? t("compare.versions", { a: data.a.agent_version, b: data.b.agent_version }) : undefined}
      onClose={onClose}
    >
      {content}
    </Modal>
  );
}
