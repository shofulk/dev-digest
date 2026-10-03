// Ring 3 — edge. The only place with user-facing error text: tool names, ./scripts/dev.sh
// and "enable it in DevDigest" belong here, nowhere else in the package. The switch is
// exhaustive over KnownDomainError['kind'] (a TS never-check), so a new domain error class
// that forgets a case fails typecheck rather than silently falling through. This file also
// holds the one budget-exceeded text used by tools/result.ts's `guard`, the unexpected-error
// text `guard` falls back to, and the get_blast_radius stub text (C4, S7). rev 5: every
// value interpolated from a `DomainError` is clipped to `textMax` here — an `ApiFailure`
// detail, a URL, a repo/agent/run query, a list of known repos or ambiguous matches — so a
// long API message or a long tool argument cannot itself blow the response budget (R14).
// get_blast_radius reuses the existing PrNotImported/RepoNotFound/ApiFailure cases below —
// it needed no domain error of its own.
import type { KnownDomainError } from '../domain/errors.js';
import { truncate } from '../domain/findings.js';

export function toForwardText(err: KnownDomainError, textMax: number): string {
  const clip = (s: string) => truncate(s, textMax);
  switch (err.kind) {
    case 'api_unreachable':
      return `DevDigest API not reachable at ${clip(err.url)} — start DevDigest (./scripts/dev.sh) or set DEVDIGEST_API_URL.`;
    case 'rate_limited':
      return 'DevDigest API rate limit hit — retry in a minute.';
    case 'api_failure':
      return `DevDigest API error (HTTP ${err.status} at ${clip(err.url)}): ${clip(err.detail)}`;
    case 'repo_not_found':
      return err.known.length > 0
        ? `Repository "${clip(err.query)}" not found. Known repos: ${err.known.map(clip).join(', ')}.`
        : `Repository "${clip(err.query)}" not found, and DevDigest has no repos yet.`;
    case 'repo_ambiguous':
      return `Repository "${clip(err.query)}" is ambiguous — matches: ${err.matches.map(clip).join(', ')}. Use the full owner/name.`;
    case 'pr_not_imported':
      return `PR #${err.pr} of ${clip(err.repo)} is not imported in DevDigest — open it in the DevDigest UI first.`;
    case 'agent_not_found':
      return `Agent "${clip(err.query)}" not found — call list_agents to see what is available.`;
    case 'agent_ambiguous':
      return `Agent name "${clip(err.query)}" is ambiguous — matches ids: ${err.ids.map(clip).join(', ')}. Call list_agents and use an id.`;
    case 'agent_disabled':
      return `Agent "${clip(err.name)}" is disabled — enable it in DevDigest before running it.`;
    case 'no_run':
      return err.agent
        ? `No review run on ${clip(err.repo)}#${err.pr} for agent "${clip(err.agent)}" — call run_agent_on_pr first.`
        : `No review run on ${clip(err.repo)}#${err.pr} — call run_agent_on_pr first.`;
    case 'run_not_found':
      return `Run ${clip(err.runId)} was not found on ${clip(err.repo)}#${err.pr} — call get_findings without run_id to see the latest run.`;
    case 'run_not_started':
      return 'DevDigest accepted the review request but started no run — try run_agent_on_pr again.';
    case 'review_missing':
      return `Run ${clip(err.runId)} finished but its review is gone — call run_agent_on_pr again.`;
    default: {
      // rev 4: a `kind` outside DomainErrorKind (T13's runtime-only unmapped-subclass
      // control) still gets a forward-leading result here — an exception is not raised,
      // since `guard` must always resolve, never reject. This `never`-typed const still
      // fails typecheck for a real, unmapped KnownDomainError subclass (T14).
      const never: never = err;
      const unmapped = never as unknown as { kind: string; message: string };
      return `DevDigest error (${clip(unmapped.kind)}): ${clip(unmapped.message)}`;
    }
  }
}

/** The last-resort text when a tool's result still exceeds the budget after trimming. Each
 *  tool is named because they take different narrowing arguments — `get_blast_radius` has
 *  no `limit`/`min_severity`/`category` of its own, so it must not be told to pass one. */
export function budgetExceededText(toolName: string): string {
  if (toolName === 'get_blast_radius') {
    return `${toolName} response exceeded the size budget even after trimming — the PR touches too much shared code to summarize in one call.`;
  }
  return `${toolName} response exceeded the size budget even after trimming — narrow the request (e.g. limit, min_severity, category) and try again.`;
}

/** `guard`'s fallback for anything that is not a DomainError — `detail` is already clipped. */
export function unexpectedErrorText(toolName: string, detail: string): string {
  return `${toolName} failed unexpectedly: ${detail}`;
}
