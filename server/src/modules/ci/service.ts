// RING 1 — application service of the CI module (`onion-architecture`). Imports only
// contract types, `platform/errors.ts` and ring-1 helpers; every collaborator arrives
// through `CiServiceDeps` (built by `deps.ts`), nothing is reached through a container.
import type { GitHubClient, RepoRef, WorkflowRunMeta } from '@devdigest/shared';
import { CiResultArtifact } from '@devdigest/shared/contracts/eval-ci';
import type {
  CiAgentCi,
  CiExport,
  CiExportInput,
  CiFile,
  CiInstallation,
  CiPreview,
  CiPreviewInput,
  CiRefreshResult,
  CiRun,
  CiRunsList,
  CiTrigger,
  CiVerdict,
} from '@devdigest/shared/contracts/eval-ci';
import { AppError, ConfigError, GitHubAccessError, NotFoundError } from '../../platform/errors.js';
import {
  CI_BRANCH,
  CI_PR_TITLE,
  GITHUB_PERMISSIONS,
  MEMORY_PATH,
  RUNNER_PATH,
  WORKFLOW_PATH,
  buildManifest,
  buildMemoryJsonl,
  buildPrBody,
  buildWorkflow,
  manifestPath,
  skillKey,
  skillPath,
  artifactPrNumber,
  clampAgentResult,
  validateWorkflowYaml,
  type ManifestAgent,
} from './helpers.js';
import type { CiRunListRow, UpsertInstallation, WriteCiRun } from './repository.js';

export interface CiRepoInfo {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
}

export interface CiInstallationRecord {
  id: string;
  agentId: string;
  repo: string;
  targetType: 'gha' | 'circle' | 'jenkins' | 'cli';
  installedAt: Date;
  status: 'pr_open' | 'manual' | 'active';
  installedAgentVersion: number;
  prUrl: string | null;
  triggers: string[];
  postAs: 'github_review' | 'pr_comment' | 'none';
}

export interface CiServiceDeps {
  getAgent(workspaceId: string, agentId: string): Promise<Omit<ManifestAgent, 'postAs'> | null>;
  getRepoById(workspaceId: string, repoId: string): Promise<CiRepoInfo | null>;
  getRepoByFullName(workspaceId: string, fullName: string): Promise<CiRepoInfo | null>;
  /** The agent's included skills, in link order. */
  listSkills(agentId: string): Promise<{ id: string; name: string; body: string }[]>;
  repoMemory(workspaceId: string, repoId: string): Promise<{ kind: string; content: string }[]>;
  readRunner(): Promise<{ contents: string; sizeBytes: number } | null>;
  /** Throws `ConfigError` when no GitHub token is configured. */
  github: () => Promise<GitHubClient>;
  upsertInstallation(v: UpsertInstallation): Promise<CiInstallationRecord>;
  listAgentInstallations(
    agentId: string,
  ): Promise<(CiInstallationRecord & { lastRun: { verdict: CiVerdict; ranAt: Date } | null })[]>;
  /** Installations of the workspace whose repository is still a workspace repository. */
  listWorkspaceInstallations(workspaceId: string): Promise<CiInstallationRecord[]>;
  listRuns(workspaceId: string, agentId: string | null, limit: number): Promise<CiRunListRow[]>;
  /** Ids of those installations that already store the GitHub run. */
  storedInstallations(githubRunId: number, installationIds: string[]): Promise<string[]>;
  /** One transaction: `agent_runs` + `ci_runs` + installation `active`. False when already stored. */
  writeCiRun(v: WriteCiRun): Promise<boolean>;
}

const WORKFLOW_FILE = 'devdigest-review.yml';
const RESULT_ARTIFACT = 'devdigest-result';
const RESULT_ENTRY = 'devdigest-result.json';
const MAX_ARTIFACT_BYTES = 1_048_576;
const WINDOW_DAYS = 30;
const RUNS_PER_REPO = 100;
const AGENT_RUNS_LIMIT = 20;
const WORKSPACE_RUNS_LIMIT = 100;

const byteLength = (s: string): number => new TextEncoder().encode(s).length;
const file = (path: string, contents: string, editable = false): CiFile => ({
  path,
  contents,
  editable,
  size_bytes: byteLength(contents),
});

export class CiService {
  constructor(private readonly deps: CiServiceDeps) {}

  async agentCi(workspaceId: string, agentId: string): Promise<CiAgentCi> {
    await this.requireAgent(workspaceId, agentId);
    const [installations, runs] = await Promise.all([
      this.deps.listAgentInstallations(agentId),
      this.deps.listRuns(workspaceId, agentId, AGENT_RUNS_LIMIT),
    ]);
    return {
      installations: installations.map((i) =>
        toInstallation(
          i,
          i.lastRun ? { verdict: i.lastRun.verdict, ran_at: i.lastRun.ranAt.toISOString() } : null,
        ),
      ),
      runs: runs.map(toCiRun),
    };
  }

