import { describe, it, expect, vi } from 'vitest';
import type { Finding, LLMProvider, Review } from '@devdigest/shared';
import { scoreCase } from '../evals/project-context/score.js';
import { main } from '../evals/project-context/run.js';
import { CASES } from '../evals/project-context/cases.js';

/**
 * T16 (impl, written here per S32/D13) — hermetic, no network, no `buildApp`.
 * Covers AC-34's scoring + runner wiring only; the real-model run (T17) is
 * manual and never automated.
 */

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    severity: 'CRITICAL',
    category: 'bug',
    title: 'violation',
    file: 'api/users.ts',
    start_line: 1,
    end_line: 1,
    rationale: 'cites docs/architecture.md',
    confidence: 0.9,
    kind: 'finding',
    ...overrides,
  };
}

describe('scoreCase', () => {
  const expect_ = { file: 'api/users.ts', line: 1, docPath: 'docs/architecture.md' };

  it('passes when file, line range and doc-path citation all match', () => {
    const result = scoreCase([finding()], expect_);
    expect(result.pass).toBe(true);
  });

  it('fails on a correct line that cites the wrong doc', () => {
    const result = scoreCase(
      [finding({ rationale: 'cites specs/other.md instead', title: 'violation' })],
      expect_,
    );
    expect(result.pass).toBe(false);
  });

  it('fails on a right citation on another line', () => {
    const result = scoreCase([finding({ start_line: 9, end_line: 9 })], expect_);
    expect(result.pass).toBe(false);
  });

  it('fails when there is no finding on the file at all', () => {
    const result = scoreCase([finding({ file: 'other.ts' })], expect_);
    expect(result.pass).toBe(false);
  });
});

function fakeLlmProvider(review: Review): LLMProvider {
  return {
    id: 'openrouter',
    listModels: vi.fn(),
    complete: vi.fn(),
    completeStructured: vi.fn().mockResolvedValue({
      data: review,
      model: 'test/model',
      tokensIn: 10,
      tokensOut: 10,
      costUsd: 0,
      raw: JSON.stringify(review),
      attempts: 1,
    }),
    embed: vi.fn(),
  } as unknown as LLMProvider;
}

describe('main (runner)', () => {
  it('returns "skipped" and never calls makeProvider when DEVDIGEST_EVAL is unset', async () => {
    const makeProvider = vi.fn();
    const status = await main({}, { makeProvider });
    expect(status).toBe('skipped');
    expect(makeProvider).not.toHaveBeenCalled();
  });

  it('returns "skipped" and never calls makeProvider under CI, even when opted in', async () => {
    const makeProvider = vi.fn();
    const status = await main({ DEVDIGEST_EVAL: '1', CI: 'true' }, { makeProvider });
    expect(status).toBe('skipped');
    expect(makeProvider).not.toHaveBeenCalled();
  });

  it('returns "passed" when every case gets a matching finding from the injected provider', async () => {
    const makeProvider = vi.fn(() =>
      fakeLlmProvider({
        verdict: 'request_changes',
        summary: 'violations found',
        score: 10,
        findings: CASES.map((c, i) =>
          finding({
            id: `f${i}`,
            file: c.expect.file,
            start_line: c.expect.line,
            end_line: c.expect.line,
            title: `Violates ${c.expect.docPath}`,
            rationale: `Violates ${c.expect.docPath}.`,
          }),
        ),
      }),
    );
    const status = await main({ DEVDIGEST_EVAL: '1', EVAL_MODEL: 'test/model' }, { makeProvider });
    expect(status).toBe('passed');
    expect(makeProvider).toHaveBeenCalledWith('test/model');
  });

  it('returns "failed" when EVAL_MODEL is missing', async () => {
    const makeProvider = vi.fn();
    const status = await main({ DEVDIGEST_EVAL: '1' }, { makeProvider });
    expect(status).toBe('failed');
    expect(makeProvider).not.toHaveBeenCalled();
  });
});
