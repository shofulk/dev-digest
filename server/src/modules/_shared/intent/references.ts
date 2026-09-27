// RING 1 — pure functions. Reference extraction + the SSRF-safe URL allowlist
// (D1, AC4/AC5/AC6). No I/O — `derive.ts` turns a `ReferenceCandidate` into an
// actual `GitHubClient` call. A source's `ref` here is ALREADY the normalised,
// loggable identifier (never the raw URL/query — AC6/AC12).
import { ALLOWED_DOC_EXTENSIONS, JIRA_KEY_DENYLIST } from './constants.js';
import type { IntentSourceKind } from '@devdigest/shared';

export interface RepoOwnerName {
  owner: string;
  name: string;
}

/** How to actually fetch a candidate — `derive.ts` maps this to GitHubClient
 *  calls; `blocked` candidates go straight to `not_fetched` with `reason`. */
export type FetchPlan =
  | { via: 'issue'; owner: string; name: string; number: number }
  | { via: 'file'; owner: string; name: string; path: string; gitRef: string }
  | { via: 'repo_doc'; path: string }
  | { via: 'blocked'; reason: string };

export interface ReferenceCandidate {
  kind: IntentSourceKind;
  /** Normalised, loggable identifier — the only thing ever logged/shown. */
  ref: string;
  fetch: FetchPlan;
}

const CLOSING_ISSUE_RE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*(?:([\w.-]+)\/([\w.-]+))?#(\d+)/gi;
const BARE_ISSUE_RE = /(?:^|[^\w/])(?:([\w.-]+)\/([\w.-]+))?#(\d+)/g;
const ISSUE_URL_RE = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/gi;
// F3: these only DETECT a blob/raw URL match (m[0]) — the owner/name/ref/path
// are then re-derived from `new URL(m[0]).pathname` (`parseBlobLikeUrl`), so a
// `?query` or `#fragment` on the URL can never leak into `path`/`ref` (AC6/AC12).
const BLOB_URL_RE = /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/blob\/[^\s)"'>]+/gi;
const RAW_URL_RE = /https?:\/\/raw\.githubusercontent\.com\/[\w.-]+\/[\w.-]+\/[^\s)"'>]+/gi;
// Repo-relative doc paths: `*.spec.md`, `*.plan.md`, or anything under `docs/`.
const REPO_DOC_RE = /(?:^|[\s(])((?:[\w.-]+\/)*[\w.-]+\.(?:spec|plan)\.md|docs\/[\w./-]+\.md)\b/gi;
const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/g;
const JIRA_URL_RE = /https?:\/\/[\w.-]+\.atlassian\.net\/browse\/([A-Z][A-Z0-9]*-\d+)/gi;
const LINEAR_URL_RE = /https?:\/\/linear\.app\/[\w-]+\/issue\/([A-Z]+-\d+)/gi;
/** Any other http(s) URL not already matched above (AC6's "any other URL" row). */
const GENERIC_URL_RE = /https?:\/\/[^\s)"'>]+/gi;

function isDocPath(path: string): boolean {
  return ALLOWED_DOC_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));
}

/** Dedupe by (kind, ref) — the same issue/doc referenced twice in the body
 *  becomes one source. */
