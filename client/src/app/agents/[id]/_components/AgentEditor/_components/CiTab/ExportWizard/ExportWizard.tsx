/* ExportWizard — "Export to CI": Target → Preview → Configure → Install. Owns all wizard
   state (Back keeps it, closing discards it). Data only through hooks/ci.ts. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, FormField, Modal, SelectInput } from "@devdigest/ui";
import type { Agent, CiPostAs, CiTrigger } from "@devdigest/shared";
import { ApiError } from "../../../../../../../../lib/api";
import { useCiPreview, useExportCi } from "../../../../../../../../lib/hooks/ci";
import { useRepos } from "../../../../../../../../lib/hooks/core";
import { useActiveRepo } from "../../../../../../../../lib/repo-context";
import { CI_POST_AS, CI_TRIGGERS } from "./constants";
import { buildZip, replaceTriggerTypes, sortTriggers, zipFileName } from "./helpers";
import { s } from "./styles";

const STEPS = ["target", "preview", "configure", "install"] as const;
const POST_AS_KEY = { github_review: "githubReview", pr_comment: "prComment", none: "none" } as const;
const WORKFLOW_PATH = ".github/workflows/devdigest-review.yml";

export interface ExportWizardProps {
  agent: Agent;
  mode: "add" | "update";
  /** Full names of the repositories where the agent has an installation. */
  installedRepos: string[];
  onClose: () => void;
}

