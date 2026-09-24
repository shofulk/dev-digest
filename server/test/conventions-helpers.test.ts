import { describe, it, expect } from 'vitest';
import {
  buildSkillDraft,
  dedupeCandidates,
  renderSample,
  renderSamples,
  ruleKey,
  slugify,
  toCandidateDto,
  toSampledFile,
  verifyCandidate,
  type RawCandidate,
  type SampledFile,
  type VerifiedCandidate,
} from '../src/modules/conventions/helpers.js';
import {
  MAX_FILE_CHARS,
  MAX_FILE_LINES,
  MIN_SNIPPET_CHARS,
} from '../src/modules/conventions/constants.js';
import type { ConventionRow } from '../src/db/rows.js';

/**
 * The Conventions Extractor's code-only halves: what the model is shown, and
 * the evidence gate that decides which of its candidates survive. Hermetic —
 * no DB, no model, no filesystem.
 *
 * The gate is the feature: everything the UI displays is re-read from the
 * sampled file, so a candidate the model invented can never reach a skill.
 */

const USERS = [
  'export async function getUser(id: string) {',
  '  const user = await db.users.find(id);',
  '  if (!user) throw new NotFoundError("User not found");',
  '  return user;',
  '}',
].join('\n');

function sample(entries: Record<string, string>): Map<string, SampledFile> {
  return new Map(Object.entries(entries).map(([path, text]) => [path, toSampledFile(path, text)]));
}

function raw(over: Partial<RawCandidate> = {}): RawCandidate {
  return {
    category: 'errors',
    rule: 'Throw NotFoundError instead of returning null for a missing row',
    rationale: 'Callers rely on the error, not a null check.',
    evidence_path: 'src/api/users.ts',
    evidence_line: 3,
    evidence_snippet: '  if (!user) throw new NotFoundError("User not found");',
    confidence: 0.82,
    ...over,
  };
}

describe('toSampledFile', () => {
  it('splits once and reports an untruncated file as such', () => {
    const file = toSampledFile('a.ts', 'const a = 1;\nconst b = 2;');
    expect(file.path).toBe('a.ts');
    expect(file.lines).toEqual(['const a = 1;', 'const b = 2;']);
    expect(file.text).toBe('const a = 1;\nconst b = 2;');
    expect(file.truncated).toBe(false);
  });

  it('clamps to the per-file LINE cap and flags the truncation', () => {
    const big = Array.from({ length: MAX_FILE_LINES + 40 }, (_, i) => `line ${i}`).join('\n');
    const file = toSampledFile('big.ts', big);
    expect(file.lines).toHaveLength(MAX_FILE_LINES);
    expect(file.truncated).toBe(true);
  });

  it('clamps to the per-file CHAR cap even when the line count is small', () => {
    const file = toSampledFile('one-liner.ts', 'x'.repeat(MAX_FILE_CHARS + 500));
    expect(file.truncated).toBe(true);
    expect(file.text).toHaveLength(MAX_FILE_CHARS);
  });
});

describe('renderSample / renderSamples', () => {
  it('prefixes 1-based line numbers, which is what makes a citation checkable', () => {
    const out = renderSample(toSampledFile('a.ts', 'const a = 1;\nconst b = 2;'));
    expect(out).toBe('--- FILE: a.ts ---\n1\tconst a = 1;\n2\tconst b = 2;');
  });

  it('marks a file truncated by the per-file cap', () => {
    const big = Array.from({ length: MAX_FILE_LINES + 40 }, (_, i) => `line ${i}`).join('\n');
    expect(renderSample(toSampledFile('big.ts', big))).toContain('… (truncated)');
  });

  it('stops adding files once the whole-sample budget is spent', () => {
    const files = [toSampledFile('a.ts', 'a'.repeat(200)), toSampledFile('b.ts', 'b'.repeat(200))];
    const out = renderSamples(files, 240);
    expect(out).toContain('a.ts');
    expect(out).not.toContain('b.ts');
    expect(out.length).toBeLessThanOrEqual(240);
  });

  it('keeps every file when the budget is ample, separated by a blank line', () => {
    const files = [toSampledFile('a.ts', 'const a = 1;'), toSampledFile('b.ts', 'const b = 2;')];
    const out = renderSamples(files, 10_000);
    expect(out).toBe('--- FILE: a.ts ---\n1\tconst a = 1;\n\n--- FILE: b.ts ---\n1\tconst b = 2;');
  });
});

