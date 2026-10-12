import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[project-context-fs-immutable] Docker not available — skipping integration tests.');
}

/**
 * Fix F6 (plan-verifier AC-36/T3) — the real `FsProjectDocsSource` (no mock
 * override) is exercised through every project-context route, and the full
 * fixture checkout tree (every file AND directory, with size/mtimeMs) is
 * snapshotted immediately before and immediately after each call. AC-36: the
 * API never writes, creates, renames or deletes a file in the checkout.
 *
 * `MockProjectDocsSource` (used by `project-context.it.test.ts`) never touches
 * a real filesystem at all, so it cannot catch a regression that makes the
 * real adapter — or a future service change — write into the checkout. This
 * is the one test in the suite that lets the real adapter run against a real
 * tmp-dir tree for that reason.
 */
type TreeEntry = { path: string; isDir: boolean; size: number; mtimeMs: number };

async function snapshotTree(root: string): Promise<TreeEntry[]> {
  const out: TreeEntry[] = [];
  async function walk(dir: string, relBase: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      const info = await lstat(abs);
      out.push({ path: rel, isDir: entry.isDirectory(), size: info.size, mtimeMs: info.mtimeMs });
      if (entry.isDirectory()) await walk(abs, rel);
    }
  }
  await walk(root, '');
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

d('project-context routes never mutate the checkout tree (F6/AC-36)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let root: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'devdigest-pcfs-immutable-'));
    await mkdir(join(root, 'docs', 'sub'), { recursive: true });
    await mkdir(join(root, 'specs'), { recursive: true });
    await mkdir(join(root, 'insights'), { recursive: true });
    await mkdir(join(root, '.git'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, 'docs', 'architecture.md'), '# Architecture\nmodule api/ does not import db/ directly');
    await writeFile(join(root, 'docs', 'sub', 'notes.md'), 'nested note');
    await writeFile(join(root, 'specs', 'spec1.md'), 'spec text');
    await writeFile(join(root, 'insights', 'note.md'), 'insight text');
    await writeFile(join(root, 'README.md'), 'not under a scanned root');
    await writeFile(join(root, '.git', 'config'), '[remote "origin"]\n\turl = https://example\n');
    await writeFile(join(root, 'node_modules', 'pkg', 'index.md'), 'skipped by SKIP_DIRS');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    // No `projectDocs` override — exercises the real `FsProjectDocsSource`
    // from `platform/container.ts`, not `MockProjectDocsSource`.
    return buildApp({ config, db: pg.handle.db });
  }

  async function insertRepo(clonePath: string) {
    const name = `payments-api-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    return repo!;
  }

  async function insertAgent(app: Awaited<ReturnType<typeof makeApp>>) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: `Agent-${randomUUID()}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'sys' },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  async function insertSkill() {
    const [row] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: `Skill-${randomUUID()}`,
        description: 'd',
        type: 'rubric',
        source: 'manual',
        body: 'body',
      })
      .returning();
    return row!;
  }

  it('AC-36/T3: GET /repos/:id/context leaves the checkout tree byte-for-byte unchanged', async () => {
    const app = await makeApp();
    const repo = await insertRepo(root);

    const before = await snapshotTree(root);
    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    const after = await snapshotTree(root);

    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(4); // docs/architecture.md, docs/sub/notes.md, specs/spec1.md, insights/note.md
    expect(after).toEqual(before);
    await app.close();
  });

  it('AC-36/T3: GET /repos/:id/context/file leaves the checkout tree byte-for-byte unchanged', async () => {
    const app = await makeApp();
    const repo = await insertRepo(root);

    const before = await snapshotTree(root);
    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/file?path=${encodeURIComponent('docs/architecture.md')}`,
    });
    const after = await snapshotTree(root);

    expect(res.statusCode).toBe(200);
    expect(res.json().content).toContain('module api/ does not import db/ directly');
    expect(after).toEqual(before);
    await app.close();
  });

  it('AC-36/T3: POST /repos/:id/context/reindex leaves the checkout tree byte-for-byte unchanged', async () => {
    const app = await makeApp();
    const repo = await insertRepo(root);

    const before = await snapshotTree(root);
    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/context/reindex` });
    const after = await snapshotTree(root);

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('done');
    expect(after).toEqual(before);
    await app.close();
  });

  it('AC-36/T3: PUT /agents/:id/context-docs leaves the checkout tree byte-for-byte unchanged', async () => {
    const app = await makeApp();
    await insertRepo(root); // not strictly needed by this route, but keeps the fixture consistent
    const agent = await insertAgent(app);

    const before = await snapshotTree(root);
    const res = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context-docs`,
      payload: { context_docs: ['docs/architecture.md', 'specs/spec1.md'] },
    });
    const after = await snapshotTree(root);

    expect(res.statusCode).toBe(200);
    expect(after).toEqual(before);
    await app.close();
  });

  it('AC-36/T3: PUT /skills/:id/context-docs leaves the checkout tree byte-for-byte unchanged', async () => {
    const app = await makeApp();
    await insertRepo(root); // kept for fixture parity with the other cases
    const skill = await insertSkill();

    const before = await snapshotTree(root);
    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}/context-docs`,
      payload: { context_docs: ['insights/note.md'] },
    });
    const after = await snapshotTree(root);

    expect(res.statusCode).toBe(200);
    expect(after).toEqual(before);
    await app.close();
  });

  it('AC-36/T3: the tree is still unchanged after all five route calls run back to back', async () => {
    const app = await makeApp();
    const repo = await insertRepo(root);
    const agent = await insertAgent(app);
    const skill = await insertSkill();

    const before = await snapshotTree(root);

    const get = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    const file = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/file?path=${encodeURIComponent('docs/architecture.md')}`,
    });
    const reindex = await app.inject({ method: 'POST', url: `/repos/${repo.id}/context/reindex` });
    const putAgent = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context-docs`,
      payload: { context_docs: ['docs/architecture.md'] },
    });
    const putSkill = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}/context-docs`,
      payload: { context_docs: ['docs/architecture.md'] },
    });

    const after = await snapshotTree(root);

    expect([get.statusCode, file.statusCode, reindex.statusCode, putAgent.statusCode, putSkill.statusCode]).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect(after).toEqual(before);
    await app.close();
  });
});
