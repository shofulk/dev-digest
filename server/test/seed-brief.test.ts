/**
 * IMPL (L5, T13) — the D10 PR Brief seed literal, hermetic (no DB). Parses
 * `SEED_BRIEF_DOC` + its stored columns against the `PrBrief` contract the
 * same way `BriefRepository.getBrief` reassembles a stored row, and checks
 * every risk/focus file reference is one of the four `pr_files` paths
 * `seed.ts` inserts for PR #482 (AC-71 — the e2e flow opens that exact PR).
 */
import { describe, it, expect } from 'vitest';
import { PrBrief } from '@devdigest/shared';
import {
  SEED_BRIEF_DOC,
  SEED_BRIEF_HEAD_SHA,
  SEED_BRIEF_MODEL,
  SEED_BRIEF_STATS,
} from '../src/db/seed-brief.js';

/** `seed.ts`'s `pr_files` rows for `acme/payments-api` PR #482. */
const SEEDED_PR_FILES = [
  'src/middleware/ratelimit.ts',
  'src/api/public/webhooks.ts',
  'src/config.ts',
  'src/api/users.ts',
];

describe('seed-brief — SEED_BRIEF_DOC literal (impl, T13)', () => {
  it('parses against the PrBrief contract once reassembled with its stored columns', () => {
    const [provider, ...modelParts] = SEED_BRIEF_MODEL.split('/');
    const candidate = {
      ...SEED_BRIEF_DOC,
      pr_id: '00000000-0000-0000-0000-000000000000',
      head_sha: SEED_BRIEF_HEAD_SHA,
      provider,
      model: modelParts.join('/'),
      generated_at: new Date().toISOString(),
      stats: SEED_BRIEF_STATS,
    };
    const parsed = PrBrief.safeParse(candidate);
    expect(parsed.success, parsed.success ? '' : JSON.stringify((parsed as { error: unknown }).error)).toBe(true);
  });

  it('every risk file_ref and review_focus file is one of the four seeded pr_files paths', () => {
    for (const risk of SEED_BRIEF_DOC.risks) {
      for (const ref of risk.file_refs) {
        expect(SEEDED_PR_FILES).toContain(ref);
      }
    }
    for (const item of SEED_BRIEF_DOC.review_focus) {
      expect(SEEDED_PR_FILES).toContain(item.file);
    }
  });
});
