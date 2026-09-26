// RING 1 — application service. Orchestrates the smart-diff read use case
// through a structural port (`SmartDiffSource`), resolved ONCE in the
// constructor — no `container` field kept, no import from the reviews
// module's internals or the persistence layer (`onion-architecture`, C1/C6).
import type { SmartDiff } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { buildSmartDiff } from './helpers.js';

/**
 * The minimal shape this service reads off `container.reviewRepo`. Declared
 * structurally (not by importing the reviews module's own repository type)
 * so this module names no identifier owned by another module, avoiding the
 * `no-cross-module-internals` warning such an interface import would add (C6).
 */
export interface SmartDiffSource {
  getPull(workspaceId: string, prId: string): Promise<{ id: string } | undefined>;
  getPrFiles(prId: string): Promise<{ path: string; additions: number; deletions: number }[]>;
  reviewsForPull(
    prId: string,
  ): Promise<{ findings: { file: string; startLine: number; endLine: number; dismissedAt: Date | null }[] }[]>;
}

export class SmartDiffService {
  private source: SmartDiffSource;

  constructor(container: Container) {
    this.source = container.reviewRepo;
  }

  /** 404 (`NotFoundError`) when the PR isn't in the workspace — checked BEFORE
   *  the unscoped `reviewsForPull` read (C3/C6). */
  async forPull(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.source.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const [files, reviews] = await Promise.all([
      this.source.getPrFiles(prId),
      this.source.reviewsForPull(prId),
    ]);
    const findings = reviews.flatMap((r) => r.findings);
    return buildSmartDiff(files, findings);
  }
}
