/* EvalCaseModal — check an eval case before it is saved: name, the frozen input (Diff and PR
   meta tabs), the expected-output form, notes, and a dry run that stores nothing. The whole
   form lives here (a tab body only switches which inputs render), and the modal owns its
   mutations; parents only open it and hand over the opener element for focus return. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, Tabs, TextInput } from "@devdigest/ui";
import type { EvalCaseDraft, EvalDryRunResult } from "@devdigest/shared/contracts/eval-ci";
import type { EvalCase } from "@devdigest/shared/contracts/knowledge";
import {
  useAgentEvalBusy,
  useCreateEvalCaseByHand,
  useDryRunEvalCase,
  useSaveEvalCaseFromFinding,
  useUpdateEvalCase,
} from "@/lib/hooks/eval";
import { ApiError } from "@/lib/api";
import { notify } from "@/lib/toast";
import { formatCost } from "@/lib/format-cost";
import {
  CATEGORIES,
  EXPECTATION_TYPES,
  SEVERITIES,
  diffFilePaths,
  emptyForm,
  errorSlot,
  formFromCase,
  formFromDraft,
  isDirty,
  isFromFinding,
  toCaseFields,
  toFromFindingInput,
  type CaseForm,
  type ErrorSlot,
} from "./helpers";
import { s } from "./styles";

export type EvalCaseModalSource =
  | { kind: "new" }
  | { kind: "finding"; findingId: string; draft: EvalCaseDraft }
  | { kind: "edit"; evalCase: EvalCase; alreadyInSet?: boolean };

type InputTab = "diff" | "prMeta";
const ERROR_CODES: readonly string[] = [
  "invalid_name",
  "invalid_diff",
  "frozen_diff_too_large",
  "expectation_not_grounded",
  "locked_field",
  "run_in_flight",
  "provider_not_configured",
  "dry_run_timeout",
  "dry_run_failed",
];

type FormError = { slot: ErrorSlot; message: string };

function initialForm(source: EvalCaseModalSource): CaseForm {
  if (source.kind === "finding") return formFromDraft(source.draft);
  if (source.kind === "edit") return formFromCase(source.evalCase);
  return emptyForm();
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div style={s.field}>
      <label htmlFor={id} style={s.label}>
        {label}
      </label>
      {children}
      {error && (
        <div role="alert" style={s.fieldError}>
          {error}
        </div>
      )}
    </div>
  );
}

export function EvalCaseModal({
  agentId,
  source,
  onClose,
  returnFocusTo,
}: {
  agentId: string;
  source: EvalCaseModalSource;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
}) {
  const t = useTranslations("eval");
  const [initial] = React.useState(() => initialForm(source));
  const [form, setForm] = React.useState<CaseForm>(initial);
  const [tab, setTab] = React.useState<InputTab>("diff");
  const [error, setError] = React.useState<FormError | null>(null);
  const [result, setResult] = React.useState<EvalDryRunResult | null>(null);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);

  const createByHand = useCreateEvalCaseByHand(agentId);
  const saveFromFinding = useSaveEvalCaseFromFinding();
  const update = useUpdateEvalCase(agentId);
  const dryRun = useDryRunEvalCase(agentId);
  const agentBusy = useAgentEvalBusy(agentId);

  const locked = source.kind === "finding" || (source.kind === "edit" && isFromFinding(source.evalCase));
  const dirty = isDirty(initial, form);
  const saving = createByHand.isPending || saveFromFinding.isPending || update.isPending;
  const running = dryRun.isPending || agentBusy;
  const files = diffFilePaths(form.input_diff);
  const fileOptions = form.file && !files.includes(form.file) ? [form.file, ...files] : files;

  const set = <K extends keyof CaseForm>(key: K, value: CaseForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  // One close request for Cancel, the X, the backdrop and Escape: a dirty form asks first.
  const requestClose = () => (dirty ? setConfirmDiscard(true) : onClose());

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmDiscard) setConfirmDiscard(false);
      else if (dirty) setConfirmDiscard(true);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmDiscard, dirty, onClose]);

  // Focus goes back to the button that opened the modal once it unmounts.
  const openerRef = React.useRef(returnFocusTo);
  React.useEffect(() => {
    openerRef.current = returnFocusTo;
  }, [returnFocusTo]);
  React.useEffect(() => () => openerRef.current?.focus(), []);

  const fail = (err: Error) => {
    const code = err instanceof ApiError ? err.code : undefined;
    const known = code !== undefined && ERROR_CODES.includes(code);
    setError({ slot: errorSlot(code), message: t(`caseEditor.errors.${known ? code : "generic"}`) });
  };

  const onSave = () => {
    setError(null);
    const done = (message: string) => {
      notify.success(message);
      onClose();
    };
    if (source.kind === "finding") {
      saveFromFinding.mutate(
        { findingId: source.findingId, body: toFromFindingInput(form) },
        { onSuccess: (r) => done(t(r.created ? "caseEditor.created" : "caseEditor.saved")), onError: fail },
      );
    } else if (source.kind === "edit") {
      update.mutate(
        { caseId: source.evalCase.id, fields: toCaseFields(form) },
        { onSuccess: () => done(t("caseEditor.saved")), onError: fail },
      );
    } else {
      createByHand.mutate(toCaseFields(form), { onSuccess: () => done(t("caseEditor.created")), onError: fail });
    }
  };

  const onRun = () => {
    setError(null);
    setResult(null);
    dryRun.mutate(toCaseFields(form), { onSuccess: setResult, onError: fail });
  };

  const errorAt = (slot: ErrorSlot) => (error?.slot === slot ? error.message : undefined);
  const title =
    source.kind === "edit" ? t("caseEditor.caseTitle", { name: source.evalCase.name }) : t("caseEditor.newCase");

  return (
    <>
      <Modal
        width={760}
        title={title}
        subtitle={source.kind === "edit" && source.alreadyInSet ? t("caseEditor.alreadyInSet") : undefined}
        onClose={requestClose}
        footer={
          <div>
            {errorAt("form") && (
              <div role="alert" style={s.formError}>
                {errorAt("form")}
              </div>
            )}
            <div style={s.footer}>
              <Button kind="secondary" icon="Play" onClick={onRun} disabled={running || saving}>
                {running ? t("caseEditor.running") : t("caseEditor.runCase")}
              </Button>
              <div style={s.footerSpacer}>
                <Button kind="ghost" onClick={requestClose}>
                  {t("caseEditor.cancel")}
                </Button>
                <Button kind="primary" onClick={onSave} disabled={saving}>
                  {saving ? t("caseEditor.saving") : t("caseEditor.save")}
                </Button>
              </div>
            </div>
          </div>
        }
      >
        <div style={s.body}>
          <Field id="eval-case-name" label={t("caseEditor.nameLabel")} error={errorAt("name")}>
            <TextInput
              id="eval-case-name"
              value={form.name}
              onChange={(v) => set("name", v)}
              placeholder={t("caseEditor.namePlaceholder")}
            />
          </Field>

          <div style={s.section}>
            <div style={s.heading}>{t("caseEditor.inputLabel")}</div>
            <Tabs
              pad="0"
              value={tab}
              onChange={(k) => setTab(k as InputTab)}
              tabs={[
                { key: "diff", label: t("caseEditor.tabs.diff") },
                { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
              ]}
            />
            {tab === "diff" ? (
              <Field id="eval-case-diff" label={t("caseEditor.tabs.diff")} error={errorAt("diff")}>
                {locked ? (
                  <pre id="eval-case-diff" className="mono" style={s.diffPre}>
                    {form.input_diff}
                  </pre>
                ) : (
                  <textarea
                    id="eval-case-diff"
                    className="mono"
                    rows={10}
                    style={s.textarea}
                    value={form.input_diff}
                    placeholder={t("caseEditor.diffPlaceholder")}
                    onChange={(e) => set("input_diff", e.target.value)}
                  />
                )}
              </Field>
            ) : (
              <>
                <Field id="eval-case-pr-title" label={t("caseEditor.titleLabel")}>
                  <TextInput
                    id="eval-case-pr-title"
                    value={form.pr_title}
                    onChange={(v) => set("pr_title", v)}
                    placeholder={t("caseEditor.titlePlaceholder")}
                  />
                </Field>
                <Field id="eval-case-pr-body" label={t("caseEditor.bodyLabel")}>
                  <textarea
                    id="eval-case-pr-body"
                    rows={5}
                    style={s.textarea}
                    value={form.pr_body}
                    placeholder={t("caseEditor.bodyPlaceholder")}
                    onChange={(e) => set("pr_body", e.target.value)}
                  />
                </Field>
              </>
            )}
          </div>

          <div style={s.section}>
            <div style={s.heading}>{t("caseEditor.expectationHeading")}</div>
            {locked && <div style={s.note}>{t("caseEditor.lockedHint")}</div>}
            <div style={s.row}>
              <Field id="eval-case-type" label={t("caseEditor.typeLabel")}>
                {locked ? (
                  <span id="eval-case-type" style={s.chip}>
                    {t(form.type === "must_find" ? "suite.typeMustFind" : "suite.typeMustNotFlag")}
                  </span>
                ) : (
                  <select
                    id="eval-case-type"
                    style={s.select}
                    value={form.type}
                    onChange={(e) => set("type", e.target.value as CaseForm["type"])}
                  >
                    {EXPECTATION_TYPES.map((v) => (
                      <option key={v} value={v}>
                        {t(v === "must_find" ? "suite.typeMustFind" : "suite.typeMustNotFlag")}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field id="eval-case-file" label={t("caseEditor.fileLabel")} error={errorAt("expectation")}>
                <select
                  id="eval-case-file"
                  className="mono"
                  style={s.select}
                  value={form.file}
                  onChange={(e) => set("file", e.target.value)}
                >
                  <option value="">{t("caseEditor.fileEmpty")}</option>
                  {fileOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={s.row}>
              <Field id="eval-case-start" label={t("caseEditor.startLineLabel")}>
                <TextInput id="eval-case-start" type="number" value={form.start_line} onChange={(v) => set("start_line", v)} />
              </Field>
              <Field id="eval-case-end" label={t("caseEditor.endLineLabel")}>
                <TextInput id="eval-case-end" type="number" value={form.end_line} onChange={(v) => set("end_line", v)} />
              </Field>
              <Field id="eval-case-severity" label={t("caseEditor.severityLabel")}>
                <select
                  id="eval-case-severity"
                  style={s.select}
                  value={form.severity}
                  onChange={(e) => set("severity", e.target.value as CaseForm["severity"])}
                >
                  {SEVERITIES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="eval-case-category" label={t("caseEditor.categoryLabel")}>
                <select
                  id="eval-case-category"
                  style={s.select}
                  value={form.category}
                  onChange={(e) => set("category", e.target.value as CaseForm["category"])}
                >
                  {CATEGORIES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field id="eval-case-exp-title" label={t("caseEditor.expectationTitleLabel")}>
              <TextInput id="eval-case-exp-title" value={form.title} onChange={(v) => set("title", v)} />
            </Field>
          </div>

          <Field id="eval-case-notes" label={t("caseEditor.notesLabel")}>
            <textarea
              id="eval-case-notes"
              rows={3}
              style={s.textarea}
              value={form.notes}
              placeholder={t("caseEditor.notesPlaceholder")}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>

          {agentBusy && <div style={s.note}>{t("caseEditor.busyHint")}</div>}

          {result && (
            <div style={s.result} data-testid="dry-run-result">
              <div style={s.heading}>{t("caseEditor.result.heading")}</div>
              <div style={s.verdict(result.pass)}>{t(result.pass ? "caseEditor.result.pass" : "caseEditor.result.fail")}</div>
              {result.findings.length === 0 ? (
                <div style={s.note}>{t("caseEditor.result.noFindings")}</div>
              ) : (
                result.findings.map((f, i) => (
                  <div key={i} style={s.findingRow}>
                    <span style={s.matched(f.matched)}>
                      {t(f.matched ? "caseEditor.result.matched" : "caseEditor.result.unmatched")}
                    </span>
                    <span className="mono">
                      {f.file}:{f.start_line}-{f.end_line}
                    </span>
                    <span>{f.title}</span>
                  </div>
                ))
              )}
              <div style={s.resultMeta}>
                <span>{t("caseEditor.result.grounding", { kept: result.grounding_kept, dropped: result.grounding_dropped })}</span>
                <span>{t("caseEditor.result.cost", { cost: formatCost(result.cost_usd) })}</span>
                <span>{t("caseEditor.result.duration", { seconds: (result.duration_ms / 1000).toFixed(1) })}</span>
                <span>{t("caseEditor.result.version", { version: result.agent_version })}</span>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {confirmDiscard && (
        <Modal
          width={420}
          title={t("caseEditor.discard.title")}
          onClose={() => setConfirmDiscard(false)}
          footer={
            <div style={s.confirmFooter}>
              <Button kind="ghost" onClick={() => setConfirmDiscard(false)}>
                {t("caseEditor.discard.keep")}
              </Button>
              <Button kind="danger" onClick={onClose}>
                {t("caseEditor.discard.confirm")}
              </Button>
            </div>
          }
        >
          <div style={s.confirmBody}>{t("caseEditor.discard.body")}</div>
        </Modal>
      )}
    </>
  );
}
