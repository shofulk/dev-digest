/* CiRunsTable — the CI run table shared by the agent CI tab and /ci-runs. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { CiRun } from "@devdigest/shared";
import { formatCost } from "../../lib/format-cost";

/** Links to GitHub only: anything else from the server is shown as plain text. */
export const isGithubUrl = (url: string | null | undefined): url is string =>
  !!url && url.startsWith("https://github.com/");

const VERDICT_COLOR = {
  blocked: "var(--crit)",
  passed: "var(--ok)",
  no_findings: "var(--text-secondary)",
  failed: "var(--warn)",
} as const;

const s = {
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "8px 10px", color: "var(--text-muted)", fontWeight: 600, borderBottom: "1px solid var(--border)" },
  td: { padding: "8px 10px", borderBottom: "1px solid var(--border)" },
} satisfies Record<string, React.CSSProperties>;

function formatDuration(ms: number | null): string {
  return ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

function ExternalLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!isGithubUrl(href)) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-text)" }}>
      {children}
    </a>
  );
}

export function CiRunsTable({ runs }: { runs: CiRun[] }) {
  const t = useTranslations("ci");
  return (
    <table style={s.table}>
      <thead>
        <tr>
          {(["repository", "pullRequest", "agent", "verdict", "findings", "cost", "duration"] as const).map((k) => (
            <th key={k} style={s.th}>
              {t(`runs.table.${k}`)}
            </th>
          ))}
          <th style={s.th} />
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} data-testid="ci-run-row">
            <td style={s.td} className="mono">{r.repo}</td>
            <td style={s.td}>
              <ExternalLink href={r.pr_url}>{r.pr_number != null ? `#${r.pr_number}` : "—"}</ExternalLink>
            </td>
            <td style={s.td}>{r.agent_name}</td>
            <td style={s.td}>
              <Badge color={VERDICT_COLOR[r.verdict]} dot>
                {t(`runs.verdict.${r.verdict}`)}
              </Badge>
            </td>
            <td style={s.td}>{r.findings_count}</td>
            <td style={s.td}>{formatCost(r.cost_usd)}</td>
            <td style={s.td}>{formatDuration(r.duration_ms)}</td>
            <td style={s.td}>
              {isGithubUrl(r.github_url) && <ExternalLink href={r.github_url}>{t("runs.table.viewJob")}</ExternalLink>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
