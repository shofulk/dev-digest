import { describe, it, expect } from 'vitest';
import type { LLMProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { MockGitClient } from '../../server/src/adapters/mocks.js';
import { reviewPullRequest } from '../src/index.js';

/**
 * T6 (red, L3) — `reviewPullRequest` with attached Project Context documents
 * (AC-28, AC-32). `specs` is a resolved `{ path, content }[]` and must reach
 * the model as part of the single assembled prompt (no extra LLM call), with
 * `assembly.specs` — the run trace's `prompt_assembly.specs` — containing
 * every document's path label. Today `assemblePrompt` labels every spec
 * `spec-${i}` (see T5), so the path-label assertion below is expected to fail
 * until a later lane implements the real D9 labelling.
 */
class FakeLLMProvider implements LLMProvider {
  readonly id = 'openai' as const;
  calls: StructuredRequest<unknown>[] = [];

  async listModels() {
    return [];
  }
  async complete() {
    return { text: '', model: 'fake', tokensIn: 0, tokensOut: 0, costUsd: null };
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push(req as StructuredRequest<unknown>);
    const review = {
      verdict: 'approve',
      summary: 'looks fine',
      score: 100,
      findings: [],
    } as unknown as T;
    return { data: review, model: req.model, tokensIn: 1, tokensOut: 1, costUsd: 0, raw: '{}', attempts: 1 };
  }
  async embed() {
    return [];
  }
}

describe('T6 — reviewPullRequest with attached Project Context (AC-28, AC-32)', () => {
  it('single-pass with specs makes exactly one LLM call, and assembly.specs contains every path label', async () => {
    const llm = new FakeLLMProvider();
    const diff = await new MockGitClient().diff();

    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'gpt-4.1',
      diff,
      llm,
      strategy: 'single-pass',
      specs: [
        { path: 'docs/architecture.md', content: 'module api/ does not import db/ directly' },
        { path: 'specs/rate-limiting.spec.md', content: 'rate limit rule' },
      ],
    });

    expect(llm.calls).toHaveLength(1);
    const sentUser = llm.calls[0]!.messages.find((m) => m.role === 'user')!.content;
    expect(outcome.assembly.specs).toBeTruthy();
    expect(sentUser).toContain(outcome.assembly.specs as string);
    expect(outcome.assembly.specs).toContain('docs/architecture.md');
    expect(outcome.assembly.specs).toContain('specs/rate-limiting.spec.md');
  });
});