function dedupe(candidates: ReferenceCandidate[]): ReferenceCandidate[] {
  const seen = new Set<string>();
  const out: ReferenceCandidate[] = [];
  for (const c of candidates) {
    const key = `${c.kind}:${c.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Extract every referenceable source from a PR body: closing-issue keywords +
 * bare `#N`/`owner/repo#N`, issue/blob/raw URLs, repo-relative doc paths, Jira
 * keys/URLs, Linear URLs — and any other URL, which is ALWAYS `blocked`
 * (AC6's SSRF allowlist; only github.com/raw.githubusercontent.com are ever
 * translated into a GitHubClient call).
 */
export function extractReferences(body: string, repo: RepoOwnerName): ReferenceCandidate[] {
  if (!body) return [];
  const out: ReferenceCandidate[] = [];

  for (const re of [CLOSING_ISSUE_RE, BARE_ISSUE_RE]) {
    for (const m of body.matchAll(re)) {
      const owner = m[1] || repo.owner;
      const name = m[2] || repo.name;
      const number = Number(m[3]);
      out.push(issueCandidate(owner, name, number, repo));
    }
  }
  for (const m of body.matchAll(ISSUE_URL_RE)) {
    out.push(issueCandidate(m[1]!, m[2]!, Number(m[3]), repo, m[0]));
  }
  for (const m of body.matchAll(BLOB_URL_RE)) {
    const parsed = parseBlobLikeUrl(m[0], 'blob');
    if (parsed) out.push(fileCandidate(m[0], parsed.owner, parsed.name, parsed.gitRef, parsed.path, repo));
  }
  for (const m of body.matchAll(RAW_URL_RE)) {
    const parsed = parseBlobLikeUrl(m[0], 'raw');
    if (parsed) out.push(fileCandidate(m[0], parsed.owner, parsed.name, parsed.gitRef, parsed.path, repo));
  }
  for (const m of body.matchAll(REPO_DOC_RE)) {
    const path = m[1]!;
    out.push({ kind: 'repo_doc', ref: `${repo.owner}/${repo.name}:${path}`, fetch: { via: 'repo_doc', path } });
  }
  for (const m of body.matchAll(JIRA_URL_RE)) {
    out.push(ticketCandidate(m[1]!));
  }
  for (const m of body.matchAll(LINEAR_URL_RE)) {
    out.push(ticketCandidate(m[1]!));
  }
  for (const m of body.matchAll(JIRA_KEY_RE)) {
    if (JIRA_KEY_DENYLIST.has(m[1]!)) continue;
    out.push(ticketCandidate(`${m[1]}-${m[2]}`));
  }
  for (const m of body.matchAll(GENERIC_URL_RE)) {
    const url = m[0];
    if (isKnownHost(url)) continue; // already matched by a specific pattern above
    out.push(blockedUrlCandidate(url));
  }

  return dedupe(out);
}

function isKnownHost(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return u.hostname === 'github.com' || u.hostname === 'raw.githubusercontent.com';
  } catch {
    return false;
  }
}

/** Exported so `derive.ts` can turn a GraphQL `closingIssuesReferences` node
 *  into the same candidate shape as a body-regex match (D2 §3 — unioned). */
export function issueCandidate(
  owner: string,
  name: string,
  number: number,
  repo: RepoOwnerName,
  sourceUrl?: string,
): ReferenceCandidate {
  const ref = `${owner}/${name}#${number}`;
  if (sourceUrl && !isSafeGithubUrl(sourceUrl)) {
    return { kind: 'linked_issue', ref, fetch: { via: 'blocked', reason: 'host_not_allowed' } };
  }
  if (owner !== repo.owner) {
    // Q7 (a): same-owner cross-repo is fetched; a different owner never is.
    return { kind: 'linked_issue', ref, fetch: { via: 'blocked', reason: 'cross_org' } };
  }
  return { kind: 'linked_issue', ref, fetch: { via: 'issue', owner, name, number } };
}

/** AC6: https only, no userinfo, no port. A URL failing this is `host_not_allowed`
 *  even though its host matched — a malformed/dangerous variant of an allowed host
 *  is not "allowed with an asterisk". */
function isSafeGithubUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return (
      u.protocol === 'https:' &&
      u.username === '' &&
      u.password === '' &&
      u.port === '' &&
      (u.hostname === 'github.com' || u.hostname === 'raw.githubusercontent.com')
    );
  } catch {
    return false;
  }
}

/**
 * F3 — derive `{ owner, name, gitRef, path }` from `new URL(fullUrl).pathname`
 * ONLY. `search` and `hash` are never consulted, so `?token=…`/`#frag` can
 * never reach `path` or the normalised `ref` that gets logged/shown (AC6/AC12).
 */
function parseBlobLikeUrl(
  fullUrl: string,
  kind: 'blob' | 'raw',
): { owner: string; name: string; gitRef: string; path: string } | null {
  let u: URL;
  try {
    u = new URL(fullUrl);
  } catch {
    return null;
  }
  const parts = u.pathname.split('/').filter(Boolean);
  const rest = kind === 'blob' ? (parts[2] === 'blob' ? parts.slice(4) : null) : parts.slice(3);
  if (!rest || rest.length === 0) return null;
  const [owner, name] = parts;
  const gitRef = kind === 'blob' ? parts[3] : parts[2];
  if (!owner || !name || !gitRef) return null;
  return { owner, name, gitRef, path: rest.map(decodeURIComponent).join('/') };
}

function fileCandidate(
  fullUrl: string,
  owner: string,
  name: string,
  gitRef: string,
  path: string,
  repo: RepoOwnerName,
): ReferenceCandidate {
  const shortRef = gitRef.slice(0, 7);
  const ref = `${owner}/${name}:${path}@${shortRef}`;
  if (!isSafeGithubUrl(fullUrl)) {
    return { kind: 'doc_link', ref, fetch: { via: 'blocked', reason: 'host_not_allowed' } };
  }
  if (owner !== repo.owner) {
    return { kind: 'doc_link', ref, fetch: { via: 'blocked', reason: 'cross_org' } };
  }
  if (!isDocPath(path)) {
    return { kind: 'doc_link', ref, fetch: { via: 'blocked', reason: 'unsupported' } };
  }
  return { kind: 'doc_link', ref, fetch: { via: 'file', owner, name, path, gitRef } };
}

function ticketCandidate(key: string): ReferenceCandidate {
  return { kind: 'ticket', ref: `jira:${key}`, fetch: { via: 'blocked', reason: 'no_adapter' } };
}

function blockedUrlCandidate(urlStr: string): ReferenceCandidate {
  let host = 'unknown';
  try {
    host = new URL(urlStr).hostname;
  } catch {
    /* malformed URL in body text — log the raw match, never the string itself */
  }
  return { kind: 'doc_link', ref: `host:${host}`, fetch: { via: 'blocked', reason: 'host_not_allowed' } };
}

/**
 * Hunk-header lines ONLY (`@@ -a,b +c,d @@ <context>`), never a patch body
 * line (a leading `+`/`-`/space is a diff line, not a header) — AC2's "no
 * diff body line ever reaches the prompt" guarantee.
 */
export function extractHunkHeaders(patch: string | null | undefined): string[] {
  if (!patch) return [];
  const out: string[] = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@ ')) out.push(line.trim());
  }
  return out;
}
