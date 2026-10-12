// RING 1 — pure helpers of the CI module (`onion-architecture`). No I/O: builds the bundle
// texts (manifest, workflow, memory, PR body) and validates workflow YAML. The only
// third-party import is the pure `yaml` library.
import { parseDocument, stringify } from 'yaml';
import type { CiAgentResult, CiTrigger } from '@devdigest/shared/contracts/eval-ci';

export const CI_BRANCH = 'devdigest/ci';
export const CI_PR_TITLE = 'Add DevDigest CI review';
export const CI_SECRET_NAME = 'OPENROUTER_API_KEY';
export const WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';
export const RUNNER_PATH = '.devdigest/runner/index.js';
export const MEMORY_PATH = '.devdigest/memory.jsonl';
export const GITHUB_PERMISSIONS = [
  'classic token: repo',
  'classic token: workflow',
  'fine-grained: Contents write',
  'fine-grained: Pull requests write',
  'fine-grained: Workflows write',
  'fine-grained: Actions read',
];

const TRIGGER_ORDER: CiTrigger[] = ['opened', 'synchronize', 'reopened'];

/** Lowercase, every non-`[a-z0-9]` run becomes `-`, at most 40 characters. */
export function slug(text: string, fallback: string): string {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  return s === '' ? fallback : s;
}

const id8 = (id: string): string => id.slice(0, 8);

export function manifestPath(agent: { id: string; name: string }): string {
  return `.devdigest/agents/${slug(agent.name, 'agent')}-${id8(agent.id)}.yaml`;
}

/** The skill's file name without extension — also the key the manifest lists. */
export function skillKey(skill: { id: string; name: string }): string {
  return `${slug(skill.name, 'skill')}-${id8(skill.id)}`;
}

export function skillPath(skill: { id: string; name: string }): string {
  return `.devdigest/skills/${skillKey(skill)}.md`;
}

export interface ManifestAgent {
  id: string;
  name: string;
  version: number;
  provider: string;
  model: string;
  systemPrompt: string;
  strategy: string;
  postAs: string;
  ciFailOn: string;
}

/** The agent manifest YAML (keys in a fixed order); `skillKeys` are the ordered active skills. */
export function buildManifest(agent: ManifestAgent, skillKeys: string[]): string {
  return stringify(
    {
      agent_id: agent.id,
      name: agent.name,
      version: agent.version,
      provider: agent.provider,
      model: agent.model,
      strategy: agent.strategy,
      post_as: agent.postAs,
      ci_fail_on: agent.ciFailOn,
      skills: skillKeys,
      system_prompt: agent.systemPrompt,
    },
    { lineWidth: 0 },
  );
}

/** One `{"kind","content"}` JSON line per memory row; `""` when there is none. */
export function buildMemoryJsonl(rows: { kind: string; content: string }[]): string {
  return rows.map((r) => `${JSON.stringify({ kind: r.kind, content: r.content })}\n`).join('');
}

/** The shared review workflow. Trigger types are written in canonical order. */
export function buildWorkflow(triggers: CiTrigger[]): string {
  const types = TRIGGER_ORDER.filter((t) => triggers.includes(t)).join(', ');
  return `name: DevDigest review

on:
  pull_request:
    types: [${types}]

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: devdigest-review-\${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # Future placeholder (not published yet): uses: devdigest/review-action@v1
      - name: DevDigest review
        run: node ${RUNNER_PATH}
        env:
          ${CI_SECRET_NAME}: \${{ secrets.${CI_SECRET_NAME} }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          PR_NUMBER: \${{ github.event.pull_request.number }}
          HEAD_SHA: \${{ github.event.pull_request.head.sha }}
      - name: Upload result
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: devdigest-result
          path: devdigest-result.json
          if-no-files-found: ignore
`;
}

/** The pull-request body: every committed path, then the secret the user must add. */
export function buildPrBody(paths: string[]): string {
  return [
    'This pull request adds DevDigest CI review to the repository.',
    '',
    'Files:',
    ...paths.map((p) => `- \`${p}\``),
    '',
    `Add the repository secret \`${CI_SECRET_NAME}\` before merging (Settings, Secrets and variables, Actions).`,
    '',
  ].join('\n');
}

/** `{ ok: true }` for valid YAML, else the 1-based line of the first parse error. */
export function validateWorkflowYaml(text: string): { ok: true } | { ok: false; line: number } {
  const first = parseDocument(text).errors[0];
  if (!first) return { ok: true };
  return { ok: false, line: first.linePos?.[0].line ?? 1 };
}

const COUNT_MAX = 10_000;
const COST_MAX_USD = 100;
const DURATION_MAX_MS = 86_400_000;
const TEXT_MAX = 500;

const clampNum = (n: number, max: number): number => Math.min(max, Math.max(0, n));
const clampCount = (n: number): number => Math.floor(clampNum(n, COUNT_MAX));
const clampText = <T extends string | null>(s: T): T => (s === null ? s : (s.slice(0, TEXT_MAX) as T));

const PG_INT_MAX = 2_147_483_647;

/** An artifact's PR number is untrusted: only a positive `int4` is stored, anything else is null. */
export function artifactPrNumber(n: number): number | null {
  return Number.isInteger(n) && n > 0 && n <= PG_INT_MAX ? n : null;
}

/** Bound an untrusted artifact result before it is stored: counts, cost, duration and text. */
export function clampAgentResult(r: CiAgentResult): CiAgentResult {
  return {
    ...r,
    agent_id: clampText(r.agent_id),
    agent_version: clampCount(r.agent_version),
    critical: clampCount(r.critical),
    warning: clampCount(r.warning),
    suggestion: clampCount(r.suggestion),
    findings_count: clampCount(r.findings_count),
    blockers: clampCount(r.blockers),
    cost_usd: r.cost_usd === null ? null : clampNum(r.cost_usd, COST_MAX_USD),
    duration_ms: r.duration_ms === null ? null : clampNum(r.duration_ms, DURATION_MAX_MS),
    model: clampText(r.model),
    error_code: clampText(r.error_code),
  };
}
