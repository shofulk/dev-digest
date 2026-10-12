import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/platform/config.js';
import { docTypeFor, checkDocPathSyntax } from '../src/modules/_shared/project-context/helpers.js';
import {
  resolveDocOrder,
  applyBudget,
  resolveProjectContext,
  countUsedBy,
} from '../src/modules/_shared/project-context/resolve.js';
import { MockProjectDocsSource } from '../src/adapters/mocks.js';
import type { Tokenizer } from '../src/adapters/tokenizer/index.js';

/**
 * T1 (red, L3) — hermetic unit tests for the Project Context pure helpers and
 * resolution. No `buildApp`, no DB, no network: every piece under test here is
 * ring-1 (`_shared/project-context/*`) or config parsing. Per spec D4/D6/D7.
 *
 * These are written against the SPEC, not the L1 skeleton — every exported
 * function in `_shared/project-context/{helpers,resolve}.ts` currently returns
 * a neutral placeholder (see each file's "INTERFACE ONLY (L1)" comment), so
 * every assertion below is expected to fail until a later lane implements the
 * real behaviour.
 */

/** A deterministic fake tokenizer: one token per non-whitespace char run of 4. */
const fakeTokenizer: Tokenizer = { count: (text: string) => Math.ceil(text.length / 4) };

describe('T1 — loadConfig: Project Context defaults + env override (AC-2)', () => {
  it('AC-2: defaults to the glob **/{specs,docs,insights}/**/*.md, budget 8000, limit 262144', () => {
    const config = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    expect(config.projectContext.roots).toEqual(['**/{specs,docs,insights}/**/*.md']);
    expect(config.projectContext.budgetTokens).toBe(8000);
    expect(config.projectContext.maxDocBytes).toBe(262144);
  });

  it('AC-2: PROJECT_CONTEXT_ROOTS is `;`-separated (commas would clash with brace globs)', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      PROJECT_CONTEXT_ROOTS: 'specs/**/*.md;docs/**/*.md',
    } as NodeJS.ProcessEnv);
    expect(config.projectContext.roots).toEqual(['specs/**/*.md', 'docs/**/*.md']);
  });

  it('PROJECT_CONTEXT_BUDGET_TOKENS and PROJECT_CONTEXT_MAX_DOC_BYTES override the defaults', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      PROJECT_CONTEXT_BUDGET_TOKENS: '500',
      PROJECT_CONTEXT_MAX_DOC_BYTES: '1024',
    } as NodeJS.ProcessEnv);
    expect(config.projectContext.budgetTokens).toBe(500);
    expect(config.projectContext.maxDocBytes).toBe(1024);
  });
});

describe('T1 — docTypeFor (D6)', () => {
  it('buckets by the first matching segment, else docs', () => {
    expect(docTypeFor('specs/rate-limiting.spec.md')).toBe('specs');
    expect(docTypeFor('docs/architecture.md')).toBe('docs');
    expect(docTypeFor('insights/INSIGHTS.md')).toBe('insights');
    expect(docTypeFor('random/other.md')).toBe('docs');
    expect(docTypeFor('a/specs/nested.md')).toBe('specs');
  });
});

describe('T1 — checkDocPathSyntax (D6)', () => {
  it('rejects absolute paths, `..` segments, backslashes and non-.md files, accepts a plain relative .md path', () => {
    expect(checkDocPathSyntax('/etc/passwd.md')).toBe(false);
    expect(checkDocPathSyntax('docs/../secret.md')).toBe(false);
    expect(checkDocPathSyntax('docs\\notes.md')).toBe(false);
    expect(checkDocPathSyntax('docs/notes.txt')).toBe(false);
    expect(checkDocPathSyntax('docs/architecture.md')).toBe(true);
  });
});

describe('T1 — resolveDocOrder (D7, AC-22, AC-41, EC-5)', () => {
  it('AC-41/EC-5: a path shared by the agent and a skill keeps only its first position, origin agent', () => {
    const order = resolveDocOrder(['a.md', 'b.md'], [
      { name: 'skillX', contextDocs: ['b.md', 'c.md'] },
    ]);
    expect(order).toEqual([
      { path: 'a.md', origin: 'agent' },
      { path: 'b.md', origin: 'agent' },
      { path: 'c.md', origin: 'skillX' },
    ]);
  });

  it('dedups across two skills by the FIRST skill to mention the path, in skill order', () => {
    const order = resolveDocOrder([], [
      { name: 'S1', contextDocs: ['x.md'] },
      { name: 'S2', contextDocs: ['x.md', 'y.md'] },
    ]);
    expect(order).toEqual([
      { path: 'x.md', origin: 'S1' },
      { path: 'y.md', origin: 'S2' },
    ]);
  });

  it('AC-43/EC-13: a skill left out of the `skills` argument contributes nothing to the resolved order', () => {
    // The caller (run executor) is responsible for passing only the agent's
    // enabled skills; resolveDocOrder itself must not silently reintroduce a
    // skill's docs that were never passed in.
    const order = resolveDocOrder(['a.md'], []);
    expect(order).toEqual([{ path: 'a.md', origin: 'agent' }]);
  });
});

