/* ProjectContextView — /repos/:repoId/context. Read-only: it shows the documents the
   repo's checkout exposes to every review run, grouped by folder, with the current
   document rendered as Markdown. Nothing here edits a document (AC-7); attaching one to
   an agent or a skill happens in their own Context tab (ContextDocPicker), not here. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Markdown, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { ApiError } from "@/lib/api";
import { useContextDoc, useContextDocs, useReindexContext } from "@/lib/hooks/context";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { firstDocPath, groupDocsByFolder } from "./helpers";
import { s } from "./styles";

export function ProjectContextView() {
  const t = useTranslations("context");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const docs = useContextDocs(repoId);
  const reindex = useReindexContext();
  // The path the user explicitly clicked, if any. Derived (not an effect): the first
  // document opens by default (AC-4), and a manual pick that disappears from a rescan
  // falls back to the new first document instead of pointing at nothing.
  const [manualPath, setManualPath] = React.useState<string | null>(null);

  const files = docs.data?.files ?? [];
  const groups = groupDocsByFolder(files);
  const selectedPath =
    manualPath && files.some((f) => f.path === manualPath) ? manualPath : firstDocPath(files);

  const selectedFile = files.find((f) => f.path === selectedPath) ?? null;
  const doc = useContextDoc(repoId, selectedFile?.path);

  const crumb = [{ label: t("page.title") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const conflict = docs.isError && docs.error instanceof ApiError && docs.error.status === 409;
  const repoName = activeRepo?.full_name;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.headerRow}>
          <h1 style={s.heading}>{repoName ? `${t("page.title")} — ${repoName}` : t("page.title")}</h1>
          <Button icon="RefreshCw" loading={reindex.isPending} onClick={() => repoId && reindex.mutate(repoId)}>
            {t("page.refresh")}
          </Button>
        </div>

        {docs.isLoading ? (
          <div style={s.skeletons}>
            <Skeleton height={16} />
            <Skeleton height={200} />
          </div>
        ) : conflict ? (
          <ErrorState
            body={docs.error instanceof ApiError ? docs.error.message : t("page.loadError")}
            onRetry={() => docs.refetch()}
          />
        ) : docs.isError ? (
          <ErrorState body={t("page.loadError")} onRetry={() => docs.refetch()} />
        ) : files.length === 0 ? (
          <EmptyState
            icon="FileText"
            title={t("page.empty.title")}
            body={t("page.empty.body", { roots: (docs.data?.roots ?? []).join(", ") })}
          />
        ) : (
          <>
            <div style={s.summary}>
              <span>
                {t("page.summary", {
                  count: docs.data!.count,
                  tokens: docs.data!.total_tokens,
                  scannedAt: new Date(docs.data!.scanned_at).toLocaleString(),
                })}
              </span>
              {docs.data!.truncated && <span style={s.truncatedNote}>{t("page.truncated", { count: docs.data!.count })}</span>}
            </div>

            <div style={s.body}>
              <nav style={s.sidebar} aria-label={t("page.title")}>
                {groups.map((group) => (
                  <div key={group.folder || "/"} style={s.folderGroup}>
                    <div style={s.folderLabel}>{group.folder || "/"}</div>
                    <div style={s.docList}>
                      {group.rows.map((row) => (
                        <button
                          key={row.path}
                          type="button"
                          style={s.docButton(row.path === selectedPath)}
                          onClick={() => setManualPath(row.path)}
                        >
                          {row.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </nav>

              <section style={s.preview}>
                {selectedFile ? (
                  <>
                    <div style={s.previewHeader}>
                      <span className="mono" style={s.previewPath}>
                        {selectedFile.path}
                      </span>
                      <span style={s.previewMeta}>{t("page.tokens", { tokens: selectedFile.tokens ?? 0 })}</span>
                      <span style={s.previewMeta}>
                        {t("page.usedBy", { count: selectedFile.used_by ?? 0 })}
                      </span>
                    </div>
                    <div style={s.previewBody}>
                      {doc.isLoading ? (
                        <Skeleton height={160} />
                      ) : doc.isError ? (
                        <ErrorState body={t("page.docError")} onRetry={() => doc.refetch()} />
                      ) : (
                        <Markdown>{doc.data?.content ?? ""}</Markdown>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={s.previewBody}>{t("page.selectPrompt")}</div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
