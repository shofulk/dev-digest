// RING 1 — application service. Orchestrates the blast-radius read use case
// through two structural ports (`BlastPullSource`, `BlastIndexSource`),
// resolved ONCE in the constructor — no `container` field kept, no import
// from another module's internals or the persistence layer
// (`onion-architecture`, C1). The logger arrives as a method argument.
import type { BlastDegradedReason, BlastRadius } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { deriveBlastStatus, mapFacadeBlast, summarizeBlast, type BlastFacadeResult } from './helpers.js';
import { INDEX_NOT_READY_SUMMARY, NO_FILES_SUMMARY } from './constants.js';

/** The minimal shape this service reads off the reviews aggregate. */
export interface BlastPullSource {
  getPull(workspaceId: string, prId: string): Promise<{ id: string; repoId: string } | undefined>;
  getPrFiles(prId: string): Promise<{ path: string }[]>;
}

export interface BlastIndexStateLike {
  status: 'full' | 'partial' | 'degraded' | 'failed';
  lastIndexedSha: string;
  degradedReason?: BlastDegradedReason;
}

/** The minimal shape this service reads off the index facade. */
export interface BlastIndexSource {
  getIndexState(repoId: string): Promise<BlastIndexStateLike>;
  getBlastRadius(repoId: string, files: string[]): Promise<BlastFacadeResult>;
}

export interface BlastLimits {
  maxCallersPerSymbol: number;
  bfsDepth: number;
}

export interface BlastLogger {
  info(obj: unknown, msg: string): void;
}

/** `AC9` fields describing how a response was produced. */
type BlastSource = 'index' | 'fallback' | 'none';

interface RequestMeta {
  prId: string;
  repoId: string;
  source: BlastSource;
  indexStatus: string;
  indexedSha: string;
  changedFiles: number;
  startedAt: number;
}

export class BlastService {
  private pulls: BlastPullSource;
  private index: BlastIndexSource;
  private enabled: boolean;
  private limits: BlastLimits;

  constructor(container: Container, limits: BlastLimits) {
    this.pulls = container.reviewRepo;
    this.index = container.repoIntel;
    this.enabled = container.config.repoIntelEnabled;
    this.limits = limits;
  }

  async forPull(workspaceId: string, prId: string, log: BlastLogger): Promise<BlastRadius> {
    const startedAt = Date.now();
    const pull = await this.pulls.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const limits = { max_callers_per_symbol: this.limits.maxCallersPerSymbol, bfs_depth: this.limits.bfsDepth };

    const files = await this.pulls.getPrFiles(prId);
    if (files.length === 0) {
      return this.respond(
        {
          changed_symbols: [],
          downstream: [],
          summary: NO_FILES_SUMMARY,
          degraded: false,
          reason: null,
          limits,
          indexed_sha: null,
        },
        { prId, repoId: pull.repoId, source: 'none', indexStatus: 'n/a', indexedSha: '', changedFiles: 0, startedAt },
        log,
      );
    }

    if (!this.enabled) {
      return this.respond(
        {
          changed_symbols: [],
          downstream: [],
          summary: INDEX_NOT_READY_SUMMARY,
          degraded: true,
          reason: 'flag_off',
          limits,
          indexed_sha: null,
        },
        { prId, repoId: pull.repoId, source: 'none', indexStatus: 'n/a', indexedSha: '', changedFiles: files.length, startedAt },
        log,
      );
    }

    const state = await this.index.getIndexState(pull.repoId);
    if (state.status !== 'full' && state.status !== 'partial') {
      const status = deriveBlastStatus({ enabled: true, indexStatus: state.status, indexReason: state.degradedReason });
      return this.respond(
        {
          changed_symbols: [],
          downstream: [],
          summary: INDEX_NOT_READY_SUMMARY,
          degraded: status.degraded,
          reason: status.reason,
          limits,
          indexed_sha: null,
        },
        {
          prId,
          repoId: pull.repoId,
          source: 'none',
          indexStatus: state.status,
          indexedSha: state.lastIndexedSha,
          changedFiles: files.length,
          startedAt,
        },
        log,
      );
    }

    const fb = await this.index.getBlastRadius(pull.repoId, files.map((f) => f.path));
    const { changed_symbols, downstream } = mapFacadeBlast(fb);
    const status = deriveBlastStatus({
      enabled: true,
      indexStatus: state.status,
      facadeDegraded: fb.degraded,
      facadeReason: fb.reason,
    });
    const summary = summarizeBlast(changed_symbols, downstream);
    const source: BlastSource = fb.degraded ? 'fallback' : 'index';
    // The link commit is only honest when the map itself came from the index (D9).
    const indexedSha = source === 'index' && state.lastIndexedSha !== '' ? state.lastIndexedSha : null;

    return this.respond(
      { changed_symbols, downstream, summary, degraded: status.degraded, reason: status.reason, limits, indexed_sha: indexedSha },
      {
        prId,
        repoId: pull.repoId,
        source,
        indexStatus: state.status,
        indexedSha: state.lastIndexedSha,
        changedFiles: files.length,
        startedAt,
      },
      log,
    );
  }

  /** Logs `AC9`'s one info line, then returns the result unchanged. */
  private respond(result: BlastRadius, meta: RequestMeta, log: BlastLogger): BlastRadius {
    const callers = result.downstream.reduce((n, d) => n + d.callers.length, 0);
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const d of result.downstream) {
      for (const e of d.endpoints_affected) endpoints.add(e);
      for (const c of d.crons_affected) crons.add(c);
    }
    log.info(
      {
        prId: meta.prId,
        repoId: meta.repoId,
        source: meta.source,
        indexStatus: meta.indexStatus,
        indexedSha: meta.indexedSha,
        changedFiles: meta.changedFiles,
        changedSymbols: result.changed_symbols.length,
        callers,
        endpoints: endpoints.size,
        crons: crons.size,
        durationMs: Date.now() - meta.startedAt,
      },
      'blast: read from index',
    );
    return result;
  }
}
