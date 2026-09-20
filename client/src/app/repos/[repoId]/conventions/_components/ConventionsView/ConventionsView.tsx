/* ConventionsView — /repos/:repoId/conventions. Scan the cloned repo for the house-rules it
   already follows, triage them, and merge the accepted ones into a skill.

   Every candidate on this board has already passed the server's evidence gate, so the
   snippets are real repo bytes. The counters strip reports what the gate dropped, so a thin
   board reads as "the gate worked", not "the feature is broken". The candidate under inline
   edit lives in `?candidate=`, so a reload (or a shared link) reopens the same editor. */
"use client";

import React from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Chip, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { ConventionSkillDraft } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import {
  useConventionScan,
  useConventions,
  useDeleteConvention,
  useScanConventions,
  useSkillDraft,
  useUpdateConvention,
} from "@/lib/hooks/conventions";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { notify } from "@/lib/toast";
import { CandidateCard } from "./_components/CandidateCard";
import { CandidateEditor } from "./_components/CandidateEditor";
import { CreateSkillModal } from "./_components/CreateSkillModal";
import {
  CANDIDATE_PARAM,
  FILTERS,
  LOG_TAIL,
  SKELETON_CARDS,
  SKELETON_HEIGHT,
  type ConventionFilter,
} from "./constants";
import {
  buildCandidateUrl,
  countByStatus,
  filterCandidates,
  githubEvidenceUrl,
  selectedSkillIds,
} from "./helpers";
import { s } from "./styles";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data: candidates, isLoading, isError, refetch } = useConventions(repoId);
  const startScan = useScanConventions();
  const update = useUpdateConvention();
  const remove = useDeleteConvention();
  const draftSkill = useSkillDraft();

  const [scanId, setScanId] = React.useState<string | null>(null);
  const scan = useConventionScan(scanId, repoId);

  /** null = follow the scan's own verdict below; a chip click pins one filter. */
  const [filterOverride, setFilterOverride] = React.useState<ConventionFilter | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<ConventionSkillDraft | undefined>();
  /** Accepted candidates the user unticked; empty means "all of them". */
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set());

  const editingId = search.get(CANDIDATE_PARAM);
  const setEditing = (id: string | null) =>
    router.replace(buildCandidateUrl(pathname, search.toString(), id), { scroll: false });

  // Until the user pins a chip, a finished scan decides which triage state is worth looking
  // at: a first scan produces only pending rows, a re-scan may produce none at all. Derived,
  // not an effect, so the board never renders the wrong filter for one frame.
  const result = scan.result;
  const filter: ConventionFilter =
    filterOverride ??
    (result && !result.candidates.some((c) => c.status === "pending") ? "all" : "pending");

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const repoName = activeRepo?.full_name ?? t("page.repoFallback");
  const all = candidates ?? [];
  const counts = countByStatus(all);
  const visible = filterCandidates(all, filter);
  const scanned = all.length > 0;
  const selectedIds = selectedSkillIds(all, excluded);
  const acceptedIds = all.filter((c) => c.status === "accepted").map((c) => c.id);
  const scanning = startScan.isPending || scan.running;

  const runScan = async () => {
    try {
      setFilterOverride(null); // a new scan gets to pick the filter again
      const { scan_id } = await startScan.mutateAsync(repoId);
      setScanId(scan_id);
    } catch {
      notify.error(t("page.extractionFailed"));
    }
  };

  const openSkillModal = async () => {
    setDraft(undefined);
    setModalOpen(true);
    try {
      setDraft(await draftSkill.mutateAsync({ repoId, conventionIds: selectedIds }));
    } catch {
      setModalOpen(false);
      notify.error(t("page.draftFailed"));
    }
  };

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        {modalOpen && (
          <CreateSkillModal
            repoName={repoName}
            selectedCount={selectedIds.length}
            draft={draft}
            onClose={() => setModalOpen(false)}
          />
        )}

        <div style={s.headerRow}>
          <h1 style={s.heading}>
            {t("page.headingPrefix")}
            <span className="mono" style={s.repoName}>
              {repoName}
            </span>
          </h1>
          <Button icon="RefreshCw" onClick={runScan} loading={scanning} disabled={scanning}>
            {scanning ? t("page.scanning") : scanned ? t("page.rescan") : t("page.runExtraction")}
          </Button>
        </div>
        <p style={s.subtitle}>{t("page.subtitle")}</p>

        {scan.running && (
          <pre style={s.log} aria-label={t("page.scan.liveLabel")} data-testid="scan-log">
            {scan.events.length === 0
              ? t("page.scan.waiting")
              : scan.events
                  .slice(-LOG_TAIL)
                  .map((e) => `${e.t}  ${e.msg}`)
                  .join("\n")}
          </pre>
        )}

        {result && (
          <div style={s.counters} data-testid="scan-counters">
            <span>
              {t("page.scan.counters", {
                sampled: result.sampled_files.length,
                proposed: result.proposed,
                droppedUngrounded: result.dropped_ungrounded,
                droppedDuplicate: result.dropped_duplicate,
              })}
            </span>
            <span className="mono" style={s.counterMeta}>
              {t("page.scan.model", { model: result.model })}
              {result.cost_usd != null && ` · ${t("page.scan.cost", { cost: result.cost_usd })}`}
            </span>
          </div>
        )}

        {scanned && (
          <div style={s.toolbar}>
            {FILTERS.map((f) => (
              <Chip
                key={f}
                active={filter === f}
                count={counts[f]}
                onClick={() => setFilterOverride(f)}
              >
                {t(`page.filter.${f}`)}
              </Chip>
            ))}
            <div style={s.toolbarSpacer} />
            {counts.accepted > 0 && (
              <>
                <Button
                  kind="ghost"
                  size="sm"
                  icon="X"
                  onClick={() =>
                    setExcluded(excluded.size === 0 ? new Set(acceptedIds) : new Set())
                  }
                >
                  {excluded.size === 0 ? t("page.deselectAll") : t("page.selectAll")}
                </Button>
                <span style={s.selectionNote}>
                  {t("page.selectedCount", {
                    selected: selectedIds.length,
                    total: counts.accepted,
                  })}
                </span>
              </>
            )}
            <Button
              kind="primary"
              icon="Sparkles"
              disabled={selectedIds.length === 0 || draftSkill.isPending}
              onClick={openSkillModal}
            >
              {t("page.createSkill")}
            </Button>
          </div>
        )}

        {isLoading && (
          <div style={s.list} data-testid="conventions-skeleton">
            {Array.from({ length: SKELETON_CARDS }, (_, i) => (
              <Skeleton key={i} height={SKELETON_HEIGHT} />
            ))}
          </div>
        )}

        {isError && <ErrorState title={t("page.loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && !scanned && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={runScan}
            ctaLoading={scanning}
          />
        )}

        {!isLoading && !isError && scanned && visible.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title={t("page.emptyFiltered.title")}
            body={t("page.emptyFiltered.body")}
          />
        )}

        {visible.length > 0 && (
          <>
            <p style={s.listNote}>
              <Icon.Check size={12} style={{ verticalAlign: "-1px", marginRight: 6 }} />
              {t("page.candidateCount", { count: visible.length })}
            </p>
            <div style={s.list}>
              {visible.map((candidate) =>
                candidate.id === editingId ? (
                  <CandidateEditor
                    key={candidate.id}
                    candidate={candidate}
                    busy={update.isPending}
                    onCancel={() => setEditing(null)}
                    onSave={(patch) => {
                      update.mutate({ repoId, id: candidate.id, patch });
                      setEditing(null);
                    }}
                  />
                ) : (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    busy={update.isPending}
                    evidenceHref={githubEvidenceUrl(
                      activeRepo?.full_name,
                      activeRepo?.default_branch,
                      candidate.evidence_path,
                      candidate.evidence_line,
                    )}
                    selectable={candidate.status === "accepted"}
                    selected={!excluded.has(candidate.id)}
                    onSelect={(on) =>
                      setExcluded((prev) => {
                        const next = new Set(prev);
                        if (on) next.delete(candidate.id);
                        else next.add(candidate.id);
                        return next;
                      })
                    }
                    onStatus={(status) =>
                      update.mutate({ repoId, id: candidate.id, patch: { status } })
                    }
                    onEdit={() => setEditing(candidate.id)}
                    onDelete={() => remove.mutate({ repoId, id: candidate.id })}
                  />
                ),
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
