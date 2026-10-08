import type { z } from 'zod';
import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
  Embedder,
  GitHubClient,
  RepoRef,
  PrMeta,
  PrDetail,
  GitHubReviewPayload,
  CreateReviewCommentInput,
  PrReviewComment,
  OpenPrPayload,
  CommitFilesPayload,
  IssueMeta,
  GitClient,
  CloneOptions,
  UnifiedDiff,
  BlameLine,
  GitCommit,
  CodeIndex,
  CodeMatch,
  CodeSymbol,
  CodeReference,
  AuthProvider,
  AuthUser,
  AuthWorkspace,
  SecretsProvider,
  SecretKey,
  ProjectDocsSource,
  ProjectDocEntry,
  ProjectDocRead,
  ProjectDocsListResult,
} from '@devdigest/shared';
import { parseUnifiedDiff } from './git/diff-parser.js';

/**
 * Deterministic MOCK adapters for tests/dev — NO real network. Each mirrors the
 * adapter interface. The mock LLM returns a caller-supplied fixture (or a default)
 * for completeStructured, so review/grounding flows can be tested end-to-end.
 *
 * This file must stay free of runtime third-party imports (type-only and
 * relative imports are fine): `reviewer-core` tests import it directly and
 * run in a CI job that installs ONLY `reviewer-core`'s dependencies, with no
 * `server/node_modules` on the resolution path — see `server/INSIGHTS.md`.
 */

// ---------- Mock LLM ----------
export interface MockLLMOptions {
  models?: ModelInfo[];
  /** Fixture returned by completeStructured (validated against the schema). */
  structured?: unknown;
  /**
   * Per-schemaName fixtures for multi-call flows (e.g. the conventions 2-step
   * dialogue: 'ConventionFileSelection' then 'ConventionExtraction'). Looked up
   * by req.schemaName; falls back to `structured` when no entry matches.
   */
  structuredBySchema?: Record<string, unknown>;
  completionText?: string;
  embedding?: number[];
}

export class MockLLMProvider implements LLMProvider {
  readonly id: 'openai' | 'anthropic' | 'openrouter';
  public calls: { method: string; req: unknown }[] = [];

  constructor(
    id: 'openai' | 'anthropic' | 'openrouter' = 'openai',
    private opts: MockLLMOptions = {},
  ) {
    this.id = id;
  }

  async listModels(): Promise<ModelInfo[]> {
    this.calls.push({ method: 'listModels', req: null });
    return (
      this.opts.models ?? [
        { id: 'gpt-4.1', provider: this.id === 'anthropic' ? 'anthropic' : 'openai' },
      ]
    );
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push({ method: 'complete', req });
    return {
      text: this.opts.completionText ?? 'mock completion',
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
    };
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    const fixture = this.opts.structuredBySchema?.[req.schemaName] ?? this.opts.structured ?? {};
    const parsed = (req.schema as z.ZodType<T>).safeParse(fixture);
    if (!parsed.success) {
      throw new Error(`MockLLMProvider fixture failed schema: ${parsed.error.message}`);
    }
    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(fixture),
      attempts: 1,
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    this.calls.push({ method: 'embed', req: texts });
    return texts.map(() => this.opts.embedding ?? new Array(1536).fill(0));
  }
}

// ---------- Mock Embedder ----------
export class MockEmbedder implements Embedder {
  readonly dims = 1536;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((_, i) => new Array(1536).fill(0).map((_, j) => (i + j) % 2));
  }
}

// ---------- Mock GitHub ----------
export interface MockGitHubOptions {
  pulls?: PrMeta[];
  detail?: Partial<PrDetail>;
  login?: string;
  /** Existing inline review comments returned by listReviewComments. */
  comments?: PrReviewComment[];
  /** In-memory file fixtures for getFileContent, keyed `path@ref` (falls back
   *  to `path`). A missing entry → 404 (`not found`); `'timeout'` as the
   *  content triggers a thrown timeout-flavoured error for tests; `'never'`
   *  never resolves (a slow-fetch probe fixture — the caller's own
   *  `withTimeout`/`opts.timeoutMs` is what stops it). */
  files?: Record<string, { content: string; size?: number } | 'timeout' | '404' | 'never'>;
  /** Closing-issue refs returned by listClosingIssueRefs, keyed by PR number.
   *  `'never'` never resolves — a slow-fetch probe fixture, same as `files`. */
  closingRefs?: Record<number, { owner: string; name: string; number: number }[] | 'never'>;
}

export class MockGitHubClient implements GitHubClient {
  public posted: { n: number; review: GitHubReviewPayload }[] = [];
  public openedPrs: OpenPrPayload[] = [];
  public committed: CommitFilesPayload[] = [];
  public createdComments: CreateReviewCommentInput[] = [];

  constructor(private opts: MockGitHubOptions = {}) {}