describe('T1 — applyBudget (D7, AC-25, EC-2)', () => {
  it('drops whole items from the END of the order until the sum fits, keeps everything when it already fits', () => {
    const items = [
      { path: 'a.md', tokens: 400 },
      { path: 'b.md', tokens: 400 },
      { path: 'c.md', tokens: 400 },
    ];
    const kept = applyBudget(items, 700, (i) => i.tokens);
    expect(kept.map((i) => i.path)).toEqual(['a.md']);

    const fits = [{ path: 'x.md', tokens: 10 }, { path: 'y.md', tokens: 10 }];
    expect(applyBudget(fits, 100, (i) => i.tokens)).toHaveLength(2);
  });
});

describe('T1 — resolveProjectContext (D7, AC-24, AC-25, AC-26, AC-27, AC-38)', () => {
  const source = new MockProjectDocsSource({
    'docs/a.md': 'A'.repeat(40),
    'docs/toolarge.md': 'B'.repeat(2000),
  });
  const roots = ['**/docs/**/*.md'];

  it('AC-24/AC-26/AC-38: resolves included/missing/too_large/invalid_path per document', async () => {
    const result = await resolveProjectContext({
      checkoutRoot: '/repo',
      agentDocs: ['docs/a.md', 'docs/missing.md', 'docs/toolarge.md', '../evil.md'],
      skills: [],
      roots,
      budgetTokens: 10_000,
      maxDocBytes: 500,
      source,
      tokenizer: fakeTokenizer,
    });

    const statusOf = (path: string) => result.trace.find((d) => d.path === path)?.status;
    expect(statusOf('docs/a.md')).toBe('included');
    expect(statusOf('docs/missing.md')).toBe('missing');
    expect(statusOf('docs/toolarge.md')).toBe('too_large');
    expect(statusOf('../evil.md')).toBe('invalid_path');
    expect(result.specsRead).toEqual(['docs/a.md']);
    expect(result.specs).toEqual([{ path: 'docs/a.md', content: 'A'.repeat(40) }]);

    // AC-27 companion check: an empty resolved order gives specs: [].
    const empty = await resolveProjectContext({
      checkoutRoot: '/repo',
      agentDocs: [],
      skills: [],
      roots,
      budgetTokens: 1000,
      maxDocBytes: 500,
      source,
      tokenizer: fakeTokenizer,
    });
    expect(empty.specs).toEqual([]);
  });

  it('AC-25/EC-2: drops the last-resolved document when the resolved set exceeds the budget', async () => {
    const tightSource = new MockProjectDocsSource({
      'docs/a.md': 'A'.repeat(40),
      'docs/b.md': 'B'.repeat(40),
    });
    const result = await resolveProjectContext({
      checkoutRoot: '/repo',
      agentDocs: ['docs/a.md', 'docs/b.md'],
      skills: [],
      roots,
      budgetTokens: 10, // ~10 tokens: only the first document fits
      maxDocBytes: 500,
      source: tightSource,
      tokenizer: fakeTokenizer,
    });
    expect(result.specsRead).toEqual(['docs/a.md']);
    expect(result.trace.find((d) => d.path === 'docs/b.md')?.status).toBe('budget');
  });

  it('NFR-7: logLines never carry document content, only path/tokens/status-shaped text', async () => {
    const secretSource = new MockProjectDocsSource({ 'docs/a.md': 'TOP SECRET CONTENT' });
    const result = await resolveProjectContext({
      checkoutRoot: '/repo',
      agentDocs: ['docs/a.md'],
      skills: [],
      roots,
      budgetTokens: 1000,
      maxDocBytes: 500,
      source: secretSource,
      tokenizer: fakeTokenizer,
    });
    // At least one log line must be emitted for the one resolved document.
    expect(result.logLines.length).toBeGreaterThan(0);
    for (const line of result.logLines) {
      expect(line).not.toContain('TOP SECRET CONTENT');
    }
  });
});

describe('T1 — countUsedBy (D7, AC-5, AC-43, EC-13)', () => {
  it('counts a path once per agent that attaches it directly or via an enabled skill', () => {
    // Assumed usage shape: one entry per agent, carrying every path that
    // agent resolves to (directly or through an enabled skill). A disabled
    // skill's docs must never appear in an agent's entry.
    const usage = [
      { agentId: 'agent-1', paths: ['docs/a.md'] },
      { agentId: 'agent-2', paths: ['docs/a.md', 'docs/b.md'] },
      // agent-3 has the skill that owns docs/b.md DISABLED — it must not count.
      { agentId: 'agent-3', paths: [] },
    ];
    expect(countUsedBy(['docs/a.md'], usage)).toBe(2);
    expect(countUsedBy(['docs/b.md'], usage)).toBe(1);
    expect(countUsedBy(['docs/missing.md'], usage)).toBe(0);
  });
});
