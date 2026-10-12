import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { MAX_FROZEN_DIFF_BYTES } from './constants.js';
import type { EvalExpectation } from '@devdigest/shared';
import {
  buildFrozenDiff,
  expectationTypeOf,
  freezeCase,
  validateCaseFields,
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

describe('case name (AC33: the bare title slug, via freezeCase)', () => {
  const nameOf = (title: string) => {
    const r = freeze({ finding: { ...finding, title } });
    expect(r.ok).toBe(true);
    return r.ok ? r.value.name : '';
  };

  it('AC33: slugs the title and carries no file:line', () => {
    const name = nameOf('Missing assertion for the b branch!');
    expect(name).toBe('missing-assertion-for-the-b-branch');
    expect(name).not.toContain(' · ');
    expect(name).not.toContain('src/a.ts');
  });

  it('AC33: caps the slug at 60 characters and still has no separator', () => {
    const name = nameOf('x'.repeat(200));
    expect(name).toMatch(/^x{1,60}$/);
    expect(name).not.toContain(' · ');
  });

  it('AC33: falls back to "finding" for an all-symbol title', () => {
    expect(nameOf('!!! ??? ...')).toBe('finding');
  });
});

describe('freezeCase', () => {
  it('freezes a grounded expectation with every field', () => {
    const r = freeze();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe('missing-assertion-for-the-b-branch');
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

describe('validateCaseFields (C11 g)', () => {
  const FILE_A = buildFrozenDiff('src/a.ts', PATCH);
  const FILE_B = buildFrozenDiff('src/b.ts', PATCH);
  const expectation = (over: Partial<EvalExpectation> = {}): EvalExpectation => ({
    type: 'must_find',
    file: 'src/a.ts',
    start_line: 2,
    end_line: 2,
    severity: 'WARNING',
    category: 'bug',
    title: 'ex',
    ...over,
  });
  const validate = (
    over: { name?: string; input_diff?: string; expectation?: EvalExpectation; checkName?: boolean } = {},
  ) =>
    validateCaseFields(
      {
        name: over.name ?? 'a-case',
        input_diff: over.input_diff ?? FILE_A,
        expectation: over.expectation ?? expectation(),
      },
      parseUnifiedDiff,
      { checkName: over.checkName ?? true },
    );
  /** A valid, grounded one-file diff padded with an added line to exactly `bytes` (ASCII, so bytes = length). */
  const padded = (bytes: number) => `${FILE_A}\n+${'x'.repeat(bytes - FILE_A.length - 2)}`;

  describe('AC48: the name', () => {
    it('AC48: trims the name it returns', () => {
      expect(validate({ name: '  stripe-key-leak  ' })).toMatchObject({ ok: true, value: { name: 'stripe-key-leak' } });
    });

    it.each(['', '   '])('AC48: refuses the blank name %j with invalid_name', (name) => {
      expect(validate({ name })).toEqual({ ok: false, code: 'invalid_name' });
    });

    it('AC48: refuses a 121-character name and accepts exactly 120', () => {
      expect(validate({ name: 'n'.repeat(121) })).toEqual({ ok: false, code: 'invalid_name' });
      expect(validate({ name: 'n'.repeat(120) })).toMatchObject({ ok: true, value: { name: 'n'.repeat(120) } });
    });

    it('AC48: ignores the name entirely when checkName is false (a dry run)', () => {
      expect(validate({ name: '', checkName: false })).toMatchObject({ ok: true, value: { input_files: ['src/a.ts'] } });
    });
  });

  describe('AC46: the size cap', () => {
    it('AC46: accepts a valid grounded diff of exactly 204,800 bytes', () => {
      expect(MAX_FROZEN_DIFF_BYTES).toBe(204_800);
      const diff = padded(MAX_FROZEN_DIFF_BYTES);
      expect(new TextEncoder().encode(diff).length).toBe(204_800);
      expect(validate({ input_diff: diff })).toMatchObject({ ok: true, value: { input_files: ['src/a.ts'] } });
    });

    it('AC46: refuses 204,801 bytes of free text as too large, not as an invalid diff (size is checked before parsing)', () => {
      expect(validate({ input_diff: 'x'.repeat(MAX_FROZEN_DIFF_BYTES + 1) })).toEqual({
        ok: false,
        code: 'frozen_diff_too_large',
      });
    });

    it('AC46: counts UTF-8 bytes, not characters', () => {
      // 102,401 two-byte characters = 204,802 bytes but only 102,401 characters.
      expect(validate({ input_diff: 'é'.repeat(102_401) })).toEqual({ ok: false, code: 'frozen_diff_too_large' });
    });
  });

  describe('AC45: the diff must parse', () => {
    it('AC45: refuses a bare hunk with no file header', () => {
      expect(validate({ input_diff: '@@ -1 +1 @@\n+x' })).toEqual({ ok: false, code: 'invalid_diff' });
    });

    it('AC45: refuses file headers with no hunk', () => {
      const headersOnly = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n';
      expect(validate({ input_diff: headersOnly })).toEqual({ ok: false, code: 'invalid_diff' });
    });

    it('AC45: refuses free text', () => {
      expect(validate({ input_diff: 'this is not a diff at all' })).toEqual({ ok: false, code: 'invalid_diff' });
    });
  });

  describe('AC47: the expectation must be groundable in its own diff', () => {
    it('AC47: refuses an expectation on a file that is not in the diff', () => {
      expect(validate({ expectation: expectation({ file: 'src/zzz.ts' }) })).toEqual({
        ok: false,
        code: 'expectation_not_grounded',
      });
    });

    it('AC47: refuses a range outside every hunk', () => {
      expect(validate({ expectation: expectation({ start_line: 90, end_line: 91 }) })).toEqual({
        ok: false,
        code: 'expectation_not_grounded',
      });
    });
  });

  it('AC45: returns input_files = both paths of a two-file diff, in diff order', () => {
    const r = validate({ input_diff: `${FILE_B}\n${FILE_A}`, expectation: expectation({ file: 'src/a.ts' }) });
    expect(r).toMatchObject({ ok: true, value: { input_files: ['src/b.ts', 'src/a.ts'] } });
  });

  it('AC48: reports invalid_name before frozen_diff_too_large (precedence)', () => {
    expect(validate({ name: '   ', input_diff: 'x'.repeat(MAX_FROZEN_DIFF_BYTES + 1) })).toEqual({
      ok: false,
      code: 'invalid_name',
    });
  });
});
