import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { AgentManifest } from '@devdigest/shared/contracts/eval-ci';
import {
  slug,
  buildManifest,
  buildWorkflow,
  buildMemoryJsonl,
  buildPrBody,
  validateWorkflowYaml,
  manifestPath,
  skillPath,
} from '../src/modules/ci/helpers.js';

const agent = {
  id: '12345678-aaaa-bbbb-cccc-1234567890ab',
  name: 'Security Reviewer!',
  version: 3,
  provider: 'openrouter',
  model: 'anthropic/claude-sonnet-4',
  systemPrompt: 'You review code.\nBe strict: "quote" # not a comment',
  strategy: 'map-reduce',
  postAs: 'pr_comment',
  ciFailOn: 'warning',
} as const;

describe('slug and paths', () => {
  it('AC-2: slug lowercases, collapses non-alphanumerics, caps at 40 and falls back', () => {
    expect(slug('Security Reviewer!', 'agent')).toBe('security-reviewer-');
    expect(slug('x'.repeat(60), 'agent')).toHaveLength(40);
    expect(slug('', 'skill')).toBe('skill');
  });

  it('AC-2: file names carry the first 8 characters of the id', () => {
    expect(manifestPath(agent)).toBe('.devdigest/agents/security-reviewer--12345678.yaml');
    expect(skillPath({ id: 'abcdef0123', name: 'SQL' })).toBe('.devdigest/skills/sql-abcdef01.md');
  });
});

describe('buildManifest', () => {
  it('AC-2: round-trips through AgentManifest with every field and the skill order', () => {
    const text = buildManifest(agent, ['b-22222222', 'a-11111111']);
    const parsed = AgentManifest.parse(parse(text));
    expect(parsed).toEqual({
      agent_id: agent.id,
      name: agent.name,
      version: 3,
      provider: 'openrouter',
      model: agent.model,
      strategy: 'map-reduce',
      post_as: 'pr_comment',
      ci_fail_on: 'warning',
      skills: ['b-22222222', 'a-11111111'],
      system_prompt: agent.systemPrompt,
    });
    expect(Object.keys(parse(text))).toEqual([
      'agent_id', 'name', 'version', 'provider', 'model', 'strategy', 'post_as', 'ci_fail_on', 'skills', 'system_prompt',
    ]);
  });

  it('AC-2: an agent with no skills writes an empty list', () => {
    expect(AgentManifest.parse(parse(buildManifest(agent, []))).skills).toEqual([]);
  });
});

describe('buildWorkflow', () => {
  const wf = (t: Parameters<typeof buildWorkflow>[0]) => parse(buildWorkflow(t));

  it('AC-4: writes the chosen trigger types in canonical order', () => {
    expect(wf(['reopened', 'opened']).on.pull_request.types).toEqual(['opened', 'reopened']);
    expect(wf(['reopened', 'synchronize', 'opened']).on.pull_request.types).toEqual([
      'opened', 'synchronize', 'reopened',
    ]);
    expect(wf(['synchronize']).on.pull_request.types).toEqual(['synchronize']);
  });

  it('AC-5 / NFR-3: permissions, concurrency, timeout, runner, node, secrets, upload', () => {
    const w = wf(['opened']);
    expect(w.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
    expect(w.concurrency).toEqual({
      group: 'devdigest-review-${{ github.event.pull_request.number }}',
      'cancel-in-progress': true,
    });
    const job = w.jobs.review;
    expect(job['timeout-minutes']).toBe(15);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const steps = job.steps as Record<string, any>[];
    expect(steps.find((s) => s.uses === 'actions/setup-node@v4')?.with['node-version']).toBe(22);
    const run = steps.find((s) => s.run === 'node .devdigest/runner/index.js');
    expect(run?.env.OPENROUTER_API_KEY).toBe('${{ secrets.OPENROUTER_API_KEY }}');
    expect(run?.env.GITHUB_TOKEN).toBe('${{ secrets.GITHUB_TOKEN }}');
    const upload = steps.find((s) => s.uses === 'actions/upload-artifact@v4');
    expect(upload?.if).toBe('always()');
    expect(upload?.with.name).toBe('devdigest-result');
    expect(upload?.with.path).toBe('devdigest-result.json');
  });

  it('AC-5: devdigest/review-action@v1 appears only in a comment', () => {
    const lines = buildWorkflow(['opened']).split('\n').filter((l) => l.includes('devdigest/review-action@v1'));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.trim().startsWith('#')).toBe(true);
    expect(JSON.stringify(wf(['opened']))).not.toContain('review-action');
  });

  it('AC-6: the review job is skipped for pull requests from forks', () => {
    expect(wf(['opened']).jobs.review.if).toBe(
      'github.event.pull_request.head.repo.full_name == github.repository',
    );
  });

  it('AC-11: the generated workflow is valid YAML', () => {
    expect(validateWorkflowYaml(buildWorkflow(['opened']))).toEqual({ ok: true });
  });
});

describe('validateWorkflowYaml', () => {
  it('AC-11: reports the line of a duplicate key', () => {
    expect(validateWorkflowYaml('a: 1\nb: 2\na: 3\n')).toEqual({ ok: false, line: 3 });
  });

  it('AC-11: reports the line of an unclosed flow sequence', () => {
    const r = validateWorkflowYaml('on:\n  pull_request:\n    types: [opened, synchronize\njobs: {}\n');
    expect(r).toEqual({ ok: false, line: 4 });
  });
});

describe('memory and PR body', () => {
  it('AC-3: one {kind,content} JSON line per row, "" when none', () => {
    expect(buildMemoryJsonl([])).toBe('');
    const out = buildMemoryJsonl([
      { kind: 'fact', content: 'a\nb' },
      { kind: 'decision', content: 'c' },
    ]);
    const lines = out.trimEnd().split('\n');
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { kind: 'fact', content: 'a\nb' },
      { kind: 'decision', content: 'c' },
    ]);
  });

  it('AC-9: the PR body lists every path and the secret to add', () => {
    const body = buildPrBody(['.devdigest/memory.jsonl', '.github/workflows/devdigest-review.yml']);
    expect(body).toContain('.devdigest/memory.jsonl');
    expect(body).toContain('.github/workflows/devdigest-review.yml');
    expect(body).toContain('OPENROUTER_API_KEY');
  });
});