  async listPullRequests(_repo: RepoRef): Promise<PrMeta[]> {
    return (
      this.opts.pulls ?? [
        {
          number: 482,
          title: 'Add rate limiting to public API endpoints',
          author: 'marisa.koch',
          branch: 'feat/rate-limit-public',
          base: 'main',
          head_sha: 'a1b2c3d4',
          additions: 247,
          deletions: 38,
          files_count: 9,
          status: 'open',
          opened_at: '2026-06-01T00:00:00Z',
          updated_at: '2026-06-01T03:00:00Z',
        },
      ]
    );
  }

  async getPullRequest(_repo: RepoRef, n: number): Promise<PrDetail> {
    const base: PrDetail = {
      number: n,
      title: 'Add rate limiting to public API endpoints',
      author: 'marisa.koch',
      branch: 'feat/rate-limit-public',
      base: 'main',
      head_sha: 'a1b2c3d4',
      additions: 247,
      deletions: 38,
      files_count: 9,
      status: 'open',
      body: 'Add rate limiting. Closes #471.',
      files: [
        {
          path: 'src/config.ts',
          additions: 4,
          deletions: 0,
          patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
        },
      ],
      commits: [
        { sha: 'a1b2c3d4', message: 'Add limiter', author: 'marisa.koch', committed_at: null },
      ],
      linked_issue: null,
    };
    return { ...base, ...this.opts.detail };
  }

  async postReview(_repo: RepoRef, n: number, review: GitHubReviewPayload): Promise<{ id: string }> {
    this.posted.push({ n, review });
    return { id: `mock-review-${n}` };
  }

  async listReviewComments(_repo: RepoRef, _n: number): Promise<PrReviewComment[]> {
    return this.opts.comments ?? [];
  }

  async createReviewComment(
    _repo: RepoRef,
    _n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    this.createdComments.push(input);
    return {
      id: this.createdComments.length,
      path: input.path,
      line: input.line,
      original_line: input.line,
      side: input.side ?? 'RIGHT',
      body: input.body,
      user: this.opts.login ?? 'mock-user',
      created_at: '2026-06-01T00:00:00Z',
      html_url: `https://github.com/mock/mock/pull/1#discussion_r${this.createdComments.length}`,
      in_reply_to_id: input.inReplyTo ?? null,
      is_outdated: false,
    };
  }

  async openPullRequest(_repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }> {
    this.openedPrs.push(payload);
    return { url: 'https://github.com/mock/mock/pull/1' };
  }

  async commitFiles(_repo: RepoRef, payload: CommitFilesPayload): Promise<{ branch: string }> {
    this.committed.push(payload);
    return { branch: payload.branch };
  }

  async findOpenPr(_repo: RepoRef, branch: string): Promise<{ url: string } | null> {
    const pr = this.openedPrs.find((p) => p.head === branch);
    return pr ? { url: 'https://github.com/mock/mock/pull/1' } : null;
  }

  async getIssue(_repo: RepoRef, n: number): Promise<IssueMeta> {
    return { number: n, title: `Issue #${n}`, body: 'mock issue', state: 'open' };
  }

  async currentLogin(): Promise<string> {
    return this.opts.login ?? 'mock-user';
  }

  async getFileContent(
    _repo: RepoRef,
    path: string,
    ref: string,
    opts: { maxBytes?: number; timeoutMs?: number } = {},
  ): Promise<{ path: string; ref: string; content: string; size: number; truncated: boolean }> {
    const fixture = this.opts.files?.[`${path}@${ref}`] ?? this.opts.files?.[path];
    if (fixture === 'never') return new Promise<never>(() => {}); // slow-fetch probe fixture
    if (!fixture || fixture === '404') throw new Error(`404: '${path}' not found at ${ref}`);
    if (fixture === 'timeout') throw new Error('timeout fetching file content');
    const size = fixture.size ?? Buffer.byteLength(fixture.content, 'utf-8');
    const maxBytes = opts.maxBytes ?? Infinity;
    if (size > maxBytes) throw new Error(`'${path}' is ${size} bytes, over the ${maxBytes}-byte cap`);
    return { path, ref, content: fixture.content, size, truncated: false };
  }

  async listClosingIssueRefs(
    _repo: RepoRef,
    n: number,
    _opts: { timeoutMs?: number } = {},
  ): Promise<{ owner: string; name: string; number: number }[]> {
    const fixture = this.opts.closingRefs?.[n];
    if (fixture === 'never') return new Promise<never>(() => {}); // slow-fetch probe fixture
    return fixture ?? [];
  }
}

