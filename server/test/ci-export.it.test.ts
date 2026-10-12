import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockRunnerBundleSource,
  MockSecretsProvider,
  type MockGitHubOptions,
} from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[ci-export] Docker not available — skipping integration tests.');

const REPO = 'acme/payments-api';
const SECRET = 'sk-or-very-secret-value';
const WF_PATH = '.github/workflows/devdigest-review.yml';

d('CI export', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let agentId: string;
  let skillId: string;
  let foreignAgentId: string;
  const llm = new MockLLMProvider('openrouter');

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
    const db = pg.handle.db;
    const [repo] = await db.select().from(t.repos).where(eq(t.repos.fullName, REPO));
    repoId = repo!.id;
    const [agent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'CI Agent',
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        systemPrompt: 'Review.',
        version: 4,
      })
      .returning();
    agentId = agent!.id;
    const [skill] = await db
      .insert(t.skills)
      .values({ workspaceId, name: 'SQL rules', description: 'd', type: 'custom', source: 'manual', body: 'No raw SQL.' })
      .returning();
    skillId = skill!.id;
    await db.insert(t.agentSkills).values({ agentId, skillId, order: 0 });
    await db.insert(t.memory).values([
      { workspaceId, repoId, scope: 'repo', kind: 'fact', content: 'uses pnpm' },
      { workspaceId, repoId: null, scope: 'global', kind: 'fact', content: 'global one' },
    ]);
    const [ws2] = await db.insert(t.workspaces).values({ name: 'other' }).returning();
    const [foreign] = await db
      .insert(t.agents)
      .values({ workspaceId: ws2!.id, name: 'Foreign', provider: 'openai', model: 'm', systemPrompt: 'x' })
      .returning();
    foreignAgentId = foreign!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const installations = () =>
    pg.handle.db.select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, agentId));
  const clearInstallations = () =>
    pg.handle.db.delete(t.ciInstallations).where(eq(t.ciInstallations.agentId, agentId));

  async function makeApp(gh: MockGitHubOptions | 'none' = {}, runner: string | null = '// runner\n') {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const github = gh === 'none' ? undefined : new MockGitHubClient(gh);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        secrets: new MockSecretsProvider(gh === 'none' ? {} : { GITHUB_TOKEN: SECRET, OPENROUTER_API_KEY: SECRET }),
        runnerBundle: new MockRunnerBundleSource(runner),
        llm: { openrouter: llm },
        ...(github ? { github } : {}),
      },
    });
    return { app, github };
  }

  const preview = { repo_id: '', triggers: ['opened', 'synchronize'], post_as: 'github_review' };

  it('AC-1 / AC-3 / NFR-4: preview returns the five-kind bundle, runner as size only, repo memory only', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/ci/preview`,
      payload: { ...preview, repo_id: repoId },
    });
    expect(res.statusCode).toBe(200);
    const files = res.json().files as { path: string; contents: string | null; editable: boolean; size_bytes: number }[];
    expect(files.map((f) => f.path)).toEqual([
      `.devdigest/agents/ci-agent-${agentId.slice(0, 8)}.yaml`,
      `.devdigest/skills/sql-rules-${skillId.slice(0, 8)}.md`,
      '.devdigest/memory.jsonl',
      '.devdigest/runner/index.js',
      WF_PATH,
    ]);
    expect(files.map((f) => f.editable)).toEqual([false, false, false, false, true]);
    const runner = files[3]!;
    expect(runner.contents).toBeNull();
    expect(runner.size_bytes).toBe('// runner\n'.length);
    expect(files[2]!.contents).toBe('{"kind":"fact","content":"uses pnpm"}\n');
    expect(files[0]!.contents).toContain('version: 4');
    expect(llm.calls).toHaveLength(0);
    await app.close();
  });

  it('AC-3: memory is empty when the repo has no rows', async () => {
    await pg.handle.db.delete(t.memory).where(and(eq(t.memory.workspaceId, workspaceId), eq(t.memory.scope, 'repo')));
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/ci/preview`,
      payload: { ...preview, repo_id: repoId },
    });
    expect(res.json().files[2].contents).toBe('');
    await app.close();
    await pg.handle.db.insert(t.memory).values({ workspaceId, repoId, scope: 'repo', kind: 'fact', content: 'uses pnpm' });
  });

  it('NFR-6: a foreign agent or repo is 404 on preview, export and GET /agents/:id/ci', async () => {
    const { app } = await makeApp();
    for (const [method, url, payload] of [
      ['POST', `/agents/${foreignAgentId}/ci/preview`, { ...preview, repo_id: repoId }],
      ['POST', `/agents/${foreignAgentId}/export-ci`, { repo: REPO }],
      ['GET', `/agents/${foreignAgentId}/ci`, undefined],
      ['POST', `/agents/${agentId}/ci/preview`, { ...preview, repo_id: '00000000-0000-4000-8000-000000000000' }],
      ['POST', `/agents/${agentId}/export-ci`, { repo: 'nobody/nothing' }],
    ] as const) {
      const res = await app.inject({ method, url, payload });
      expect(res.statusCode, url).toBe(404);
    }
    await app.close();
  });

  it('AC-7 / AC-9 / AC-12: open_pr resets the branch, commits all paths, opens one PR, records pr_open', async () => {
    await clearInstallations();
    const { app, github } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo: REPO, action: 'open_pr', post_as: 'pr_comment', triggers: ['reopened', 'opened'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(github!.resets).toEqual([{ repo: expect.objectContaining({ name: 'payments-api' }), branch: 'devdigest/ci', toBranch: 'main' }]);
    expect(github!.committed).toHaveLength(1);
    expect(github!.committed[0]!.branch).toBe('devdigest/ci');
    expect(github!.committed[0]!.base).toBe('main');
    const paths = github!.committed[0]!.files.map((f) => f.path);
    expect(paths).toHaveLength(5);
    expect(github!.committed[0]!.files.find((f) => f.path.endsWith('index.js'))!.contents).toBe('// runner\n');
    expect(github!.openedPrs).toHaveLength(1);
    expect(github!.openedPrs[0]).toMatchObject({ title: 'Add DevDigest CI review', head: 'devdigest/ci', base: 'main' });
    for (const p of paths) expect(github!.openedPrs[0]!.body).toContain(p);
    expect(github!.openedPrs[0]!.body).toContain('OPENROUTER_API_KEY');
    expect(body.pr_url).toBe('https://github.com/mock/mock/pull/1');
    expect(body.files.find((f: { path: string }) => f.path.endsWith('index.js')).contents).toBeNull();
    const [row] = await installations();
    expect(row).toMatchObject({
      repo: REPO,
      status: 'pr_open',
      installedAgentVersion: 4,
      postAs: 'pr_comment',
      triggers: ['reopened', 'opened'],
      prUrl: 'https://github.com/mock/mock/pull/1',
    });
    expect(body.installation).toMatchObject({ status: 'pr_open', post_as: 'pr_comment', last_run: null });
    const wf = github!.committed[0]!.files.find((f) => f.path === WF_PATH)!.contents;
    expect(wf).toContain('types: [opened, reopened]');
    await app.close();
  });

  it('AC-8: an open PR is reused — no reset, no second PR, a new commit', async () => {
    const { app, github } = await makeApp({ openPr: { url: 'https://github.com/acme/payments-api/pull/9' } });
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/export-ci`, payload: { repo: REPO } });
    expect(res.statusCode).toBe(200);
    expect(res.json().pr_url).toBe('https://github.com/acme/payments-api/pull/9');
    expect(github!.resets).toHaveLength(0);
    expect(github!.openedPrs).toHaveLength(0);
    expect(github!.committed).toHaveLength(1);
    expect(github!.committed[0]!.branch).toBe('devdigest/ci');
    await app.close();
  });

  it('AC-10: edited workflow text is committed verbatim', async () => {
    const text = '# edited\nname: mine\n';
    const { app, github } = await makeApp();
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/export-ci`, payload: { repo: REPO, workflow: text } });
    expect(res.statusCode).toBe(200);
    expect(github!.committed[0]!.files.find((f) => f.path === WF_PATH)!.contents).toBe(text);
    await app.close();
  });

  it('AC-11: invalid workflow YAML is 422 invalid_workflow with the line and writes nothing', async () => {
    await clearInstallations();
    const { app, github } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo: REPO, workflow: 'a: 1\nb: 2\na: 3\n' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('invalid_workflow');
    expect(res.json().error.details.line).toBe(3);
    expect(github!.committed).toHaveLength(0);
    expect(github!.resets).toHaveLength(0);
    expect(github!.openedPrs).toHaveLength(0);
    expect(await installations()).toHaveLength(0);
    await app.close();
  });

  it('AC-12: files action stores manual and returns full contents; an active row stays active', async () => {
    await clearInstallations();
    const { app, github } = await makeApp();
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/export-ci`, payload: { repo: REPO, action: 'files' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().pr_url).toBeNull();
    expect(res.json().files.find((f: { path: string }) => f.path.endsWith('index.js')).contents).toBe('// runner\n');
    expect(github!.committed).toHaveLength(0);
    expect((await installations())[0]!.status).toBe('manual');
    await pg.handle.db.update(t.ciInstallations).set({ status: 'active' }).where(eq(t.ciInstallations.agentId, agentId));
    const again = await app.inject({ method: 'POST', url: `/agents/${agentId}/export-ci`, payload: { repo: REPO, action: 'open_pr' } });
    expect(again.statusCode).toBe(200);
    const [row] = await installations();
    expect(row!.status).toBe('active');
    expect(row!.prUrl).toBe('https://github.com/mock/mock/pull/1');
    await app.close();
  });

  it('AC-13: no token → 409 github_not_configured; installation unchanged', async () => {
    await clearInstallations();
    const { app } = await makeApp('none');
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/export-ci`, payload: { repo: REPO } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('github_not_configured');
    expect(await installations()).toHaveLength(0);
    await app.close();
  });

  it('AC-13: permission refusal → 403 github_permission with six permissions; other failure → 502', async () => {
    await clearInstallations();
    const perm = await makeApp({ failOn: { commitFiles: 'permission' } });
    const r1 = await perm.app.inject({ method: 'POST', url: `/agents/${agentId}/export-ci`, payload: { repo: REPO } });
    expect(r1.statusCode).toBe(403);
    expect(r1.json().error.code).toBe('github_permission');
    expect(r1.json().error.details.permissions).toHaveLength(6);
    await perm.app.close();
    const err = await makeApp({ failOn: { openPullRequest: 'error' } });
    const r2 = await err.app.inject({ method: 'POST', url: `/agents/${agentId}/export-ci`, payload: { repo: REPO } });
    expect(r2.statusCode).toBe(502);
    expect(r2.json().error.code).toBe('github_error');
    await err.app.close();
    expect(await installations()).toHaveLength(0);
  });

  it('NFR-5: no secret value reaches a response or a database row', async () => {
    await clearInstallations();
    const { app } = await makeApp();
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/export-ci`, payload: { repo: REPO } });
    expect(res.payload).not.toContain(SECRET);
    expect(JSON.stringify(await installations())).not.toContain(SECRET);
    await app.close();
  });

  it('D1: a missing runner file answers 500 config_error naming the build command', async () => {
    const { app } = await makeApp({}, null);
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/ci/preview`,
      payload: { ...preview, repo_id: repoId },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('config_error');
    expect(res.json().error.message).toContain('pnpm --dir ci build');
    await app.close();
  });

  it('AC-2: a disabled agent link or a disabled skill is left out of the manifest and the skill files', async () => {
    const db = pg.handle.db;
    const mk = async (name: string, enabled = true) =>
      (await db.insert(t.skills).values({ workspaceId, name, description: 'd', type: 'custom', source: 'manual', body: 'b', enabled }).returning())[0]!.id;
    const offLink = await mk('Off link');
    const offSkill = await mk('Off skill', false);
    await db.insert(t.agentSkills).values([
      { agentId, skillId: offLink, order: 1, enabled: false },
      { agentId, skillId: offSkill, order: 2 },
    ]);
    const { app } = await makeApp();
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/ci/preview`, payload: { ...preview, repo_id: repoId } });
    const files = res.json().files as { path: string; contents: string | null }[];
    expect(files.filter((f) => f.path.startsWith('.devdigest/skills/')).map((f) => f.path)).toEqual([
      `.devdigest/skills/sql-rules-${skillId.slice(0, 8)}.md`,
    ]);
    expect(files[0]!.contents).toContain(`sql-rules`);
    expect(files[0]!.contents).not.toContain('off-link');
    expect(files[0]!.contents).not.toContain('off-skill');
    await db.delete(t.agentSkills).where(inArray(t.agentSkills.skillId, [offLink, offSkill]));
    await app.close();
  });

  it('AC-3: memory rows of another repo and another workspace are absent', async () => {
    const db = pg.handle.db;
    const [other] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'elsewhere', fullName: 'acme/elsewhere', defaultBranch: 'main' })
      .returning();
    const [ws2] = await db.insert(t.workspaces).values({ name: 'memory ws' }).returning();
    const [repo2] = await db
      .insert(t.repos)
      .values({ workspaceId: ws2!.id, owner: 'acme', name: 'payments-api', fullName: 'acme/payments-api', defaultBranch: 'main' })
      .returning();
    await db.insert(t.memory).values([
      { workspaceId, repoId: other!.id, scope: 'repo', kind: 'fact', content: 'other repo row' },
      { workspaceId: ws2!.id, repoId: repo2!.id, scope: 'repo', kind: 'fact', content: 'other workspace row' },
    ]);
    const { app } = await makeApp();
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/ci/preview`, payload: { ...preview, repo_id: repoId } });
    const memory = res.json().files[2];
    expect(memory.path).toBe('.devdigest/memory.jsonl');
    expect(memory.contents).toBe('{"kind":"fact","content":"uses pnpm"}\n');
    await app.close();
  });

  it('AC-9: the calls go resetBranch, commitFiles, openPullRequest in that order', async () => {
    await clearInstallations();
    const order: string[] = [];
    class Recording extends MockGitHubClient {
      override async resetBranch(...a: Parameters<MockGitHubClient['resetBranch']>) {
        order.push('resetBranch');
        return super.resetBranch(...a);
      }
      override async commitFiles(...a: Parameters<MockGitHubClient['commitFiles']>) {
        order.push('commitFiles');
        return super.commitFiles(...a);
      }
      override async openPullRequest(...a: Parameters<MockGitHubClient['openPullRequest']>) {
        order.push('openPullRequest');
        return super.openPullRequest(...a);
      }
    }
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        secrets: new MockSecretsProvider({ GITHUB_TOKEN: SECRET }),
        runnerBundle: new MockRunnerBundleSource('// runner\n'),
        github: new Recording({}),
      },
    });
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/export-ci`, payload: { repo: REPO, action: 'open_pr' } });
    expect(res.statusCode).toBe(200);
    expect(order).toEqual(['resetBranch', 'commitFiles', 'openPullRequest']);
    await app.close();
  });

  it('AC-13: the 403 lists exactly the six permissions of D6', async () => {
    await clearInstallations();
    const { app } = await makeApp({ failOn: { commitFiles: 'permission' } });
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/export-ci`, payload: { repo: REPO } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.details.permissions).toEqual([
      'classic token: repo',
      'classic token: workflow',
      'fine-grained: Contents write',
      'fine-grained: Pull requests write',
      'fine-grained: Workflows write',
      'fine-grained: Actions read',
    ]);
    await app.close();
  });

  it('NFR-4: an export calls no model on any provider', async () => {
    await clearInstallations();
    const mocks = { openai: new MockLLMProvider('openai'), anthropic: new MockLLMProvider('anthropic'), openrouter: new MockLLMProvider('openrouter') };
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        secrets: new MockSecretsProvider({ GITHUB_TOKEN: SECRET }),
        runnerBundle: new MockRunnerBundleSource('// runner\n'),
        llm: mocks,
        github: new MockGitHubClient({}),
      },
    });
    for (const action of ['open_pr', 'files']) {
      const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/export-ci`, payload: { repo: REPO, action } });
      expect(res.statusCode).toBe(200);
    }
    for (const m of Object.values(mocks)) expect(m.calls).toHaveLength(0);
    await app.close();
  });

  it('NFR-5: the token never reaches a log line, on the happy path or on failures', async () => {
    await clearInstallations();
    const TOKEN = 'ghp_SECRET_TEST';
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    try {
      for (const gh of [{}, { failOn: { commitFiles: 'permission' } }, { failOn: { openPullRequest: 'error' } }] as MockGitHubOptions[]) {
        const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'info' } as NodeJS.ProcessEnv);
        const app = await buildApp({
          config,
          db: pg.handle.db,
          overrides: {
            git: new MockGitClient(),
            secrets: new MockSecretsProvider({ GITHUB_TOKEN: TOKEN }),
            runnerBundle: new MockRunnerBundleSource('// runner\n'),
            github: new MockGitHubClient(gh),
          },
        });
        await app.inject({ method: 'POST', url: `/agents/${agentId}/export-ci`, payload: { repo: REPO } });
        await app.close();
      }
    } finally {
      spy.mockRestore();
    }
    expect(written.length).toBeGreaterThan(0);
    expect(written.filter((l) => l.includes(TOKEN))).toEqual([]);
  });

  it('D12: preview and export answer 403 loopback_only from a non-loopback address, and touch nothing', async () => {
    await clearInstallations();
    const { app, github } = await makeApp();
    for (const headers of [undefined, { 'x-forwarded-for': '127.0.0.1' }]) {
      for (const [url, payload] of [
        [`/agents/${agentId}/ci/preview`, { ...preview, repo_id: repoId }],
        [`/agents/${agentId}/export-ci`, { repo: REPO }],
      ] as const) {
        const res = await app.inject({ method: 'POST', url, payload, headers, remoteAddress: '10.1.2.3' });
        expect(res.statusCode, url).toBe(403);
        expect(res.json().error.code).toBe('loopback_only');
      }
    }
    expect(github!.resets).toHaveLength(0);
    expect(github!.committed).toHaveLength(0);
    expect(github!.openedPrs).toHaveLength(0);
    expect(await installations()).toHaveLength(0);
    await app.close();
  });

  it('D12: a loopback address with a foreign Host header (DNS rebinding) answers 403 and writes nothing', async () => {
    await clearInstallations();
    const { app, github } = await makeApp();
    for (const [url, payload] of [
      [`/agents/${agentId}/ci/preview`, { ...preview, repo_id: repoId }],
      [`/agents/${agentId}/export-ci`, { repo: REPO }],
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url,
        payload,
        headers: { host: 'evil.example:3001' },
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error.code).toBe('loopback_only');
    }
    expect(github!.resets).toHaveLength(0);
    expect(github!.committed).toHaveLength(0);
    expect(github!.openedPrs).toHaveLength(0);
    expect(await installations()).toHaveLength(0);
    for (const host of ['localhost:3001', '127.0.0.1:3001', '[::1]:3001', 'LOCALHOST']) {
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/ci/preview`,
        payload: { ...preview, repo_id: repoId },
        headers: { host },
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode, host).not.toBe(403);
    }
    await app.close();
  });

  it('D12: 127.0.0.1 and ::1 are allowed; GET /agents/:id/ci is not guarded', async () => {
    const { app } = await makeApp();
    for (const remoteAddress of ['127.0.0.1', '::1']) {
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/ci/preview`,
        payload: { ...preview, repo_id: repoId },
        remoteAddress,
      });
      expect(res.statusCode, remoteAddress).not.toBe(403);
    }
    const get = await app.inject({ method: 'GET', url: `/agents/${agentId}/ci`, remoteAddress: '10.1.2.3' });
    expect(get.statusCode).not.toBe(403);
    await app.close();
  });
});
