import type { Container } from '../../platform/container.js';
import type { UnifiedDiff } from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import * as schema from '../../db/schema.js';
import type { ReviewRepository, PullRow } from './repository.js';

/**
 * Load the unified diff for a PR. Prefers a real `git diff base...head`; falls
 * back to assembling a synthetic unified diff from the persisted pr_files
 * patches (so the reviewer works even before a clone completes / in tests).
 * The PR's files are imported only when its page is opened (GET /pulls/:id), and a
 * multi-run can start from Configure run on a PR nobody opened: when git fails and
 * nothing was imported, import the files from GitHub first. When that fails too,
 * the diff is genuinely unavailable: throw `PR diff unavailable: <git error>` so
 * every queued run fails with that one reason, instead of reviewing an empty diff.
 */
export async function loadDiff(
  container: Container,
  repo: ReviewRepository,
  workspaceId: string,
  pull: PullRow,
  repoRow: typeof schema.repos.$inferSelect,
): Promise<UnifiedDiff> {
  let gitError: Error | undefined;
  try {
    const diff = await container.git.diff(
      { owner: repoRow.owner, name: repoRow.name },
      pull.base,
      pull.headSha,
    );
    if (diff.files.length > 0) return diff;
  } catch (err) {
    gitError = err instanceof Error ? err : new Error(String(err));
    /* fall through to pr_files reconstruction */
  }
  let fallback = await diffFromPrFiles(repo, pull.id);
  if (gitError && fallback.files.length === 0) {
    try {
      const gh = await container.github();
      const detail = await gh.getPullRequest({ owner: repoRow.owner, name: repoRow.name }, pull.number);
      await repo.replacePrFiles(
        pull.id,
        detail.files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions, patch: f.patch ?? null })),
      );
      fallback = await diffFromPrFiles(repo, pull.id);
    } catch {
      /* no token / offline: keep the git error as the reason */
    }
  }
  if (gitError && fallback.files.length === 0) {
    throw new Error(`PR diff unavailable: ${gitError.message}`);
  }
  return fallback;
}

/** Reconstruct a UnifiedDiff from persisted pr_files patches. */
export async function diffFromPrFiles(repo: ReviewRepository, prId: string): Promise<UnifiedDiff> {
  const files = await repo.getPrFiles(prId);
  const parts: string[] = [];
  for (const f of files) {
    if (!f.patch) continue;
    parts.push(`diff --git a/${f.path} b/${f.path}`);
    parts.push(`--- a/${f.path}`);
    parts.push(`+++ b/${f.path}`);
    parts.push(f.patch);
  }
  return parseUnifiedDiff(parts.join('\n'));
}