// ---------- Mock Git ----------
export interface MockGitOptions {
  diff?: string;
  files?: Record<string, string>;
  /** Name-only diff result (drives the incremental indexer's "changed files since X" path). */
  diffNameOnly?: string[];
  /** Override `currentHead()` so tests can simulate "sha unchanged since last index". */
  head?: string;
  /** Head `currentHead()` returns AFTER `sync()` runs — simulates fetch+reset advancing HEAD. */
  syncedHead?: string;
}

export class MockGitClient implements GitClient {
  public cloned: { repo: RepoRef; url: string }[] = [];
  public syncs: { repo: RepoRef; branch: string }[] = [];
  private syncedHead?: string;

  constructor(private opts: MockGitOptions = {}) {}

  clonePathFor(repo: RepoRef): string {
    return `/mock/clones/${repo.owner}/${repo.name}`;
  }
  async clone(repo: RepoRef, url: string, _opts?: CloneOptions): Promise<{ path: string }> {
    this.cloned.push({ repo, url });
    return { path: this.clonePathFor(repo) };
  }
  async fetchPullHead(): Promise<void> {}
  async sync(repo: RepoRef, branch: string): Promise<{ head: string }> {
    this.syncs.push({ repo, branch });
    // After a sync, HEAD advances to syncedHead (or stays at head if unset).
    this.syncedHead = this.opts.syncedHead ?? this.opts.head ?? 'a1b2c3d4';
    return { head: this.syncedHead };
  }
  async currentHead(): Promise<string> {
    return this.syncedHead ?? this.opts.head ?? 'a1b2c3d4';
  }
  async diffNameOnly(): Promise<string[]> {
    return this.opts.diffNameOnly ?? [];
  }
  async diff(): Promise<UnifiedDiff> {
    const raw =
      this.opts.diff ??
      'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,';
    return parseUnifiedDiff(raw);
  }
  async blame(): Promise<BlameLine[]> {
    return [{ line: 1, sha: 'a1b2c3d4', author: 'marisa.koch', date: '2026-06-01', summary: 'init' }];
  }
  async log(): Promise<GitCommit[]> {
    return [{ sha: 'a1b2c3d4', message: 'init', author: 'marisa.koch', date: '2026-06-01' }];
  }
  async readFile(_repo: RepoRef, path: string): Promise<string> {
    return this.opts.files?.[path] ?? '';
  }
}

// ---------- Mock CodeIndex ----------
export class MockCodeIndex implements CodeIndex {
  async grep(_repo: RepoRef, pattern: string): Promise<CodeMatch[]> {
    return [{ path: 'src/config.ts', line: 12, text: `match for ${pattern}` }];
  }
  async symbols(): Promise<CodeSymbol[]> {
    return [{ path: 'src/middleware/ratelimit.ts', name: 'rateLimit', kind: 'function', line: 25 }];
  }
  async references(_repo: RepoRef, symbol: string): Promise<CodeReference[]> {
    return [{ fromPath: 'src/api/public/index.ts', toSymbol: symbol, line: 23 }];
  }
}

// ---------- Mock Auth / Secrets ----------
export class MockAuthProvider implements AuthProvider {
  constructor(
    private user: AuthUser = { id: 'u1', email: 'you@local', name: 'You' },
    private workspace: AuthWorkspace = { id: 'w1', name: 'default' },
  ) {}
  async currentUser(): Promise<AuthUser> {
    return this.user;
  }
  async currentWorkspace(): Promise<AuthWorkspace> {
    return this.workspace;
  }
}

export class MockSecretsProvider implements SecretsProvider {
  constructor(private secrets: Partial<Record<string, string>> = {}) {}
  async get(key: SecretKey): Promise<string | undefined> {
    return this.secrets[key as string];
  }
}

// ---------- Dependency-free glob matcher (mirrors picomatch { dot: false }) ----------
/**
 * Expands a single level of brace alternation (`{a,b,c}`), recursively, so
 * the default root `** /{specs,docs,insights}/** /*.md` (no space, written
 * here with one only to keep this comment block from closing early) becomes
 * three plain globs. Nested braces are not supported — this feature only
 * ever uses one level.
 */
function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf('{');
  if (open === -1) return [pattern];
  const close = pattern.indexOf('}', open);
  if (close === -1) return [pattern];
  const prefix = pattern.slice(0, open);
  const options = pattern.slice(open + 1, close).split(',');
  const suffixes = expandBraces(pattern.slice(close + 1));
  const out: string[] = [];
  for (const opt of options) {
    for (const suf of suffixes) out.push(prefix + opt + suf);
  }
  return out;
}

const REGEXP_SPECIAL = /[.+^${}()|[\]\\]/;
function escapeRegExpChar(ch: string): string {
  return REGEXP_SPECIAL.test(ch) ? `\\${ch}` : ch;
}

/** Converts one path-segment glob (`*`/`?`/literal, no `/`) into a RegExp. */
function segmentPatternToRegExp(segPattern: string): RegExp {
  let re = '';
  for (const ch of segPattern) {
    if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += escapeRegExpChar(ch);
  }
  return new RegExp(`^${re}$`);
}

