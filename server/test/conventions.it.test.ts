import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AuthProvider, RunEvent } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

/**
 * The Conventions Extractor end to end: a code-picked sample goes to the model,
 * the code-side evidence gate drops what the model could not ground, the user
 * triages what is left, and the accepted rules assemble into a skill.
 *
 * The model is a fixture, so this suite is really about the two halves AROUND
 * it — the gate, the workspace scoping, the re-scan semantics and the SSE
 * replay the detached scan depends on — which is where the correctness lives.
 */

/** 1-based lines matter: the fixtures below cite them and the gate checks them. */
const USERS_TS = [
  'import { db } from "../db";', // 1
  '', // 2
  'export async function getUser(id: string) {', // 3
  '  const user = await db.users.find(id);', // 4
  '  if (!user) throw new NotFoundError("User not found");', // 5
  '  return user;', // 6
  '}', // 7
].join('\n');

const PACKAGE_JSON = ['{', '  "type": "module",', '  "private": true', '}'].join('\n');

const RULE_ERRORS = 'Throw NotFoundError for a missing row instead of returning null';
const RULE_IMPORTS = 'Relative imports omit the file extension';
const RULE_NAMING = 'Exported functions are named in camelCase and declared `export async function`';
const RULE_INVENTED = 'All route handlers return Result<T, ApiError>';
const RULE_MODULE = 'Packages declare `"type": "module"` and ship ESM only';

const errorsCandidate = {
  rule: RULE_ERRORS,
  rationale: 'Callers rely on the throw, never on a null check.',
  evidence_path: 'src/api/users.ts',
  evidence_line: 5,
  evidence_snippet: '  if (!user) throw new NotFoundError("User not found");',
  category: 'errors',
  occurrences: 4,
  confidence: 0.9,
};

const importsCandidate = {
  rule: RULE_IMPORTS,
  rationale: 'Matches the bundler resolution the repo assumes.',
  evidence_path: 'src/api/users.ts',
  evidence_line: 1,
  evidence_snippet: 'import { db } from "../db";',
  category: 'imports',
  occurrences: 2,
  confidence: 0.7,
};

const namingCandidate = {
  rule: RULE_NAMING,
  rationale: 'Every exported entry point in the sample follows it.',
  evidence_path: 'src/api/users.ts',
  evidence_line: 3,
  evidence_snippet: 'export async function getUser(id: string) {',
  category: 'naming',
  occurrences: 3,
  confidence: 0.6,
};

/** Cites a real file but code that is nowhere in it — the gate must drop it. */
const inventedCandidate = {
  rule: RULE_INVENTED,
  rationale: 'Invented — this code is nowhere in the sample.',
  evidence_path: 'src/api/users.ts',
  evidence_line: 4,
  evidence_snippet: 'function handler(): Result<Item[], ApiError> {',
  category: 'api',
  occurrences: 6,
  confidence: 0.95,
};

const moduleCandidate = {
  rule: RULE_MODULE,
  rationale: 'Stated outright by the manifest.',
  evidence_path: 'package.json',
  evidence_line: 2,
  evidence_snippet: '  "type": "module",',
  category: 'structure',
  occurrences: 1,
  confidence: 0.8,
};

/** Scan 1: three groundable rules and one invented one. */
const EXTRACTION = {
  candidates: [errorsCandidate, importsCandidate, inventedCandidate, namingCandidate],
};

/** Scan 2: re-proposes two already-decided rules, plus one genuinely new one. */
const RESCAN = { candidates: [errorsCandidate, importsCandidate, moduleCandidate] };

interface Candidate {
  id: string;
  rule: string;
  status: string;
  category: string;
  confidence: number;
  evidence_path: string;
  evidence_line: number | null;
  evidence_snippet: string;
}

interface ExtractResult {
  candidates: Candidate[];
  sampled_files: string[];
  proposed: number;
  dropped_ungrounded: number;
  dropped_duplicate: number;
  model: string;
}

