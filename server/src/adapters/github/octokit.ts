import { Octokit } from 'octokit';
import type {
  GitHubClient,
  RepoRef,
  PrMeta,
  PrDetail,
  PrStatus,
  GitHubReviewPayload,
  CreateReviewCommentInput,
  PrReviewComment,
  OpenPrPayload,
  CommitFilesPayload,
  IssueMeta,
  WorkflowRunMeta,
  ArtifactRead,
} from '@devdigest/shared';
import { unzipSync } from 'fflate';
import { withRetry, withTimeout } from '../../platform/resilience.js';
import { GitHubAccessError } from '../../platform/errors.js';

const TIMEOUT = 30_000;

function mapStatus(state: string, merged: boolean | undefined): PrStatus {
  if (merged) return 'merged';
  if (state === 'closed') return 'closed';
  return 'open';
}

/**
 * A 403/404 from a write call means the token lacks a permission (GitHub answers 404 for a
 * repo it hides). Anything else is returned unchanged for the caller to throw.
 */
export function toGitHubError(err: unknown): unknown {
  const status = (err as { status?: number } | null)?.status;
  if (status === 403 || status === 404) {
    return new GitHubAccessError(err instanceof Error ? err.message : `GitHub answered ${status}`);
  }
  return err;
}

/**
 * Read one entry out of an Actions artifact zip. The cap is checked on the compressed bytes,
 * and an entry whose declared size is over the cap is filtered out before it is inflated.
 */
export function readResultFromZip(bytes: Uint8Array, entry: string, maxBytes: number): ArtifactRead {
  if (bytes.byteLength > maxBytes) return { status: 'too_large' };
  try {
    const files = unzipSync(bytes, {
      filter: (f) => f.name === entry && f.originalSize <= maxBytes,
    });
    const data = files[entry];
    if (!data) return { status: 'invalid' };
    return { status: 'ok', text: new TextDecoder().decode(data) };
  } catch {
    return { status: 'invalid' };
  }
}

/**
 * GitHubClient over Octokit REST — thin. PAT auth (fine-grained).
 * Reads PR list/detail/files/commits/issue; posts reviews; opens PRs.
 */
