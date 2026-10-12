/**
 * AC-34 eval scoring (D13) — pure, no network, no filesystem.
 *
 * Outside `src/` and `test/` on purpose (Risks: "Eval not type-checked"):
 * `server/tsconfig.json` only includes `src/**`, so this module is never
 * compiled by `pnpm typecheck`; `pnpm lint` and `test/project-context-eval-
 * score.test.ts` (which imports it directly) are the automated guards.
 */
import type { Finding } from '@devdigest/shared';

export interface EvalExpectation {
  file: string;
  line: number;
  docPath: string;
}

export interface ScoreResult {
  pass: boolean;
  reason: string;
}

/**
 * A case passes iff some grounded finding has `file === expect.file`,
 * `start_line <= expect.line <= end_line`, AND `title` or `rationale`
 * contains `expect.docPath` — the line alone is not enough; citing the right
 * document is what the eval is actually discriminating on.
 */
export function scoreCase(findings: Finding[], expect: EvalExpectation): ScoreResult {
  const onFile = findings.filter((f) => f.file === expect.file);
  if (onFile.length === 0) {
    return { pass: false, reason: `no finding on ${expect.file}` };
  }
  const onLine = onFile.filter((f) => f.start_line <= expect.line && expect.line <= f.end_line);
  if (onLine.length === 0) {
    return {
      pass: false,
      reason: `no finding on ${expect.file}:${expect.line} (found on ${onFile
        .map((f) => `${f.start_line}-${f.end_line}`)
        .join(', ')})`,
    };
  }
  const citing = onLine.filter(
    (f) => f.title.includes(expect.docPath) || f.rationale.includes(expect.docPath),
  );
  if (citing.length === 0) {
    return {
      pass: false,
      reason: `finding on ${expect.file}:${expect.line} does not cite ${expect.docPath}`,
    };
  }
  return { pass: true, reason: `cites ${expect.docPath} on ${expect.file}:${expect.line}` };
}
