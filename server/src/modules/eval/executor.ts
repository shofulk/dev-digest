import { reviewPullRequest } from '@devdigest/reviewer-core';
import {
  type EvalRunActualOutput,
  type LLMProvider,
  type ReviewStrategy,
  type UnifiedDiff,
} from '@devdigest/shared';
import { EVAL_TASK_LINE, evalPrDescription } from './helpers.js';

/**
 * Runs ONE frozen case through the review engine — ring 1. Persists nothing and
 * resolves nothing: the provider, the agent config and the skill bodies are handed
 * in, so the same case always sees the same inputs.
 *
 * Deliberately NOT passed to the engine: the repository map, caller digests, the
 * derived PR summary, curated notes, project documents and the provider session
 * id. An eval measures the agent's prompt and skills against a frozen diff, not
 * the studio's context assembly.
 */

type ActualFinding = NonNullable<EvalRunActualOutput['findings']>[number];

export interface ExecuteCaseInput {
  llm: LLMProvider;
  agent: { systemPrompt: string; model: string; strategy: ReviewStrategy };
  /** Resolved skill blocks, or `undefined` for none (the prompt then has no skills section). */
  skills: string[] | undefined;
  evalCase: { input_diff: string; input_meta: unknown };
  /** The unified-diff parser, injected by the composition edge (an adapter function). */
  parseDiff: (text: string) => UnifiedDiff;
}

export interface ExecutedCase {
  /** Findings that survived the grounding gate. */
  findings: ActualFinding[];
  groundingKept: number;
  groundingDropped: number;
  costUsd: number | null;
  durationMs: number;
}

export async function executeCase(input: ExecuteCaseInput): Promise<ExecutedCase> {
  const prDescription = evalPrDescription(input.evalCase.input_meta);

  const started = Date.now();
  const outcome = await reviewPullRequest({
    systemPrompt: input.agent.systemPrompt,
    model: input.agent.model,
    strategy: input.agent.strategy,
    llm: input.llm,
    diff: input.parseDiff(input.evalCase.input_diff),
    ...(input.skills ? { skills: input.skills } : {}),
    ...(prDescription ? { prDescription } : {}),
    task: EVAL_TASK_LINE,
  });

  return {
    findings: outcome.review.findings.map((f) => ({
      file: f.file,
      start_line: f.start_line,
      end_line: f.end_line,
      severity: f.severity,
      category: f.category,
      title: f.title,
    })),
    groundingKept: outcome.review.findings.length,
    groundingDropped: outcome.dropped.length,
    costUsd: outcome.costUsd,
    durationMs: Date.now() - started,
  };
}