d('conventions module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceA: string;
  let workspaceB: string;
  let userId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceA = ws!.id;
    const [user] = await pg.handle.db.select().from(t.users);
    userId = user!.id;
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${Date.now()}` })
      .returning();
    workspaceB = other!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** Only `getConventionSamples` is exercised; the rest of the facade is unused here. */
  const repoIntel = {
    getConventionSamples: async () => ['src/api/users.ts'],
  } as unknown as RepoIntel;

  let repoSeq = 0;
  /** A repo of its own per test, so no test depends on another's rows. */
  async function newRepo(workspaceId: string): Promise<string> {
    repoSeq += 1;
    const name = `billing-api-${repoSeq}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    return repo!.id;
  }

  /** `workspaceId` picks which tenant the app's requests run as. */
  function makeApp(structured: unknown = EXTRACTION, workspaceId = workspaceA) {
    const auth: AuthProvider = {
      currentUser: async () => ({ id: userId, email: 'test@example.com', name: 'Test' }),
      currentWorkspace: async () => ({ id: workspaceId, name: 'test-ws' }),
    };
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        auth,
        repoIntel,
        git: new MockGitClient({
          files: { 'src/api/users.ts': USERS_TS, 'package.json': PACKAGE_JSON },
        }),
        llm: {
          openai: new MockLLMProvider('openai', {
            structuredBySchema: { ConventionExtraction: structured },
          }),
          anthropic: new MockLLMProvider('anthropic', {
            structuredBySchema: { ConventionExtraction: structured },
          }),
        },
      },
    });
  }

  /**
   * Start a scan and wait for the bus to finish it. The route answers 202 and
   * the scan runs detached, so quiescence is `runBus.onDone` — never a sleep.
   */
  async function scan(app: FastifyInstance, repoId: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/scan` });
    expect(res.statusCode).toBe(202);
    const { scan_id: scanId } = res.json() as { scan_id: string };
    await new Promise<void>((resolve) => app.container.runBus.onDone(scanId, resolve));
    return scanId;
  }

  /** The terminal `result` event's payload, as the client would read it off SSE. */
  function resultOf(app: FastifyInstance, scanId: string): ExtractResult {
    const events = app.container.runBus.buffer(scanId) as RunEvent[];
    const done = events.find((e) => e.kind === 'result');
    expect(done, 'scan published no result event').toBeDefined();
    return (done!.data as { result: ExtractResult }).result;
  }

  async function list(app: FastifyInstance, repoId: string): Promise<Candidate[]> {
    const res = await app.inject({ url: `/repos/${repoId}/conventions` });
    expect(res.statusCode).toBe(200);
    return res.json() as Candidate[];
  }

  it('persists only VERIFIED candidates — the invented one never lands', async () => {
    const app = await makeApp();
    const repoId = await newRepo(workspaceA);
    const result = resultOf(app, await scan(app, repoId));

    expect(result.proposed).toBe(4);
    expect(result.dropped_ungrounded).toBe(1);
    expect(result.dropped_duplicate).toBe(0);
    expect(result.candidates.map((c) => c.rule)).not.toContain(RULE_INVENTED);

    // The sample is what CODE chose: the config wish-list plus repo-intel's pick.
    expect(result.sampled_files).toContain('package.json');
    expect(result.sampled_files).toContain('src/api/users.ts');

    const rows = await list(app, repoId);
    expect(rows.map((c) => c.rule)).toEqual([RULE_ERRORS, RULE_IMPORTS, RULE_NAMING]);
    expect(rows.every((c) => c.status === 'pending')).toBe(true);
    // Every survivor carries a real line and the file's own bytes.
    expect(rows[0]).toMatchObject({
      category: 'errors',
      evidence_path: 'src/api/users.ts',
      evidence_line: 5,
      evidence_snippet: 'if (!user) throw new NotFoundError("User not found");',
    });
    // …and the DB agrees with the API.
    const persisted = await pg.handle.db
      .select()
      .from(t.conventions)
      .where(eq(t.conventions.repoId, repoId));
    expect(persisted).toHaveLength(3);
    expect(persisted.every((r) => r.workspaceId === workspaceA)).toBe(true);

    await app.close();
  });

  it('scopes every read and write by workspace: B cannot see or touch A’s rows', async () => {
    const appA = await makeApp();
    const appB = await makeApp(EXTRACTION, workspaceB);
    const repoA = await newRepo(workspaceA);
    const repoB = await newRepo(workspaceB);

    await scan(appA, repoA);
    const mine = await list(appA, repoA);
    expect(mine.length).toBeGreaterThan(0);
    const foreignId = mine[0]!.id;

    // B sees nothing — neither through A's repo id nor through its own repo.
    expect(await list(appB, repoA)).toEqual([]);
    expect(await list(appB, repoB)).toEqual([]);

    // A foreign id is indistinguishable from a missing one: 404, never 403.
    const patched = await app404(appB, 'PATCH', `/conventions/${foreignId}`, { status: 'accepted' });
    const deleted = await app404(appB, 'DELETE', `/conventions/${foreignId}`);
    expect([patched, deleted]).toEqual([404, 404]);

    // …and the row is untouched.
    const [still] = await pg.handle.db
      .select()
      .from(t.conventions)
      .where(eq(t.conventions.id, foreignId));
    expect(still).toMatchObject({ status: 'pending', workspaceId: workspaceA });

    await appA.close();
    await appB.close();
  });

  it('re-scan keeps decided rules, never re-proposes them, and replaces pending rows', async () => {
    const app = await makeApp();
    const repoId = await newRepo(workspaceA);
    await scan(app, repoId);

    const first = await list(app, repoId);
    const accepted = first.find((c) => c.rule === RULE_ERRORS)!;
    const rejected = first.find((c) => c.rule === RULE_IMPORTS)!;
    const stillPending = first.find((c) => c.rule === RULE_NAMING)!;

    for (const [id, status] of [
      [accepted.id, 'accepted'],
      [rejected.id, 'rejected'],
    ] as const) {
      const res = await app.inject({ method: 'PATCH', url: `/conventions/${id}`, payload: { status } });
      expect(res.statusCode).toBe(200);
      expect((res.json() as Candidate).status).toBe(status);
    }

    // A second app so the model answers with the re-scan fixture.
    const rescanApp = await makeApp(RESCAN);
    const result = resultOf(rescanApp, await scan(rescanApp, repoId));
    expect(result.proposed).toBe(3);
    expect(result.dropped_duplicate).toBe(2); // both decided rules, suppressed

    const after = await list(rescanApp, repoId);
    const byId = new Map(after.map((c) => [c.id, c]));
    expect(byId.get(accepted.id)).toMatchObject({ status: 'accepted', rule: RULE_ERRORS });
    expect(byId.get(rejected.id)).toMatchObject({ status: 'rejected', rule: RULE_IMPORTS });
    // The undecided row from scan 1 was replaced, and the new rule took its place.
    expect(byId.has(stillPending.id)).toBe(false);
    expect(after.map((c) => c.rule).sort()).toEqual([RULE_ERRORS, RULE_MODULE, RULE_IMPORTS].sort());

    await app.close();
    await rescanApp.close();
  });

  it('drafts a skill from the accepted rules and writes NOTHING', async () => {
    const app = await makeApp();
    const repoId = await newRepo(workspaceA);
    await scan(app, repoId);

    const [repo] = await pg.handle.db.select().from(t.repos).where(eq(t.repos.id, repoId));
    const accepted = (await list(app, repoId)).find((c) => c.rule === RULE_ERRORS)!;
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${accepted.id}`,
      payload: { status: 'accepted', rule: 'Throw NotFoundError for a missing row' },
    });

    const before = await pg.handle.db.select().from(t.skills);
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const draft = res.json() as {
      name: string;
      type: string;
      body: string;
      evidence_files: string[];
      convention_ids: string[];
    };

    expect(draft.name).toBe(`${repo!.name}-conventions`);
    expect(draft.type).toBe('convention');
    expect(draft.body).toContain('Throw NotFoundError for a missing row');
    expect(draft.body).toContain('Detected in `src/api/users.ts:5`:');
    expect(draft.evidence_files).toEqual(['src/api/users.ts']);
    expect(draft.convention_ids).toEqual([accepted.id]);

    // A draft is a preview: the skills table is byte-for-byte what it was.
    const after = await pg.handle.db.select().from(t.skills);
    expect(after).toEqual(before);

    // Refusing to draft from nothing is a 422, not an empty skill.
    const empty = await app.inject({
      method: 'POST',
      url: `/repos/${await newRepo(workspaceA)}/conventions/skill`,
      payload: {},
    });
    expect(empty.statusCode).toBe(422);

    await app.close();
  });

  it('POST /skills/extracted persists the draft as an enabled `extracted` skill', async () => {
    const app = await makeApp();
    const repoId = await newRepo(workspaceA);
    await scan(app, repoId);
    const candidates = await list(app, repoId);
    for (const c of candidates.slice(0, 2)) {
      await app.inject({
        method: 'PATCH',
        url: `/conventions/${c.id}`,
        payload: { status: 'accepted' },
      });
    }

    const draft = (
      await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/skill`, payload: {} })
    ).json() as { name: string; description: string; type: string; body: string; evidence_files: string[] };

    const created = await app.inject({
      method: 'POST',
      url: '/skills/extracted',
      payload: {
        name: draft.name,
        description: draft.description,
        type: draft.type,
        body: draft.body,
        evidence_files: draft.evidence_files,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: draft.name,
      type: 'convention',
      source: 'extracted',
      enabled: true,
      version: 1,
      evidence_files: ['src/api/users.ts'],
    });

    const [row] = await pg.handle.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.id, (created.json() as { id: string }).id));
    expect(row).toMatchObject({ workspaceId: workspaceA, source: 'extracted', enabled: true });

    await app.close();
  });

  it('SSE replays the whole scan to a LATE subscriber, then terminates the stream', async () => {
    const app = await makeApp();
    const repoId = await newRepo(workspaceA);
    // Subscribe only AFTER the scan has finished — the replay-then-end path the
    // detached-scan design rests on. If it hung, this inject would never settle.
    const scanId = await scan(app, repoId);

    const sse = await app.inject({ url: `/conventions/scans/${scanId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');

    const stages = sse.payload
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.slice(5)) as RunEvent)
      .map((e) => (e.data as { stage: string }).stage);
    expect(stages).toEqual(['sampling', 'sampled', 'proposing', 'verifying', 'done']);

    await app.close();
  });

  it('reports an unsampleable repo as a scan error instead of calling the model', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { ConventionExtraction: EXTRACTION },
    });
    const app = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        auth: {
          currentUser: async () => ({ id: userId, email: 'test@example.com', name: 'Test' }),
          currentWorkspace: async () => ({ id: workspaceA, name: 'test-ws' }),
        },
        repoIntel: { getConventionSamples: async () => [] } as unknown as RepoIntel,
        git: new MockGitClient({ files: {} }),
        llm: { openai: llm, anthropic: llm },
      },
    });
    const repoId = await newRepo(workspaceA);
    const scanId = await scan(app, repoId);

    const events = app.container.runBus.buffer(scanId) as RunEvent[];
    const error = events.find((e) => e.kind === 'error');
    expect(error?.msg).toMatch(/clone|index|sample/i);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);
    expect(await list(app, repoId)).toEqual([]);

    await app.close();
  });
});

/** Inject and return the status code — keeps the tenancy assertions on one line. */
async function app404(
  app: FastifyInstance,
  method: 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
): Promise<number> {
  const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
  return res.statusCode;
}
