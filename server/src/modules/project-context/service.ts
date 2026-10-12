// RING 1 — application service. Every dependency is resolved ONCE in the
// constructor (`onion-architecture`) — no `container` field kept, and no
// `new ProjectContextRepository()` here: the repository is built in
// `platform/container.ts`.
import type { Container } from '../../platform/container.js';
import type {
  ContextDocList,
  ContextDocContent,
  ContextDocsUpdate,
  IndexStatus,
  ProjectDocEntry,
  ProjectDocsSource,
  SpecFile,
} from '@devdigest/shared';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { checkDocPathSyntax, docTypeFor } from '../_shared/project-context/helpers.js';
import { countUsedBy, type AgentDocUsage } from '../_shared/project-context/resolve.js';
import { MAX_CONTEXT_DOCS } from './constants.js';

interface ScanResult {
  files: ProjectDocEntry[];
  truncated: boolean;
  scannedAt: string;
}

/**
 * Project Context use cases: scan a repo's checkout for `.md` documents, read
 * one, reindex, and save an agent's/skill's attached-document list.
 *
 * D8 scan cache: `scanCache` holds the last scan per repo (served by `GET`
 * until `reindex` runs); `tokenCache` holds per-document token counts keyed
 * `path|size|mtimeMs` so a rescan does not re-tokenize unchanged files. The
 * file route and run resolution (elsewhere) always read fresh content.
 */
export class ProjectContextService {
  private reposRepo: Container['reposRepo'];
  private agentsRepo: Container['agentsRepo'];
  private repo: Container['projectContextRepo'];
  private projectDocs: ProjectDocsSource;
  private tokenizer: Tokenizer;
  private config: Container['config']['projectContext'];
  private agentSkills: Container['agentSkills'];

  private scanCache = new Map<string, ScanResult>();
  private tokenCache = new Map<string, number | null>();

  constructor(container: Container) {
    this.reposRepo = container.reposRepo;
    this.agentsRepo = container.agentsRepo;
    this.repo = container.projectContextRepo;
    this.projectDocs = container.projectDocs;
    this.tokenizer = container.tokenizer;
    this.config = container.config.projectContext;
    this.agentSkills = container.agentSkills;
  }

  async getContext(workspaceId: string, repoId: string): Promise<ContextDocList> {
    const repoRow = await this.reposRepo.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('repo not found');
    this.assertSynced(repoRow.clonePath);

    let scan = this.scanCache.get(repoId);
    if (!scan) {
      scan = await this.scan(repoRow.clonePath!);
      this.scanCache.set(repoId, scan);
    }

    const usage = await this.docUsage(workspaceId);
    const files: SpecFile[] = [];
    let totalTokens = 0;
    for (const entry of scan.files) {
      const tokens = await this.tokensFor(repoRow.clonePath!, entry);
      totalTokens += tokens ?? 0;
      files.push({
        path: entry.path,
        size: entry.size,
        type: docTypeFor(entry.path),
        tokens,
        used_by: countUsedBy([entry.path], usage),
      });
    }

    return {
      files,
      roots: this.config.roots,
      count: files.length,
      total_tokens: totalTokens,
      scanned_at: scan.scannedAt,
      truncated: scan.truncated,
    };
  }

  async getFile(workspaceId: string, repoId: string, path: string): Promise<ContextDocContent> {
    if (!checkDocPathSyntax(path)) throw new AppError('invalid_path', 'invalid path', 400);

    const repoRow = await this.reposRepo.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('repo not found');
    this.assertSynced(repoRow.clonePath);

    if (!this.projectDocs.matchesRoots(path, this.config.roots)) {
      throw new AppError('invalid_path', 'invalid path', 400);
    }

    const result = await this.projectDocs.read(repoRow.clonePath!, path, {
      roots: this.config.roots,
      maxBytes: this.config.maxDocBytes,
    });
    if (result.status === 'invalid_path') {
      throw new AppError('invalid_path', 'invalid path', 400);
    }
    if (result.status !== 'ok') {
      throw new NotFoundError('document not found');
    }
    return { path, content: result.content, tokens: this.tokenizer.count(result.content) };
  }

  async reindex(workspaceId: string, repoId: string): Promise<IndexStatus> {
    const repoRow = await this.reposRepo.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('repo not found');
    this.assertSynced(repoRow.clonePath);

    try {
      const scan = await this.scan(repoRow.clonePath!);
      this.scanCache.set(repoId, scan);
      return { status: 'done', pct: 100, chunks_indexed: null };
    } catch (err) {
      return { status: 'error', pct: 0, message: (err as Error).message, chunks_indexed: null };
    }
  }

  async setAgentContextDocs(
    workspaceId: string,
    agentId: string,
    paths: string[],
  ): Promise<ContextDocsUpdate> {
    this.validatePaths(paths);
    const saved = await this.repo.setAgentContextDocs(workspaceId, agentId, paths);
    if (saved === undefined) throw new NotFoundError('agent not found');
    return { context_docs: saved };
  }

  async setSkillContextDocs(
    workspaceId: string,
    skillId: string,
    paths: string[],
  ): Promise<ContextDocsUpdate> {
    this.validatePaths(paths);
    const saved = await this.repo.setSkillContextDocs(workspaceId, skillId, paths);
    if (saved === undefined) throw new NotFoundError('skill not found');
    return { context_docs: saved };
  }

  /** "No checkout" (D5): `clone_path` is null. */
  private assertSynced(clonePath: string | null): void {
    if (!clonePath) {
      throw new AppError('repository_not_synced', 'repository not synced', 409);
    }
  }

  private validatePaths(paths: string[]): void {
    for (const path of paths) {
      if (!checkDocPathSyntax(path) || !this.projectDocs.matchesRoots(path, this.config.roots)) {
        throw new AppError('invalid_path', `invalid path: ${path}`, 400);
      }
    }
  }

  private async scan(root: string): Promise<ScanResult> {
    const result = await this.projectDocs.list(root, this.config.roots, MAX_CONTEXT_DOCS);
    if (result.status === 'root_missing') {
      throw new AppError('repository_not_synced', 'repository not synced', 409);
    }
    return { files: result.files, truncated: result.truncated, scannedAt: new Date().toISOString() };
  }

  private async tokensFor(root: string, entry: ProjectDocEntry): Promise<number | null> {
    const key = `${entry.path}|${entry.size}|${entry.mtimeMs}`;
    const cached = this.tokenCache.get(key);
    if (cached !== undefined) return cached;
    const result = await this.projectDocs.read(root, entry.path, {
      roots: this.config.roots,
      maxBytes: this.config.maxDocBytes,
    });
    const tokens = result.status === 'ok' ? this.tokenizer.count(result.content) : null;
    this.tokenCache.set(key, tokens);
    return tokens;
  }

  /**
   * Every workspace agent's resolved set of attached paths (direct +
   * enabled-skill), for `countUsedBy`. One batched skill-set query for every
   * agent instead of one per agent (the N+1 this used to run on every GET).
   */
  private async docUsage(workspaceId: string): Promise<AgentDocUsage[]> {
    const agents = await this.agentsRepo.list(workspaceId);
    const skillSets = await this.agentSkills.resolveAgentSkillSets(agents.map((a) => a.id));
    return agents.map((agent) => {
      const docSources = skillSets.get(agent.id)?.docSources ?? [];
      const skillPaths = docSources.flatMap((s) => s.contextDocs);
      return { agentId: agent.id, paths: [...(agent.contextDocs ?? []), ...skillPaths] };
    });
  }
}
