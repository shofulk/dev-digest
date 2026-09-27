import { describe, it, expect, vi } from 'vitest';
import type { Container } from '../src/platform/container.js';
import { NotFoundError } from '../src/platform/errors.js';
import { SmartDiffService, type SmartDiffSource } from '../src/modules/smart-diff/service.js';

/**
 * T3 — hermetic: a fake `SmartDiffSource`, no `buildApp`, no DB.
 */
function serviceWith(source: SmartDiffSource): SmartDiffService {
  const container = { reviewRepo: source } as unknown as Container;
  return new SmartDiffService(container);
}

describe('SmartDiffService.forPull', () => {
  it('throws NotFoundError when the pull is missing, and never calls reviewsForPull', async () => {
    const reviewsForPull = vi.fn();
    const service = serviceWith({
      getPull: vi.fn().mockResolvedValue(undefined),
      getPrFiles: vi.fn(),
      reviewsForPull,
    });

    await expect(service.forPull('ws-1', 'pr-missing')).rejects.toBeInstanceOf(NotFoundError);
    expect(reviewsForPull).not.toHaveBeenCalled();
  });

  it('happy path: maps PR files and findings from all reviews', async () => {
    const service = serviceWith({
      getPull: vi.fn().mockResolvedValue({ id: 'pr-1' }),
      getPrFiles: vi.fn().mockResolvedValue([
        { path: 'src/config.ts', additions: 5, deletions: 1 },
        { path: 'README.md', additions: 1, deletions: 0 },
      ]),
      reviewsForPull: vi.fn().mockResolvedValue([
        { findings: [{ file: 'src/config.ts', startLine: 12, endLine: 12, dismissedAt: null }] },
        { findings: [{ file: 'src/config.ts', startLine: 13, endLine: 13, dismissedAt: new Date() }] },
      ]),
    });

    const result = await service.forPull('ws-1', 'pr-1');
    const core = result.groups.find((g) => g.role === 'core')!;
    expect(core.files.find((f) => f.path === 'src/config.ts')!.finding_lines).toEqual([12]);
    const docs = result.groups.find((g) => g.role === 'docs')!;
    expect(docs.files.map((f) => f.path)).toEqual(['README.md']);
  });
});
