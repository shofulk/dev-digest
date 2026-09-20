import { randomUUID } from 'node:crypto';
import type { RepoRef } from '@devdigest/shared';
import type {
  ConventionCandidate,
  ConventionExtractResult,
  ConventionSkillDraft,
  ConventionStatus,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { resolveUsableFeatureModel } from '../_shared/feature-models.js';
import { ConventionsRepository } from './repository.js';
import {
  buildSkillDraft,
  dedupeCandidates,
  renderSamples,
  ruleKey,
  toCandidateDto,
  toSampledFile,
  verifyCandidate,
  type DropReason,
  type SampledFile,
  type VerifiedCandidate,
} from './helpers.js';
import { ExtractionSchema, SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import {
  CONFIG_SAMPLE_PATHS,
  EXTRACT_MAX_TOKENS,
  EXTRACT_TEMPERATURE,
  EXTRACT_TIMEOUT_MS,
  MAX_SAMPLE_CHARS,
  TOP_CODE_SAMPLES,
} from './constants.js';

/** Structural subset of Fastify's request logger — declared here so the module
 *  stays free of a cross-module import for a four-method shape. */
type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

/**
 * Conventions Extractor.
 *
 * Three stages, and only the middle one is a model:
 *   1. SAMPLE  — code picks the files (configs + repo-intel's top-ranked
 *                source files). The model never browses the repo.
 *   2. PROPOSE — one cheap structured call over that sample. Candidates are
 *                proposals with a citation, nothing more.
 *   3. VERIFY  — code re-reads the cited file and drops any candidate whose
 *                snippet is not really there (see helpers.verifyCandidate).
 *
 * What survives is persisted as `pending` for the user to accept or reject;
 * accepted rules are assembled into a `repo-conventions` skill.
 *
 * A scan is a model call over a whole repository, so it runs DETACHED: the
 * route answers 202 with a `scan_id` and the caller watches the RunBus stream
 * (`GET /conventions/scans/:id/events`) for progress, exactly as a review run
 * does.
 */
export class ConventionsService {
  private readonly repo: ConventionsRepository;
  private readonly reposRepo: Container['reposRepo'];
  private readonly repoIntel: Container['repoIntel'];
  private readonly git: Container['git'];
  private readonly runBus: Container['runBus'];

  /**
   * repoId → the scan currently running for it. A second request while a scan
   * is in flight gets the SAME scan_id back instead of charging the workspace
   * for a duplicate model call over identical bytes.
   */
  private readonly inFlight = new Map<string, string>();

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
    this.reposRepo = container.reposRepo;
    this.repoIntel = container.repoIntel;
    this.git = container.git;
    this.runBus = container.runBus;
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listForRepo(workspaceId, repoId);
    return rows.map(toCandidateDto);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: { rule?: string; rationale?: string | null; status?: ConventionStatus },
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toCandidateDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** Returns immediately with the stream handle; the scan runs detached. */
  startScan(workspaceId: string, repoId: string, log?: Logger): { scan_id: string } {
    const running = this.inFlight.get(repoId);
    if (running) return { scan_id: running };

    const scanId = randomUUID();
    this.inFlight.set(repoId, scanId);
    void this.runScan(scanId, workspaceId, repoId, log).catch((err) => {
      log?.error(
        { repoId, scanId, err: (err as Error).message },
        'conventions: background scan crashed',
      );
    });
    return { scan_id: scanId };
  }

  /**
   * The scan itself. Every stage publishes on the RunBus under `scanId`, so the
   * SSE route needs no contract of its own — `RunEvent.data` carries a `stage`
   * discriminator and the terminal `result` event carries the whole
   * `ConventionExtractResult`, which is what the client renders.
   */
  private async runScan(
    scanId: string,
    workspaceId: string,
    repoId: string,
    log?: Logger,
  ): Promise<void> {
    try {
      const repo = await this.reposRepo.getById(workspaceId, repoId);
      if (!repo) throw new NotFoundError('Repository not found');
      const ref: RepoRef = { owner: repo.owner, name: repo.name };

      this.runBus.publish(scanId, 'info', 'Sampling repository…', { stage: 'sampling' });

      const files = await this.sample(repoId, ref);
      if (files.length === 0) {
        throw new ValidationError(
          'Nothing to sample — the repository has not been cloned and indexed yet. Open it once so repo-intel can index it, then re-run the scan.',
        );
      }

      const byPath = new Map(files.map((f) => [f.path, f]));
      const sampledPaths = files.map((f) => f.path);
      const rendered = renderSamples(files, MAX_SAMPLE_CHARS);

      this.runBus.publish(scanId, 'info', `Sampled ${files.length} files`, {
        stage: 'sampled',
        files: sampledPaths,
      });

      const choice = await resolveUsableFeatureModel(this.container, workspaceId, 'conventions');
      this.runBus.publish(scanId, 'tool', 'Proposing conventions…', {
        stage: 'proposing',
        model: choice.model,
        provider: choice.provider,
      });

      const llm = await this.container.llm(choice.provider);
      const result = await llm.completeStructured({
        model: choice.model,
        schema: ExtractionSchema,
        // Matches the fixture key `MockLLMOptions.structuredBySchema` documents
        // for this feature, so a test can target this call by name.
        schemaName: 'ConventionExtraction',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(repo.fullName, rendered, sampledPaths) },
        ],
        temperature: EXTRACT_TEMPERATURE,
        maxTokens: EXTRACT_MAX_TOKENS,
        timeoutMs: EXTRACT_TIMEOUT_MS,
      });

      const proposed = result.data.candidates;
      this.runBus.publish(scanId, 'info', 'Verifying evidence…', {
        stage: 'verifying',
        proposed: proposed.length,
      });

      const verified: VerifiedCandidate[] = [];
      const drops: DropReason[] = [];
      for (const raw of proposed) {
        const check = verifyCandidate(byPath, raw);
        if (check.ok) verified.push(check.candidate);
        else drops.push(check.reason);
      }
      verified.sort((a, b) => b.confidence - a.confidence);

      // Rules the user already ruled on stay ruled on: a re-scan must not
      // re-propose something accepted (it is already in a skill) or rejected.
      const existing = await this.repo.listForRepo(workspaceId, repoId);
      const decided = existing.filter((r) => r.status !== 'pending').map((r) => ruleKey(r.rule));
      const { kept, dropped: duplicates } = dedupeCandidates(verified, decided);

      await this.repo.replacePending(workspaceId, repoId, kept);
      // Return the whole board, not just the new rows: the page renders accepted
      // and rejected candidates from earlier scans alongside these.
      const all = await this.repo.listForRepo(workspaceId, repoId);

      const payload: ConventionExtractResult = {
        candidates: all.map(toCandidateDto),
        sampled_files: sampledPaths,
        proposed: proposed.length,
        dropped_ungrounded: drops.length,
        dropped_duplicate: duplicates,
        model: result.model,
        cost_usd: result.costUsd,
      };

      this.runBus.publish(
        scanId,
        'result',
        `Scan complete — ${kept.length} of ${proposed.length} kept`,
        { stage: 'done', result: payload },
      );
    } catch (err) {
      const msg = (err as Error).message ?? 'Scan failed';
      log?.warn({ repoId, scanId, err: msg }, 'conventions: scan failed');
      this.runBus.publish(scanId, 'error', msg, { stage: 'error' });
    } finally {
      // Both are mandatory: without `complete()` every subscriber's stream stays
      // open forever, and without the delete the repo can never be scanned again.
      this.inFlight.delete(repoId);
      this.runBus.complete(scanId);
    }
  }

  /**
   * Build a skill draft from the accepted candidates. Persists NOTHING — the
   * client edits the draft and POSTs it to `/skills`, the same
   * preview-then-confirm flow that skill import uses.
   */
  async skillDraft(
    workspaceId: string,
    repoId: string,
    ids?: string[],
  ): Promise<ConventionSkillDraft> {
    const repo = await this.reposRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');

    const rows = ids?.length
      ? await this.repo.listByIds(workspaceId, ids)
      : (await this.repo.listForRepo(workspaceId, repoId)).filter((r) => r.status === 'accepted');
    if (rows.length === 0) {
      throw new ValidationError('Accept at least one convention before creating a skill');
    }
    return buildSkillDraft(repo.fullName, rows);
  }

  /**
   * Stage 1 — pick and read the sample, entirely in code.
   *
   * Configs come first (they state conventions outright and are cheap), then
   * repo-intel's top-ranked source files, which already exclude tests, configs
   * and migrations. A file that cannot be read is skipped rather than fatal:
   * `CONFIG_SAMPLE_PATHS` is a wish-list, and most repos have only a few of them.
   */
  private async sample(repoId: string, ref: RepoRef): Promise<SampledFile[]> {
    const codePaths = await this.repoIntel
      .getConventionSamples(repoId, TOP_CODE_SAMPLES)
      .catch(() => [] as string[]);
    const paths = [...CONFIG_SAMPLE_PATHS, ...codePaths];

    const files: SampledFile[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      let raw: string;
      try {
        raw = await this.git.readFile(ref, path);
      } catch {
        continue; // not in this repo (config wish-list) or unreadable — skip
      }
      if (!raw.trim()) continue;
      files.push(toSampledFile(path, raw));
    }
    return files;
  }
}
