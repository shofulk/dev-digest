// RING 1 — pure application constants. No DB, no container, no Fastify
// (`onion-architecture`). Imports only `@devdigest/shared` and other ring-0/1
// files.
import type { SmartDiffRole } from '@devdigest/shared';

/**
 * Display / grouping order (AC1, D8). This is the ONLY source of layout order
 * — grouping never relies on `SmartDiffRole.options`, so the enum's own
 * declaration order in `vendor/shared` carries no layout meaning.
 */
export const ROLE_ORDER = ['core', 'tests', 'wiring', 'docs', 'boilerplate'] as const satisfies readonly SmartDiffRole[];

/** A file whose additions+deletions push the PR total over this line count is
 *  flagged `too_big` in `split_suggestion` (AC7). The banner itself is P2 (O2). */
export const SPLIT_THRESHOLD_LINES = 400;
