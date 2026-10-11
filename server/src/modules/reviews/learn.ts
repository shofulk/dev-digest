import type { LearnFindingResult, MemoryKind, MemoryScope } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository } from './repository.js';

/**
 * Ring 1 (application). The Learn action: store one `learning` memory row for
 * a finding (idempotent per finding).
 */
export async function learnFromFinding(
  repo: ReviewRepository,
  workspaceId: string,
  findingId: string,
): Promise<LearnFindingResult> {
  const ctx = await repo.findingContext(findingId);
  if (!ctx || ctx.pull.workspaceId !== workspaceId) {
    throw new NotFoundError('Finding not found');
  }
  const { finding, pull } = ctx;
  const { row, created } = await repo.learnOnce({
    workspaceId,
    repoId: pull.repoId,
    content: `${finding.title}\n\n${finding.rationale}`,
    prNumber: pull.number,
    findingId,
  });
  return {
    id: row.id,
    content: row.content,
    kind: row.kind as MemoryKind,
    scope: row.scope as MemoryScope,
    created,
  };
}
