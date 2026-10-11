import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { MAX_FROZEN_DIFF_BYTES } from './constants.js';
import {
  buildFrozenDiff,
  caseName,
  expectationTypeOf,
  freezeCase,
  type FreezableFinding,
} from './frozen-input.js';

const PATCH = ['@@ -1,3 +1,4 @@', ' const a = 1;', '+const b = 2;', ' const c = 3;', ' export {};'].join('\n');
const NOW = new Date('2026-10-11T10:00:00.000Z');

const finding: FreezableFinding = {
  id: 'f-1',
  file: 'src/a.ts',
  startLine: 2,
  endLine: 2,
  severity: 'WARNING',
  category: 'test',
  title: 'Missing assertion for the b branch!',
  rationale: 'The new branch is never asserted.',
};
const pull = { number: 7, title: 'Add b', body: 'Adds b.' };
const freeze = (over: Partial<Parameters<typeof freezeCase>[0]> = {}) =>
  freezeCase({ finding, type: 'must_find', reviewId: 'r-1', pull, patch: PATCH, now: NOW, parseDiff: parseUnifiedDiff, ...over });

describe('buildFrozenDiff', () => {
  it('round-trips one file with its new-side hunk lines', () => {
    const diff = parseUnifiedDiff(buildFrozenDiff('src/a.ts', PATCH));
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]!.path).toBe('src/a.ts');
    expect(diff.files[0]!.hunks[0]!.newLineNumbers).toContain(2);
  });
});

describe('expectationTypeOf', () => {
  it('maps the triage decision', () => {
    expect(expectationTypeOf({ acceptedAt: NOW, dismissedAt: null })).toBe('must_find');
    expect(expectationTypeOf({ acceptedAt: null, dismissedAt: NOW })).toBe('must_not_flag');
    expect(expectationTypeOf({ acceptedAt: null, dismissedAt: null })).toBeNull();
  });
});

describe('caseName', () => {
  it('slugs the title and appends file:line', () => {
    expect(caseName('Missing assertion for the b branch!', 'src/a.ts', 2)).toBe(
      'missing-assertion-for-the-b-branch · src/a.ts:2',
    );
  });
  it('caps the slug length', () => {
    const name = caseName('x'.repeat(200), 'f.ts', 1);
    expect(name.split(' · ')[0]!.length).toBeLessThanOrEqual(60);
  });
});

describe('freezeCase', () => {
  it('freezes a grounded expectation with every field', () => {
    const r = freeze();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe('missing-assertion-for-the-b-branch · src/a.ts:2');
    expect(r.value.input_files).toEqual(['src/a.ts']);
    expect(r.value.input_meta).toEqual({
      source_finding_id: 'f-1',
      source_review_id: 'r-1',
      pr_number: 7,
      pr_title: 'Add b',
      pr_body: 'Adds b.',
      created_at: NOW.toISOString(),
    });
    expect(r.value.expected_output).toEqual({
      type: 'must_find',
      file: 'src/a.ts',
      start_line: 2,
      end_line: 2,
      severity: 'WARNING',
      category: 'test',
      title: finding.title,
    });
    expect(r.value.notes).toBe(finding.rationale);
    expect(r.value.input_diff).toBe(buildFrozenDiff('src/a.ts', PATCH));
  });

  it('rejects an expectation outside every hunk', () => {
    expect(freeze({ finding: { ...finding, startLine: 90, endLine: 91 } })).toEqual({
      ok: false,
      code: 'expectation_not_grounded',
    });
  });

  it('rejects an expectation before the first hunk', () => {
    const r = freeze({ finding: { ...finding, startLine: 0, endLine: 0 } });
    expect(r).toEqual({ ok: false, code: 'expectation_not_grounded' });
  });

  it('rejects an expectation on a file that is not in the parsed diff', () => {
    // The framed diff always names the finding's file; a parser that yields another
    // file models a diff that does not contain it.
    const otherFileOnly = () => parseUnifiedDiff(buildFrozenDiff('src/other.ts', PATCH));
    expect(freeze({ parseDiff: otherFileOnly })).toEqual({ ok: false, code: 'expectation_not_grounded' });
  });

  it('rejects a missing or empty patch', () => {
    expect(freeze({ patch: null })).toEqual({ ok: false, code: 'no_diff_available' });
    expect(freeze({ patch: '' })).toEqual({ ok: false, code: 'no_diff_available' });
  });

  it('enforces the size cap on the framed diff, to the byte', () => {
    const header = buildFrozenDiff('src/a.ts', '').length;
    const body = (n: number) => `${PATCH}\n+${'x'.repeat(n - PATCH.length - 2)}`;
    const exact = MAX_FROZEN_DIFF_BYTES - header;
    expect(freeze({ patch: body(exact) }).ok).toBe(true);
    expect(freeze({ patch: body(exact + 1) })).toEqual({ ok: false, code: 'frozen_diff_too_large' });
  });
});
