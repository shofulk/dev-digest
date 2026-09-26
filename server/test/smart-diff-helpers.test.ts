import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import { classifyFile, buildSmartDiff } from '../src/modules/smart-diff/helpers.js';
import { SPLIT_THRESHOLD_LINES } from '../src/modules/smart-diff/constants.js';

/**
 * T1 — classifier table (AC6). Pinned by the request, one case per rule, and
 * every path is repo-relative and case-sensitive.
 */
describe('classifyFile', () => {
  it.each([
    // pinned by the request
    ['__tests__/__snapshots__/x.snap', 'boilerplate'],
    ['.claude/skills/security/SKILL.md', 'wiring'],
    ['e2e/README.md', 'tests'],
    ['package.json', 'core'],
    ['src/api/users.ts', 'core'],
    // one positive case per boilerplate rule
    ['server/pnpm-lock.yaml', 'boilerplate'],
    ['yarn.lock', 'boilerplate'],
    ['client/dist/app.js', 'boilerplate'],
    ['schema.generated.ts', 'boilerplate'],
    ['vendor.min.js', 'boilerplate'],
    // one positive case per tests rule
    ['FindingCard.test.tsx', 'tests'],
    ['reviews.it.test.ts', 'tests'],
    ['src/x.spec.ts', 'tests'],
    ['server/test/helpers/pg.ts', 'tests'],
    ['e2e/specs/05-pr-diff.flow.json', 'tests'],
    // one positive case per wiring rule
    ['server/src/modules/index.ts', 'wiring'],
    ['vitest.config.ts', 'wiring'],
    ['tsconfig.build.json', 'wiring'],
    ['.eslintrc.json', 'wiring'],
    ['.env.example', 'wiring'],
    ['docker-compose.yml', 'wiring'],
    ['.github/workflows/ci.yml', 'wiring'],
    // one positive case per docs rule
    ['docs/plans/x.plan.md', 'docs'],
    ['server/INSIGHTS.md', 'docs'],
    ['README.md', 'docs'],
    ['CHANGELOG', 'docs'],
    ['LICENSE', 'docs'],
    ['server/.spec/intent-layer.spec.md', 'docs'],
    // core is the fallback
    ['src/config.ts', 'core'],
  ] as const)('%s → %s', (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });
});

/**
 * T2 — buildSmartDiff (AC6, AC7).
 */
describe('buildSmartDiff', () => {
  const files = [
    { path: 'src/config.ts', additions: 5, deletions: 1 },
    { path: 'src/api/users.ts', additions: 10, deletions: 2 },
    { path: 'src/x.spec.ts', additions: 3, deletions: 0 },
    { path: 'README.md', additions: 1, deletions: 1 },
    { path: 'pnpm-lock.yaml', additions: 20, deletions: 20 },
    { path: 'server/src/modules/index.ts', additions: 2, deletions: 0 },
  ];

  it('groups in core → tests → wiring → docs → boilerplate order, omitting empty groups, keeping input order', () => {
    const result = buildSmartDiff(files, []);
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
    expect(result.groups.find((g) => g.role === 'core')!.files.map((f) => f.path)).toEqual([
      'src/config.ts',
      'src/api/users.ts',
    ]);
  });

  it('omits a role entirely when no file falls into it', () => {
    const result = buildSmartDiff([{ path: 'src/config.ts', additions: 1, deletions: 1 }], []);
    expect(result.groups).toEqual([
      {
        role: 'core',
        files: [
          { path: 'src/config.ts', pseudocode_summary: null, additions: 1, deletions: 1, finding_lines: [] },
        ],
      },
    ]);
  });

  it('finding_lines is the sorted, de-duplicated union of open finding ranges; dismissed and other files are excluded', () => {
    const findings = [
      { file: 'src/config.ts', startLine: 12, endLine: 12, dismissedAt: null },
      { file: 'src/config.ts', startLine: 10, endLine: 11, dismissedAt: null },
      { file: 'src/config.ts', startLine: 99, endLine: 99, dismissedAt: new Date() },
      { file: 'src/api/users.ts', startLine: 45, endLine: 52, dismissedAt: null },
    ];
    const result = buildSmartDiff(files, findings);
    const core = result.groups.find((g) => g.role === 'core')!;
    expect(core.files.find((f) => f.path === 'src/config.ts')!.finding_lines).toEqual([10, 11, 12]);
    expect(core.files.find((f) => f.path === 'src/api/users.ts')!.finding_lines).toEqual([
      45, 46, 47, 48, 49, 50, 51, 52,
    ]);
    const tests = result.groups.find((g) => g.role === 'tests')!;
    expect(tests.files.find((f) => f.path === 'src/x.spec.ts')!.finding_lines).toEqual([]);
  });

  it('split_suggestion: total_lines = Σ(additions+deletions), too_big flips at threshold + 1, proposed_splits is empty', () => {
    const atThreshold = [{ path: 'src/config.ts', additions: SPLIT_THRESHOLD_LINES, deletions: 0 }];
    const overThreshold = [{ path: 'src/config.ts', additions: SPLIT_THRESHOLD_LINES + 1, deletions: 0 }];
    expect(buildSmartDiff(atThreshold, []).split_suggestion).toEqual({
      too_big: false,
      total_lines: SPLIT_THRESHOLD_LINES,
      proposed_splits: [],
    });
    expect(buildSmartDiff(overThreshold, []).split_suggestion).toEqual({
      too_big: true,
      total_lines: SPLIT_THRESHOLD_LINES + 1,
      proposed_splits: [],
    });
  });

  it('parses as a valid SmartDiff', () => {
    const findings = [{ file: 'src/config.ts', startLine: 12, endLine: 12, dismissedAt: null }];
    expect(() => SmartDiff.parse(buildSmartDiff(files, findings))).not.toThrow();
  });
});