/**
 * Segment-by-segment match of an already-brace-expanded glob against a
 * path's segments. `**` consumes zero or more whole segments. Reproduces
 * picomatch's `{ dot: false }` rule: a wildcard (`*`, `**`, `?`) never
 * matches a path segment that starts with `.` — only a pattern segment that
 * itself starts with a literal `.` may match one.
 */
function matchGlobSegments(patternSegs: string[], pathSegs: string[]): boolean {
  if (patternSegs.length === 0) return pathSegs.length === 0;
  const head: string = patternSegs[0] ?? '';
  const restPattern = patternSegs.slice(1);
  if (head === '**') {
    if (matchGlobSegments(restPattern, pathSegs)) return true;
    for (let i = 0; i < pathSegs.length; i++) {
      const consumed: string = pathSegs[i] ?? '';
      if (consumed.startsWith('.')) break; // ** never consumes a dot-segment
      if (matchGlobSegments(restPattern, pathSegs.slice(i + 1))) return true;
    }
    return false;
  }
  if (pathSegs.length === 0) return false;
  const seg: string = pathSegs[0] ?? '';
  const restPath = pathSegs.slice(1);
  if (seg.startsWith('.') && head[0] !== '.') return false; // dot:false
  if (!segmentPatternToRegExp(head).test(seg)) return false;
  return matchGlobSegments(restPattern, restPath);
}

/** Dependency-free equivalent of `picomatch(pattern, { dot: false })(relPath)`. */
function matchesGlob(pattern: string, relPath: string): boolean {
  const pathSegs = relPath.split('/');
  return expandBraces(pattern).some((expanded) =>
    matchGlobSegments(expanded.split('/'), pathSegs),
  );
}

// ---------- Mock ProjectDocsSource (Project Context) ----------
/**
 * Full in-memory `ProjectDocsSource` — no filesystem, deterministic, for
 * hermetic tests. Follows the same D6/D2 semantics as the real adapter:
 * `..`/absolute paths and paths outside `roots` are `invalid_path`; an unknown
 * path is `missing`; over `maxBytes` is `too_large`.
 */
export class MockProjectDocsSource implements ProjectDocsSource {
  private files: Map<string, { content: string; size: number; mtimeMs: number }>;
  /** When set, `list` answers `{ status: 'root_missing' }` (AC-35), ignoring `files`. */
  private rootMissing: boolean;

  constructor(files: Record<string, string> = {}, opts: { rootMissing?: boolean } = {}) {
    this.files = new Map(
      Object.entries(files).map(([path, content]) => [
        path,
        { content, size: Buffer.byteLength(content, 'utf8'), mtimeMs: 0 },
      ]),
    );
    this.rootMissing = opts.rootMissing ?? false;
  }

  matchesRoots(relPath: string, roots: string[]): boolean {
    // `dot: false` matches the real adapter (`adapters/project-docs/index.ts`)
    // — dotfiles/dot-directories (`.github/…`, `docs/.hidden.md`) never match
    // a `**` segment, same as the real `picomatch` walk. Reproduced locally
    // (`matchesGlob`, above) rather than importing `picomatch`: this file
    // must stay dependency-free (see header comment).
    return roots.some((pattern) => matchesGlob(pattern, relPath));
  }

  private isSyntacticallyInvalid(relPath: string): boolean {
    return (
      relPath.startsWith('/') ||
      /^[A-Za-z]:/.test(relPath) ||
      relPath.includes('\\') ||
      relPath.split('/').includes('..')
    );
  }

  async list(_root: string, roots: string[], maxFiles: number): Promise<ProjectDocsListResult> {
    if (this.rootMissing) return { status: 'root_missing' };
    const matched = [...this.files.entries()]
      .filter(([path]) => this.matchesRoots(path, roots))
      .sort(([a], [b]) => a.localeCompare(b));
    const truncated = matched.length > maxFiles;
    const files: ProjectDocEntry[] = matched
      .slice(0, maxFiles)
      .map(([path, f]) => ({ path, size: f.size, mtimeMs: f.mtimeMs }));
    return { status: 'ok', files, truncated };
  }

  async read(
    _root: string,
    relPath: string,
    opts: { roots: string[]; maxBytes: number },
  ): Promise<ProjectDocRead> {
    if (this.isSyntacticallyInvalid(relPath) || !this.matchesRoots(relPath, opts.roots)) {
      return { status: 'invalid_path' };
    }
    const file = this.files.get(relPath);
    if (!file) return { status: 'missing' };
    if (file.size > opts.maxBytes) return { status: 'too_large', size: file.size };
    return { status: 'ok', content: file.content, size: file.size };
  }
}