export function ExportWizard({ agent, mode, installedRepos, onClose }: ExportWizardProps) {
  const t = useTranslations("ci.exportWizard");
  const { data: repos = [] } = useRepos();
  const { repoId: activeRepoId } = useActiveRepo();
  const exportCi = useExportCi(agent.id);

  const [step, setStep] = React.useState(0);
  const [repoChoice, setRepoChoice] = React.useState<string | null>(null);
  const [triggers, setTriggers] = React.useState<CiTrigger[]>(["opened", "synchronize"]);
  const [postAs, setPostAs] = React.useState<CiPostAs>("github_review");
  const [action, setAction] = React.useState<"open_pr" | "files">("open_pr");
  const [edited, setEdited] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [prUrl, setPrUrl] = React.useState<string | null>(null);

  const options = mode === "update" ? repos.filter((r) => installedRepos.includes(r.full_name)) : repos;
  const repo =
    options.find((r) => r.id === repoChoice) ?? options.find((r) => r.id === activeRepoId) ?? options[0] ?? null;

  const preview = useCiPreview(
    agent.id,
    step >= 1 && repo && triggers.length > 0 ? { repo_id: repo.id, triggers, post_as: postAs } : null,
  );
  const files = preview.data?.files ?? [];
  const current = files.find((f) => f.path === (selected ?? WORKFLOW_PATH)) ?? files[0];

  const toggleTrigger = (tr: CiTrigger) => {
    const next = sortTriggers(triggers.includes(tr) ? triggers.filter((x) => x !== tr) : [...triggers, tr]);
    setTriggers(next);
    if (edited !== null && next.length > 0) setEdited(replaceTriggerTypes(edited, next));
  };

  const install = () => {
    if (!repo) return;
    exportCi.mutate(
      { repo: repo.full_name, action, post_as: postAs, triggers, workflow: edited ?? undefined },
      {
        onSuccess: (res) => {
          if (action === "open_pr") {
            setPrUrl(res.pr_url ?? "");
            return;
          }
          const url = URL.createObjectURL(new Blob([buildZip(res.files) as BlobPart], { type: "application/zip" }));
          const a = document.createElement("a");
          a.href = url;
          a.download = zipFileName(repo.full_name);
          a.click();
          URL.revokeObjectURL(url);
          onClose();
        },
      },
    );
  };

  const error = exportCi.error as (ApiError & { details?: { line?: number; permissions?: string[] } }) | null;
  const done = prUrl !== null;

  const footer = (
    <div style={s.footer}>
      {step > 0 && !done && (
        <Button icon="ChevronLeft" onClick={() => setStep(step - 1)}>
          {t("back")}
        </Button>
      )}
      <div style={s.footerSpacer}>
        {done ? (
          <Button kind="primary" onClick={onClose}>
            {t("close")}
          </Button>
        ) : step < 3 ? (
          <Button
            kind="primary"
            iconRight="ChevronRight"
            disabled={(step === 0 && !repo) || (step === 2 && triggers.length === 0)}
            onClick={() => setStep(step + 1)}
          >
            {t("continue")}
          </Button>
        ) : (
          <Button kind="primary" disabled={exportCi.isPending || !repo} onClick={install}>
            {exportCi.isPending ? t("installing") : t("install")}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      width={880}
      title={t("title")}
      subtitle={t("subtitle", { agentName: agent.name })}
      onClose={onClose}
      footer={footer}
    >
      <div style={s.body}>
        <ExportWizardSteps step={step} labels={STEPS.map((k) => t(`steps.${k}`))} />

        {step === 0 && (
          <>
            <div style={s.card} role="radio" aria-checked="true">
              <strong>{t("targets.gha")}</strong>
              <span style={s.muted}>{t("targets.ghaDesc")}</span>
            </div>
            <FormField label={t("repoLabel")}>
              <SelectInput
                value={repo?.id ?? ""}
                onChange={setRepoChoice}
                options={options.map((r) => ({ value: r.id, label: r.full_name }))}
                mono={false}
              />
            </FormField>
          </>
        )}

        {step === 1 && (
          <>
            {preview.isError && <div style={s.error}>{t("previewError")} {preview.error.message}</div>}
            <div style={s.split}>
              <div style={s.files}>
                <span style={s.muted}>{t("filesToCreate")}</span>
                {preview.isPending && <span style={s.muted}>{t("generating")}</span>}
                {files.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    className="mono"
                    style={{ ...s.file, background: f.path === current?.path ? "var(--accent-bg)" : "transparent" }}
                    onClick={() => setSelected(f.path)}
                  >
                    {f.path}
                  </button>
                ))}
              </div>
              <div style={s.viewer}>
                {current && (
                  <>
                    <div className="mono" style={s.viewerHead}>
                      {current.path}
                      {current.editable && <span style={s.muted}>{t("editable")}</span>}
                    </div>
                    {current.editable ? (
                      <textarea
                        aria-label={t("workflowLabel")}
                        className="mono"
                        style={s.textarea}
                        value={edited ?? current.contents ?? ""}
                        onChange={(e) => setEdited(e.target.value)}
                      />
                    ) : current.contents === null ? (
                      <div style={{ ...s.pre, ...s.muted }}>{t("runnerSize", { size: current.size_bytes })}</div>
                    ) : (
                      <pre className="mono" style={s.pre}>{current.contents}</pre>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <FormField label={t("triggerLabel")}>
              <div style={s.chips}>
                {CI_TRIGGERS.map((tr) => (
                  <label key={tr} style={s.chip}>
                    <input type="checkbox" checked={triggers.includes(tr)} onChange={() => toggleTrigger(tr)} />
                    {t(`triggers.${tr}`)}
                  </label>
                ))}
              </div>
            </FormField>
            <FormField label={t("postResultsLabel")}>
              <div style={s.radios}>
                {CI_POST_AS.map((p) => (
                  <label key={p} style={s.radio}>
                    <input type="radio" name="post-as" checked={postAs === p} onChange={() => setPostAs(p)} />
                    {t(`postAs.${POST_AS_KEY[p]}`)}
                  </label>
                ))}
              </div>
            </FormField>
            <div style={s.hint}>{t("secretsHint")}</div>
          </>
        )}

        {step === 3 && !done && (
          <>
            <div style={s.option}>
              <label style={s.optionLabel}>
                <input type="radio" name="install" checked={action === "open_pr"} onChange={() => setAction("open_pr")} />
                {t("installCardTitle")}
              </label>
              <span style={s.muted}>
                {t("installCardBody", { repo: repo?.full_name ?? "", count: files.length })}
              </span>
            </div>
            <div style={s.option}>
              <label style={s.optionLabel}>
                <input type="radio" name="install" checked={action === "files"} onChange={() => setAction("files")} />
                {t("installZip")}
              </label>
            </div>
            {error && (
              <div role="alert" style={s.error}>
                <div>{error.message}</div>
                {error.details?.line != null && <div>{t("errorLine", { line: error.details.line })}</div>}
                {error.details?.permissions && (
                  <div>{t("errorPermissions", { list: error.details.permissions.join(", ") })}</div>
                )}
              </div>
            )}
          </>
        )}

        {done && (
          <div>
            <p>{t("prOpened")}</p>
            {prUrl && (
              <a href={prUrl} target="_blank" rel="noopener noreferrer" style={s.link}>
                {t("viewPr")}
              </a>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