export class OctokitGitHubClient implements GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          // Fetch open + recently merged/closed (most-recently-updated first) so
          // the list shows which PRs are merged vs still open — not just open.
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'all',
            sort: 'updated',
            direction: 'desc',
            per_page: 50,
          });
          return res.data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: 0,
            deletions: 0,
            files_count: 0, // not present on the list payload; populated by getPullRequest
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  async getPullRequest(repo: RepoRef, n: number): Promise<PrDetail> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const { data: pr } = await this.octokit.rest.pulls.get({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
          });
          const { data: files } = await this.octokit.rest.pulls.listFiles({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const { data: commits } = await this.octokit.rest.pulls.listCommits({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const linkedIssue = await this.resolveLinkedIssue(repo, pr.body ?? '');
          return {
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: pr.additions,
            deletions: pr.deletions,
            files_count: pr.changed_files,
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
            body: pr.body,
            files: files.map((f) => ({
              path: f.filename,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch,
            })),
            commits: commits.map((c) => ({
              sha: c.sha,
              message: c.commit.message,
              author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
              committed_at: c.commit.author?.date,
            })),
            linked_issue: linkedIssue,
          };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** linked issue via regex on PR body (#123 / closes #123). */
  private async resolveLinkedIssue(repo: RepoRef, body: string): Promise<IssueMeta | undefined> {
    const m = body.match(/(?:closes|fixes|resolves)?\s*#(\d+)/i);
    if (!m?.[1]) return undefined;
    try {
      return await this.getIssue(repo, Number(m[1]));
    } catch {
      return undefined;
    }
  }

  async postReview(
    repo: RepoRef,
    n: number,
    review: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.createReview({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            body: review.body,
            event: review.event,
            comments: review.comments?.map((c) => ({
              path: c.path,
              line: c.line,
              body: c.body,
            })),
          });
          return { id: String(res.data.id) };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** Shape an Octokit review-comment payload into our DTO. */
  private mapReviewComment(c: {
    id: number;
    path: string;
    line?: number | null;
    original_line?: number | null;
    side?: string | null;
    body: string;
    user: { login: string } | null;
    created_at: string;
    html_url: string;
    in_reply_to_id?: number;
  }): PrReviewComment {
    return {
      id: c.id,
      path: c.path,
      line: c.line ?? null,
      original_line: c.original_line ?? null,
      side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      body: c.body,
      user: c.user?.login ?? 'unknown',
      created_at: c.created_at,
      html_url: c.html_url,
      in_reply_to_id: c.in_reply_to_id ?? null,
      // GitHub drops `line` when the comment can no longer be placed on the diff.
      is_outdated: c.line == null,
    };
  }

  async listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.listReviewComments({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          return res.data.map((c) => this.mapReviewComment(c));
        })(),
        TIMEOUT,
      ),
    );
  }

  async createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          if (input.inReplyTo != null) {
            const res = await this.octokit.rest.pulls.createReplyForReviewComment({
              owner: repo.owner,
              repo: repo.name,
              pull_number: n,
              comment_id: input.inReplyTo,
              body: input.body,
            });
            return this.mapReviewComment(res.data);
          }
          const res = await this.octokit.rest.pulls.createReviewComment({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            commit_id: input.commitId,
            path: input.path,
            line: input.line,
            side: input.side ?? 'RIGHT',
            body: input.body,
          });
          return this.mapReviewComment(res.data);
        })(),
        TIMEOUT,
      ),
    );
  }

  async openPullRequest(repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }> {
    return this.guarded(() =>
      withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.create({
            owner: repo.owner,
            repo: repo.name,
            title: payload.title,
            head: payload.head,
            base: payload.base,
            body: payload.body,
          });
          return { url: res.data.html_url };
        })(),
        TIMEOUT,
      ),
      ),
    );
  }

  async commitFiles(
    repo: RepoRef,
    payload: CommitFilesPayload,
  ): Promise<{ branch: string }> {
    return this.guarded(() =>
      withRetry(() =>
      withTimeout(
        (async () => {
          const owner = repo.owner;
          const name = repo.name;
          const g = this.octokit.rest.git;

          // Parent commit: the target branch if it already exists, else the base.
          let parentSha: string;
          let branchExists = false;
          try {
            const ref = await g.getRef({ owner, repo: name, ref: `heads/${payload.branch}` });
            parentSha = ref.data.object.sha;
            branchExists = true;
          } catch {
            const baseRef = await g.getRef({ owner, repo: name, ref: `heads/${payload.base}` });
            parentSha = baseRef.data.object.sha;
          }

          // New tree layered on the parent's tree (so unrelated files are kept).
          const parentCommit = await g.getCommit({ owner, repo: name, commit_sha: parentSha });
          const tree = await g.createTree({
            owner,
            repo: name,
            base_tree: parentCommit.data.tree.sha,
            tree: payload.files.map((f) => ({
              path: f.path,
              mode: '100644',
              type: 'blob',
              content: f.contents,
            })),
          });

          const commit = await g.createCommit({
            owner,
            repo: name,
            message: payload.message,
            tree: tree.data.sha,
            parents: [parentSha],
          });

          if (branchExists) {
            await g.updateRef({
              owner,
              repo: name,
              ref: `heads/${payload.branch}`,
              sha: commit.data.sha,
              force: true,
            });
          } else {
            await g.createRef({
              owner,
              repo: name,
              ref: `refs/heads/${payload.branch}`,
              sha: commit.data.sha,
            });
          }
          return { branch: payload.branch };
        })(),
        TIMEOUT,
      ),
      ),
    );
  }

  async findOpenPr(repo: RepoRef, branch: string): Promise<{ url: string } | null> {
    return this.guarded(() =>
      withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'open',
            head: `${repo.owner}:${branch}`,
            per_page: 1,
          });
          const pr = res.data[0];
          return pr ? { url: pr.html_url } : null;
        })(),
        TIMEOUT,
      ),
      ),
    );
  }

  async resetBranch(repo: RepoRef, branch: string, toBranch: string): Promise<{ sha: string }> {
    return this.guarded(() =>
      withRetry(() =>
        withTimeout(
          (async () => {
            const g = this.octokit.rest.git;
            const { data: base } = await g.getRef({
              owner: repo.owner,
              repo: repo.name,
              ref: `heads/${toBranch}`,
            });
            const sha = base.object.sha;
            try {
              await g.updateRef({
                owner: repo.owner,
                repo: repo.name,
                ref: `heads/${branch}`,
                sha,
                force: true,
              });
            } catch (err) {
              if ((err as { status?: number }).status !== 422 && (err as { status?: number }).status !== 404) throw err;
              await g.createRef({
                owner: repo.owner,
                repo: repo.name,
                ref: `refs/heads/${branch}`,
                sha,
              });
            }
            return { sha };
          })(),
          TIMEOUT,
        ),
      ),
    );
  }

  async listWorkflowRuns(
    repo: RepoRef,
    workflowFile: string,
    opts: { createdSince: string; perPage: number },
  ): Promise<WorkflowRunMeta[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.actions.listWorkflowRuns({
            owner: repo.owner,
            repo: repo.name,
            workflow_id: workflowFile,
            status: 'completed',
            created: `>=${opts.createdSince}`,
            per_page: opts.perPage,
          });
          return res.data.workflow_runs.map((r) => ({
            id: r.id,
            htmlUrl: r.html_url,
            headRepoFullName: r.head_repository?.full_name ?? null,
            prNumber: r.pull_requests?.[0]?.number ?? null,
            createdAt: r.created_at,
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  async downloadRunArtifact(
    repo: RepoRef,
    runId: number,
    opts: { name: string; entry: string; maxBytes: number },
  ): Promise<ArtifactRead> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const list = await this.octokit.rest.actions.listWorkflowRunArtifacts({
            owner: repo.owner,
            repo: repo.name,
            run_id: runId,
            per_page: 100,
          });
          const art = list.data.artifacts.find((a) => a.name === opts.name);
          if (!art || art.expired) return { status: 'missing' as const };
          if (art.size_in_bytes > opts.maxBytes) return { status: 'too_large' as const };
          const dl = await this.octokit.rest.actions.downloadArtifact({
            owner: repo.owner,
            repo: repo.name,
            artifact_id: art.id,
            archive_format: 'zip',
          });
          return readResultFromZip(new Uint8Array(dl.data as ArrayBuffer), opts.entry, opts.maxBytes);
        })(),
        TIMEOUT,
      ),
    );
  }

  /** Run a GitHub write and turn a 403/404 into `GitHubAccessError` (after retries). */
  private async guarded<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw toGitHubError(err);
    }
  }

  async getIssue(repo: RepoRef, n: number): Promise<IssueMeta> {
    const res = await withRetry(() =>
      withTimeout(
        this.octokit.rest.issues.get({ owner: repo.owner, repo: repo.name, issue_number: n }),
        TIMEOUT,
      ),
    );
    return {
      number: res.data.number,
      title: res.data.title,
      body: res.data.body,
      state: res.data.state,
    };
  }

  async currentLogin(): Promise<string> {
    const res = await withRetry(() =>
      withTimeout(this.octokit.rest.users.getAuthenticated(), TIMEOUT),
    );
    return res.data.login;
  }

  /**
   * Fetch a text file at `ref` via the Contents API. Size is checked from the
   * metadata BEFORE decoding (never decode-then-check) so an oversized file
   * never touches memory as a giant string. Only a `type: 'file'` entry is
   * accepted — a directory/symlink/submodule throws, mapped by the caller to
   * `not_fetched: unsupported`.
   */
  async getFileContent(
    repo: RepoRef,
    path: string,
    ref: string,
    opts: { maxBytes?: number; timeoutMs?: number } = {},
  ): Promise<{ path: string; ref: string; content: string; size: number; truncated: boolean }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.repos.getContent({
            owner: repo.owner,
            repo: repo.name,
            path,
            ref,
          });
          const data = res.data;
          if (Array.isArray(data) || data.type !== 'file') {
            throw new Error(`'${path}' is not a file at ${ref}`);
          }
          const maxBytes = opts.maxBytes ?? Infinity;
          if (data.size > maxBytes) {
            throw new Error(`'${path}' is ${data.size} bytes, over the ${maxBytes}-byte cap`);
          }
          const content = data.content
            ? Buffer.from(data.content, 'base64').toString('utf-8')
            : '';
          return { path, ref, content, size: data.size, truncated: false };
        })(),
        opts.timeoutMs ?? TIMEOUT,
      ),
    );
  }

  /**
   * Issues this PR would close (GraphQL `closingIssuesReferences`) — unioned
   * upstream with a body-regex scan, since GitHub only recognises closing
   * keywords for issues in the SAME repo.
   */
  async listClosingIssueRefs(
    repo: RepoRef,
    n: number,
    opts: { timeoutMs?: number } = {},
  ): Promise<{ owner: string; name: string; number: number }[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.graphql<{
            repository: {
              pullRequest: {
                closingIssuesReferences: {
                  nodes: { number: number; repository: { owner: { login: string }; name: string } }[];
                };
              } | null;
            } | null;
          }>(
            `query($owner: String!, $name: String!, $n: Int!) {
              repository(owner: $owner, name: $name) {
                pullRequest(number: $n) {
                  closingIssuesReferences(first: 10) {
                    nodes { number repository { owner { login } name } }
                  }
                }
              }
            }`,
            { owner: repo.owner, name: repo.name, n },
          );
          const nodes = res.repository?.pullRequest?.closingIssuesReferences.nodes ?? [];
          return nodes.map((node) => ({
            owner: node.repository.owner.login,
            name: node.repository.name,
            number: node.number,
          }));
        })(),
        opts.timeoutMs ?? TIMEOUT,
      ),
    );
  }
}
