import { describe, it, expect, vi } from 'vitest';
import { loadDiff } from '../src/modules/reviews/diff-loader.js';

/**
 * SPEC-05 — a multi-run started from Configure run can target a PR whose page was never
 * opened, so its files were never imported (only GET /pulls/:id imports them) and the
 * local clone does not have the PR head. loadDiff must then import the PR's files from
 * GitHub before giving up. Hermetic: git, GitHub and the repository are fakes.
 */

const PATCH = '@@ -1,1 +1,2 @@\n line one\n+line two';
const PULL = { id: 'pr-1', number: 17, base: 'main', headSha: 'abc123' } as never;
const REPO_ROW = { owner: 'shofulk', name: 'dev-digest' } as never;

function build(opts: { github: () => unknown }) {
  let stored: { path: string; patch: string | null }[] = [];
  const repo = {
    getPrFiles: vi.fn(async () => stored),
    replacePrFiles: vi.fn(async (_prId: string, files: { path: string; patch: string | null }[]) => {
      stored = files;
    }),
  };
  const container = {
    git: {
      diff: vi.fn(async () => {
        throw new Error('Invalid symmetric difference expression main...abc123');
      }),
    },
    github: vi.fn(async () => opts.github()),
  };
  return { repo, container };
}

describe('loadDiff', () => {
  it('AC-26: git cannot diff and no files were imported -> imports the PR files from GitHub and reviews them', async () => {
    const getPullRequest = vi.fn(async () => ({
      files: [{ path: 'src/a.ts', additions: 1, deletions: 0, patch: PATCH }],
    }));
    const { repo, container } = build({ github: () => ({ getPullRequest }) });

    const diff = await loadDiff(container as never, repo as never, 'ws', PULL, REPO_ROW);

    expect(getPullRequest).toHaveBeenCalledWith({ owner: 'shofulk', name: 'dev-digest' }, 17);
    expect(repo.replacePrFiles).toHaveBeenCalledTimes(1);
    expect(diff.files.map((f) => f.path)).toEqual(['src/a.ts']);
  });

  it('AC-28: with no GitHub access either, the run still fails with "PR diff unavailable: <git error>"', async () => {
    const { repo, container } = build({
      github: () => {
        throw new Error('no token');
      },
    });

    await expect(loadDiff(container as never, repo as never, 'ws', PULL, REPO_ROW)).rejects.toThrow(
      /^PR diff unavailable: Invalid symmetric difference expression/,
    );
    expect(repo.replacePrFiles).not.toHaveBeenCalled();
  });
});
