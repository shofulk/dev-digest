/**
 * D13 — AC-34 opt-in eval runner. Costs real API calls; never wired into
 * `test`/`typecheck`/`lint` scripts and never referenced from `.github/**`.
 * Outside `src/`/`test/` — see `score.ts`'s header comment.
 *
 * Run manually: `DEVDIGEST_EVAL=1 EVAL_MODEL=<model> pnpm --dir server eval:project-context`.
 */
import type { LLMProvider } from '@devdigest/shared';
import { reviewPullRequest, OpenRouterProvider } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../src/adapters/git/diff-parser.js';
import { LocalSecretsProvider } from '../../src/adapters/secrets/local.js';
import { loadConfig } from '../../src/platform/config.js';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, DOCS } from './cases.js';
import { scoreCase } from './score.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERAL_REVIEWER_PROMPT_PATH = join(__dirname, '../../../docs/agent-prompts/general-reviewer.md');

export interface MainDeps {
  /** Test seam — bypasses the real `OpenRouterProvider` + secret lookup. */
  makeProvider?: (model: string) => LLMProvider;
}

/**
 * Runs the D13 cases once each, through `reviewPullRequest`. Never throws:
 * every failure mode (opted out, no key, a case failing) is reported via the
 * return value / printed lines, so the CLI entrypoint alone decides the
 * process exit code.
 */
export async function main(
  env: NodeJS.ProcessEnv = process.env,
  deps: MainDeps = {},
): Promise<'skipped' | 'passed' | 'failed'> {
  if (env.DEVDIGEST_EVAL !== '1') return 'skipped';
  if (env.CI && env.CI !== '') return 'skipped';

  // The CLI entrypoint below checks + prints + exits(2) for a missing
  // EVAL_MODEL BEFORE calling `main`, so a direct caller only hits this guard
  // if it skipped that check itself.
  const model = env.EVAL_MODEL;
  if (!model) return 'failed';

  let llm: LLMProvider | undefined;
  if (deps.makeProvider) {
    llm = deps.makeProvider(model);
  } else {
    const secrets = new LocalSecretsProvider(loadConfig(env).secretsPath, env);
    const apiKey = await secrets.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      console.error('OPENROUTER_API_KEY is not configured (Settings or ~/.devdigest/secrets.json)');
      return 'failed';
    }
    llm = new OpenRouterProvider(apiKey);
  }

  const systemPrompt = await readFile(GENERAL_REVIEWER_PROMPT_PATH, 'utf8');

  let allPassed = true;
  for (const c of CASES) {
    const diff = parseUnifiedDiff(c.diff);
    const outcome = await reviewPullRequest({
      systemPrompt,
      model,
      diff,
      llm,
      strategy: 'single-pass',
      specs: DOCS,
      task: `Review this change for violations of the attached project context documents.`,
    });
    const { pass, reason } = scoreCase(outcome.review.findings, c.expect);
    console.log(`${pass ? 'PASS' : 'FAIL'} ${c.name} — ${reason}`);
    if (!pass) allPassed = false;
  }

  return allPassed ? 'passed' : 'failed';
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.env.DEVDIGEST_EVAL === '1' && !process.env.CI && !process.env.EVAL_MODEL) {
    console.error('EVAL_MODEL is required, e.g. EVAL_MODEL=openai/gpt-4.1');
    process.exit(2);
  }
  main(process.env)
    .then((status) => {
      process.exit(status === 'failed' ? 1 : 0);
    })
    .catch((err) => {
      console.error('eval runner crashed:', err);
      process.exit(1);
    });
}