  async preview(workspaceId: string, agentId: string, input: CiPreviewInput): Promise<CiPreview> {
    const agent = await this.requireAgent(workspaceId, agentId);
    const repo = await this.deps.getRepoById(workspaceId, input.repo_id);
    if (!repo) throw new NotFoundError('Repository not found');
    const files = await this.bundle(workspaceId, agent, repo, input.triggers, input.post_as, null);
    return { files: files.map(withoutRunner) };
  }

  async exportCi(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiExport> {
    const agent = await this.requireAgent(workspaceId, agentId);
    const repo = await this.deps.getRepoByFullName(workspaceId, input.repo);
    if (!repo) throw new NotFoundError('Repository not found');
    if (input.workflow != null) {
      const check = validateWorkflowYaml(input.workflow);
      if (!check.ok) {
        throw new AppError(
          'invalid_workflow',
          `The workflow is not valid YAML (line ${check.line})`,
          422,
          { line: check.line },
        );
      }
    }
    const files = await this.bundle(workspaceId, agent, repo, input.triggers, input.post_as, input.workflow ?? null);

    let prUrl: string | null = null;
    if (input.action === 'open_pr') prUrl = await this.openPr(repo, files);

    const row = await this.deps.upsertInstallation({
      agentId,
      repo: repo.fullName,
      status: input.action === 'open_pr' ? 'pr_open' : 'manual',
      agentVersion: agent.version,
      triggers: input.triggers,
      postAs: input.post_as,
      ...(prUrl ? { prUrl } : {}),
    });
    return {
      installation: toInstallation(row),
      files: input.action === 'open_pr' ? files.map(withoutRunner) : files,
      pr_url: prUrl,
    };
  }

  async listRuns(workspaceId: string): Promise<CiRunsList> {
    const runs = await this.deps.listRuns(workspaceId, null, WORKSPACE_RUNS_LIMIT);
    return { items: runs.map(toCiRun) };
  }

  /** Pull finished CI runs back from GitHub into `agent_runs` + `ci_runs`. */
  async refresh(workspaceId: string): Promise<CiRefreshResult> {
    const installations = await this.deps.listWorkspaceInstallations(workspaceId);
    const byRepo = new Map<string, CiInstallationRecord[]>();
    for (const i of installations) byRepo.set(i.repo, [...(byRepo.get(i.repo) ?? []), i]);

    const out: CiRefreshResult = { stored: 0, skipped: 0, degraded: [] };
    if (byRepo.size === 0) return out;

    let gh: GitHubClient;
    try {
      gh = await this.deps.github();
    } catch (err) {
      if (!(err instanceof ConfigError)) throw err;
      out.degraded = [...byRepo.keys()].map((repo) => ({ repo, reason: 'github_not_configured' }));
      return out;
    }

    const createdSince = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
    for (const [repo, installs] of byRepo) {
      const [owner = '', name = ''] = repo.split('/');
      const ref: RepoRef = { owner, name };
      let runs: WorkflowRunMeta[];
      try {
        runs = await gh.listWorkflowRuns(ref, WORKFLOW_FILE, { createdSince, perPage: RUNS_PER_REPO });
      } catch {
        out.degraded.push({ repo, reason: 'github_error' });
        continue;
      }
      for (const run of runs) {
        if (run.headRepoFullName !== repo) continue;
        const stored = await this.deps.storedInstallations(run.id, installs.map((i) => i.id));
        if (installs.every((i) => stored.includes(i.id))) continue;
        const artifact = await this.readArtifact(gh, ref, run.id);
        if (!artifact) {
          out.skipped++;
          continue;
        }
        for (const raw of artifact.results) {
          const inst = installs.find((i) => i.agentId === raw.agent_id);
          if (!inst) continue;
          const r = clampAgentResult(raw);
          const ok = await this.deps.writeCiRun({
            workspaceId,
            installationId: inst.id,
            agentId: inst.agentId,
            githubRunId: run.id,
            prNumber: run.prNumber ?? artifactPrNumber(artifact.pr_number),
            githubUrl: run.htmlUrl.startsWith('https://github.com/') ? run.htmlUrl : null,
            ranAt: new Date(run.createdAt),
            verdict: r.verdict,
            model: r.model,
            status: r.verdict === 'failed' ? 'failed' : 'done',
            error: r.error_code,
            durationMs: r.duration_ms,
            costUsd: r.cost_usd,
            findingsCount: r.findings_count,
            blockers: r.blockers,
          });
          if (ok) out.stored++;
        }
      }
    }
    return out;
  }

  /** The parsed `devdigest-result` artifact of a run, or null when it is missing or invalid. */
  private async readArtifact(gh: GitHubClient, ref: RepoRef, runId: number): Promise<CiResultArtifact | null> {
    let read: Awaited<ReturnType<GitHubClient['downloadRunArtifact']>>;
    try {
      read = await gh.downloadRunArtifact(ref, runId, {
        name: RESULT_ARTIFACT,
        entry: RESULT_ENTRY,
        maxBytes: MAX_ARTIFACT_BYTES,
      });
    } catch {
      return null;
    }
    if (read.status !== 'ok') return null;
    try {
      const parsed = CiResultArtifact.safeParse(JSON.parse(read.text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async requireAgent(workspaceId: string, agentId: string) {
    const agent = await this.deps.getAgent(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }

  /** The five-kind bundle with full contents, in order: manifest, skills, memory, runner, workflow. */
  private async bundle(
    workspaceId: string,
    agent: Omit<ManifestAgent, 'postAs'>,
    repo: CiRepoInfo,
    triggers: CiTrigger[],
    postAs: ManifestAgent['postAs'],
    workflow: string | null,
  ): Promise<CiFile[]> {
    const runner = await this.deps.readRunner();
    if (!runner) {
      throw new ConfigError('The CI runner is not built. Run `pnpm --dir ci build` and try again.');
    }
    const skills = await this.deps.listSkills(agent.id);
    const memory = await this.deps.repoMemory(workspaceId, repo.id);
    return [
      file(manifestPath(agent), buildManifest({ ...agent, postAs }, skills.map(skillKey))),
      ...skills.map((s) => file(skillPath(s), s.body)),
      file(MEMORY_PATH, buildMemoryJsonl(memory)),
      file(RUNNER_PATH, runner.contents),
      file(WORKFLOW_PATH, workflow ?? buildWorkflow(triggers), true),
    ];
  }

  /** Commit the bundle to `devdigest/ci` and return the URL of its (new or existing) pull request. */
  private async openPr(repo: CiRepoInfo, files: CiFile[]): Promise<string> {
    let gh: GitHubClient;
    try {
      gh = await this.deps.github();
    } catch (err) {
      if (err instanceof ConfigError) {
        throw new AppError('github_not_configured', 'No GitHub token is configured', 409);
      }
      throw err;
    }
    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    try {
      const existing = await gh.findOpenPr(ref, CI_BRANCH);
      if (!existing) await gh.resetBranch(ref, CI_BRANCH, repo.defaultBranch);
      await gh.commitFiles(ref, {
        branch: CI_BRANCH,
        base: repo.defaultBranch,
        message: 'Add DevDigest CI review',
        files: files.map((f) => ({ path: f.path, contents: f.contents ?? '' })),
      });
      if (existing) return existing.url;
      const pr = await gh.openPullRequest(ref, {
        title: CI_PR_TITLE,
        head: CI_BRANCH,
        base: repo.defaultBranch,
        body: buildPrBody(files.map((f) => f.path)),
      });
      return pr.url;
    } catch (err) {
      if (err instanceof GitHubAccessError) {
        throw new AppError(
          'github_permission',
          `GitHub refused the write. The token needs: ${GITHUB_PERMISSIONS.join('; ')}.`,
          403,
          { permissions: GITHUB_PERMISSIONS },
        );
      }
      if (err instanceof AppError) throw err;
      throw new AppError('github_error', err instanceof Error ? err.message : 'GitHub request failed', 502);
    }
  }
}

function withoutRunner(f: CiFile): CiFile {
  return f.path === RUNNER_PATH ? { ...f, contents: null } : f;
}

function toCiRun(r: CiRunListRow): CiRun {
  return {
    id: r.id,
    repo: r.repo,
    pr_number: r.prNumber,
    pr_url: r.prNumber == null ? null : `https://github.com/${r.repo}/pull/${r.prNumber}`,
    agent_id: r.agentId,
    agent_name: r.agentName ?? '',
    verdict: r.verdict,
    findings_count: r.findingsCount ?? 0,
    cost_usd: r.costUsd,
    duration_ms: r.durationMs,
    github_url: r.githubUrl,
    ran_at: r.ranAt.toISOString(),
  };
}

function toInstallation(r: CiInstallationRecord, lastRun: CiInstallation['last_run'] = null): CiInstallation {
  return {
    id: r.id,
    agent_id: r.agentId,
    repo: r.repo,
    target_type: r.targetType,
    installed_at: r.installedAt.toISOString(),
    status: r.status,
    installed_agent_version: r.installedAgentVersion,
    pr_url: r.prUrl,
    triggers: r.triggers as CiTrigger[],
    post_as: r.postAs,
    last_run: lastRun,
  };
}