describe('verifyCandidate', () => {
  it('keeps a candidate whose snippet is really in the cited file', () => {
    const result = verifyCandidate(sample({ 'src/api/users.ts': USERS }), raw());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.evidenceLine).toBe(3);
    expect(result.candidate.evidencePath).toBe('src/api/users.ts');
    expect(result.candidate.category).toBe('errors');
    expect(result.candidate.confidence).toBeCloseTo(0.82);
  });

  it('re-slices the snippet FROM THE FILE, never from the model’s reply', () => {
    // Same line, different whitespace and no trailing `;`: if the stored snippet
    // were the model's text it would come back mangled exactly like this.
    const result = verifyCandidate(
      sample({ 'src/api/users.ts': USERS }),
      raw({ evidence_snippet: 'if   (!user)  throw new NotFoundError("User not found")' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.evidenceSnippet).toBe(
      'if (!user) throw new NotFoundError("User not found");',
    );
  });

  it('corrects an off-by-N line number rather than dropping a real rule', () => {
    const result = verifyCandidate(
      sample({ 'src/api/users.ts': USERS }),
      raw({ evidence_line: 11 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.evidenceLine).toBe(3);
  });

  it('drops a candidate citing a file that was never sampled', () => {
    const result = verifyCandidate(
      sample({ 'src/api/users.ts': USERS }),
      raw({ evidence_path: 'src/api/invented.ts' }),
    );
    expect(result).toEqual({ ok: false, reason: 'unknown_file' });
  });

  it('drops a candidate whose snippet is not in the file (the invented-evidence case)', () => {
    const result = verifyCandidate(
      sample({ 'src/api/users.ts': USERS }),
      raw({ evidence_snippet: 'return Result.err(new ApiError("nope"));' }),
    );
    expect(result).toEqual({ ok: false, reason: 'snippet_not_found' });
  });

  it('drops a snippet too short to identify a line', () => {
    const shortest = 'x'.repeat(MIN_SNIPPET_CHARS - 1);
    expect(
      verifyCandidate(sample({ 'src/api/users.ts': USERS }), raw({ evidence_snippet: '}' })),
    ).toEqual({ ok: false, reason: 'snippet_too_short' });
    expect(
      verifyCandidate(sample({ [`a.ts`]: shortest }), raw({
        evidence_path: 'a.ts',
        evidence_snippet: shortest,
      })),
    ).toEqual({ ok: false, reason: 'snippet_too_short' });
  });

  it('drops a candidate with an empty rule', () => {
    expect(verifyCandidate(sample({ 'src/api/users.ts': USERS }), raw({ rule: '   ' }))).toEqual({
      ok: false,
      reason: 'empty_rule',
    });
  });

  it('resolves a `./`-prefixed or bare-filename citation when the suffix is UNIQUE', () => {
    const files = sample({ 'src/api/users.ts': USERS });
    expect(verifyCandidate(files, raw({ evidence_path: './src/api/users.ts' })).ok).toBe(true);
    const bare = verifyCandidate(files, raw({ evidence_path: 'users.ts' }));
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    // Resolved to the sampled path, not stored as the model spelled it.
    expect(bare.candidate.evidencePath).toBe('src/api/users.ts');
  });

  it('refuses to guess when a bare filename is AMBIGUOUS across two sampled files', () => {
    const files = sample({ 'src/api/users.ts': USERS, 'src/db/users.ts': USERS });
    expect(verifyCandidate(files, raw({ evidence_path: 'users.ts' }))).toEqual({
      ok: false,
      reason: 'unknown_file',
    });
  });

  it('strips a line-number gutter the model echoed back', () => {
    const result = verifyCandidate(
      sample({ 'src/api/users.ts': USERS }),
      raw({ evidence_snippet: '3\t  if (!user) throw new NotFoundError("User not found");' }),
    );
    expect(result.ok).toBe(true);
  });

  it('falls back to `general` for a category outside the enum', () => {
    const result = verifyCandidate(
      sample({ 'src/api/users.ts': USERS }),
      raw({ category: 'vibes' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.category).toBe('general');
  });

  it('clamps an out-of-range confidence into [0,1]', () => {
    const hi = verifyCandidate(sample({ 'src/api/users.ts': USERS }), raw({ confidence: 4 }));
    const lo = verifyCandidate(sample({ 'src/api/users.ts': USERS }), raw({ confidence: -2 }));
    expect(hi.ok && hi.candidate.confidence).toBe(1);
    expect(lo.ok && lo.candidate.confidence).toBe(0);
  });
});

describe('ruleKey', () => {
  it('ignores case, punctuation and whitespace, so one rule has one key', () => {
    expect(ruleKey('Use async/await instead of `.then()` chains.')).toBe(
      ruleKey('use   async/await instead of .then() chains'),
    );
  });

  it('still separates two genuinely different rules', () => {
    expect(ruleKey('Use async/await')).not.toBe(ruleKey('Use promises'));
  });
});

describe('dedupeCandidates', () => {
  const make = (rule: string, confidence = 0.8): VerifiedCandidate => ({
    category: 'general',
    rule,
    rationale: null,
    evidencePath: 'a.ts',
    evidenceLine: 1,
    evidenceSnippet: 'x',
    confidence,
  });

  it('keeps the first of two rules that differ only in punctuation and case', () => {
    const { kept, dropped } = dedupeCandidates([
      make('Use async/await instead of .then() chains'),
      make('use async/await instead of `.then()` chains.'),
    ]);
    expect(kept).toHaveLength(1);
    expect(dropped).toBe(1);
  });

  it('drops a rule whose ruleKey matches one the user already decided on', () => {
    const seen = [ruleKey('Use async/await instead of .then() chains')];
    const { kept, dropped } = dedupeCandidates(
      [make('Use async/await instead of `.then()` chains.'), make('Name files in kebab-case')],
      seen,
    );
    expect(kept.map((c) => c.rule)).toEqual(['Name files in kebab-case']);
    expect(dropped).toBe(1);
  });

  it('is a no-op on an already-unique list', () => {
    const input = [make('A rule about imports'), make('A rule about naming')];
    expect(dedupeCandidates(input)).toEqual({ kept: input, dropped: 0 });
  });
});

describe('buildSkillDraft', () => {
  const row = (over: Partial<ConventionRow> = {}): ConventionRow =>
    ({
      id: 'c1',
      workspaceId: 'w1',
      repoId: 'r1',
      category: 'errors',
      rule: 'Throw NotFoundError instead of returning null',
      rationale: 'Callers rely on the error.',
      evidencePath: 'src/api/users.ts',
      evidenceLine: 3,
      evidenceSnippet: 'if (!user) throw new NotFoundError("User not found");',
      confidence: 0.9,
      status: 'accepted',
      createdAt: new Date('2026-08-05T00:00:00Z'),
      ...over,
    }) as ConventionRow;

  it('names the skill after the repo and types it `convention`', () => {
    const draft = buildSkillDraft('acme/payments-api', [row()]);
    expect(draft.name).toBe('payments-api-conventions');
    expect(draft.type).toBe('convention');
    expect(draft.description).toContain('1 house convention');
    expect(buildSkillDraft('acme/payments-api', [row(), row({ id: 'c2' })]).description).toContain(
      '2 house conventions',
    );
  });

  it('opens with the title and the reviewer instruction, then a section per rule', () => {
    const draft = buildSkillDraft('acme/payments-api', [row()]);
    expect(draft.body.startsWith('# payments-api-conventions\n')).toBe(true);
    expect(draft.body).toContain('House conventions for `acme/payments-api`');
    expect(draft.body).toContain('## throw-notfounderror-instead-of-returning-null');
    expect(draft.body).toContain('Throw NotFoundError instead of returning null');
    expect(draft.body).toContain('Callers rely on the error.');
  });

  it('carries each rule’s file:line evidence into the body as a fenced block', () => {
    const draft = buildSkillDraft('acme/payments-api', [row()]);
    expect(draft.body).toContain('Detected in `src/api/users.ts:3`:');
    expect(draft.body).toContain(
      '```\nif (!user) throw new NotFoundError("User not found");\n```',
    );
  });

  it('reports a DEDUPED evidence_files list and the ids it was built from', () => {
    const draft = buildSkillDraft('acme/payments-api', [
      row(),
      row({ id: 'c2' }), // same evidence file
      row({ id: 'c3', evidencePath: 'src/db/index.ts', rule: 'Import the db from the barrel' }),
    ]);
    expect(draft.evidence_files).toEqual(['src/api/users.ts', 'src/db/index.ts']);
    expect(draft.convention_ids).toEqual(['c1', 'c2', 'c3']);
  });

  it('omits the evidence block for a rule that has no path', () => {
    const draft = buildSkillDraft('acme/payments-api', [row({ evidencePath: null })]);
    expect(draft.body).not.toContain('Detected in');
    expect(draft.evidence_files).toEqual([]);
  });
});

describe('toCandidateDto', () => {
  it('normalises nullable columns into the contract’s non-null strings', () => {
    const dto = toCandidateDto({
      id: 'c1',
      workspaceId: 'w1',
      repoId: 'r1',
      category: 'general',
      rule: 'A rule',
      rationale: null,
      evidencePath: null,
      evidenceLine: null,
      evidenceSnippet: null,
      confidence: null,
      status: 'pending',
      createdAt: null,
    } as unknown as ConventionRow);
    expect(dto).toMatchObject({
      evidence_path: '',
      evidence_snippet: '',
      confidence: 0,
      created_at: null,
    });
  });
});

describe('slugify', () => {
  it('caps the anchor at six words', () => {
    expect(slugify('Always use async/await instead of .then() chains everywhere')).toBe(
      'always-use-asyncawait-instead-of-then',
    );
  });

  it('never returns an empty anchor', () => {
    expect(slugify('!!!')).toBe('rule');
  });
});
