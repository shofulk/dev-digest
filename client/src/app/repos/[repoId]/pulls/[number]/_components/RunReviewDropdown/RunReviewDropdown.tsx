/* RunReviewDropdown — the PR-page "Review" menu: a picker of agents that starts one
   multi-agent run (POST /pulls/:id/multi-agent-run) and opens its results page.
   Every open re-checks the enabled agents. The onRunStart / onRunsStarted /
   onRunSettled callbacks keep firing so the parent can track the live runs. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, EmptyState } from "@devdigest/ui";
import { useAgents } from "../../../../../../../lib/hooks/agents";
import { useRunEstimates, useStartMultiRun } from "../../../../../../../lib/hooks/multi-agent";
import { estimateFor } from "../../../../../../../lib/multi-agent-estimates";
import { PICKER_WIDTH } from "./constants";
import { s } from "./styles";

export function RunReviewDropdown({
  prId,
  repoId,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  /** Repo of the PR — the results page lives under it. */
  repoId?: string;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const tm = useTranslations("multiAgent");
  const tr = useTranslations("runs");
  const router = useRouter();
  const { data: agents } = useAgents();
  const { data: estimates } = useRunEstimates();
  const start = useStartMultiRun();
  const all = agents ?? [];
  const hasEnabled = all.some((a) => a.enabled);

  const [open, setOpen] = React.useState(false);
  // `null` = untouched since this open: derive the checks from the enabled agents (AC-2), so
  // a picker opened before /agents resolves still preselects them once the list arrives.
  const [picked, setPicked] = React.useState<Set<string> | null>(null);
  const checked = picked ?? new Set(all.filter((a) => a.enabled).map((a) => a.id));
  const count = all.filter((a) => checked.has(a.id)).length;
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const openPicker = () => {
    // Every open starts again from the enabled agents (AC-2).
    setPicked(null);
    setOpen(true);
  };

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(checked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };

  const estimateById = new Map((estimates ?? []).map((e) => [e.agent_id, e]));

  const run = async () => {
    const agentIds = all.filter((a) => checked.has(a.id)).map((a) => a.id);
    if (agentIds.length === 0) return;
    onRunStart?.();
    try {
      const res = await start.mutateAsync({ prId, agentIds });
      onRunsStarted?.(res.runs.map((r) => r.run_id));
      setOpen(false);
      if (repoId) router.push(`/repos/${repoId}/multi-agent/${res.multi_agent_run_id}`);
    } catch {
      // The global MutationCache toasts the API error; keep the open picker and its checks (AC-19).
    } finally {
      onRunSettled?.();
    }
  };

  return (
    <div ref={wrapRef} style={s.wrap}>
      <span
        title={warnMerged ? t("runReview.mergedTooltip") : undefined}
        style={warnMerged ? { opacity: 0.6 } : undefined}
      >
        <Button
          kind={kind}
          size={size}
          iconRight="ChevronDown"
          icon="Sparkles"
          loading={start.isPending}
          onClick={() => (open ? setOpen(false) : openPicker())}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          {start.isPending ? t("runReview.running") : t("runReview.runReview")}
        </Button>
      </span>
      {open && (
        <div role="dialog" aria-label={tm("picker.title")} style={s.panel(PICKER_WIDTH)}>
          {!hasEnabled ? (
            <EmptyState
              title={tr("page.noAgents.title")}
              body={tr("page.noAgents.body")}
              cta={tr("page.noAgents.cta")}
              onCta={() => router.push("/agents")}
            />
          ) : (
            <>
              <div style={s.header}>
                <h2 style={s.title}>{tm("picker.title")}</h2>
                <button type="button" style={s.clear} onClick={() => setPicked(new Set())}>
                  {tm("picker.clear")}
                </button>
              </div>
              {warnMerged && <div style={s.warn}>{t("runReview.mergedWarning")}</div>}
              {all.map((a) => {
                const secs = estimateFor(estimateById.get(a.id)).seconds;
                return (
                  <div key={a.id} style={s.row}>
                    <div style={s.rowLabel}>
                      <Checkbox
                        checked={checked.has(a.id)}
                        onChange={(v) => toggle(a.id, v)}
                        label={a.name}
                      />
                    </div>
                    <span className="mono" style={s.estimate}>
                      {secs == null ? tm("picker.noEstimate") : tm("picker.estimateSeconds", { seconds: secs })}
                    </span>
                  </div>
                );
              })}
              <div style={s.footer}>
                <Button
                  kind="primary"
                  icon="Users"
                  full
                  disabled={count === 0 || start.isPending}
                  onClick={run}
                >
                  {tm("picker.run", { count })}
                </Button>
              </div>
            </>
          )}
          <button type="button" style={s.configure} onClick={() => router.push("/agents")}>
            {tm("picker.configureAgents")}
          </button>
        </div>
      )}
    </div>
  );
}
