# Onion architecture — before/after, from this codebase

Every pair below is real code from `server/src`. The "before" side is what the file looks
like today or what a plausible next edit would add; the "after" side is the shape the rules
in `SKILL.md` ask for.

## 1. Service locator → constructor resolution

`modules/repos/service.ts` and `modules/repo-intel/service.ts` keep the whole `Container`
and reach through it in method bodies. Nothing in the signature says the method touches
git, secrets and the job runner.

```ts
// ✗ before — modules/repos/service.ts:53
export class ReposService {
  constructor(private container: Container) {}

  private async cloneRepo(...) {
    const token = await this.container.secrets.get(GITHUB_TOKEN_SECRET);
    const { path } = await this.container.git.clone(...);
    await this.container.jobs.enqueue(workspaceId, INDEX_JOB_KIND, { ... });
  }
}
```

```ts
// ✓ after — the dependencies are visible, and a test needs no Container at all
export class ReposService {
  private readonly secrets: SecretsProvider;
  private readonly git: GitClient;
  private readonly jobs: JobRunner;

  constructor(container: Container) {
    this.secrets = container.secrets;
    this.git = container.git;
    this.jobs = container.jobs;
  }

  private async cloneRepo(...) {
    const token = await this.secrets.get(GITHUB_TOKEN_SECRET);
    const { path } = await this.git.clone(...);
    await this.jobs.enqueue(workspaceId, INDEX_JOB_KIND, { ... });
  }
}
```

The container is still the argument — that is the repo convention — but it is consumed
once, at construction. Ports that are resolved lazily and asynchronously
(`container.llm(id)`, `container.github()`) stay as calls; store the resolver, not the
container:

```ts
constructor(container: Container) {
  this.llm = (id: Provider) => container.llm(id);   // ✓ one capability, not the world
}
```

## 2. Ring 1 constructing a ring-2 concrete

```ts
// ✗ before — modules/reviews/service.ts:33
export class ReviewService {
  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);   // ring 1 knows the implementation
  }
}
```

`container.reviewRepo` already exists (`platform/container.ts:99`) precisely so this does
not have to happen:

```ts
// ✓ after — the composition root owns the instance and its lifetime
constructor(container: Container) {
  this.repo = container.reviewRepo;
  this.agents = container.agentsRepo;
}
```

The practical payoff is not purity: two `ReviewRepository` instances for one request mean
two places to add caching, and a test override on the container silently does not apply.

## 3. HTTP leaking below `routes.ts`

```ts
// ✗ before — a service that wants to log
async runReview(workspaceId: string, prId: string, req: FastifyRequest) {
  req.log.info({ prId }, 'review queued');
}
```

```ts
// ✓ after — modules/reviews/run-executor.ts:22 already defines the port
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

async runReview(workspaceId: string, prId: string, logger?: Logger) {
  logger?.info({ prId }, 'review queued');
}
```

`req.log` (pino) satisfies `Logger` structurally, so the route passes `req.log` and nothing
else changes. The same applies to tenancy: `getContext(container, req)` is ring 3 and runs
in the handler; services receive a plain `workspaceId: string`.

## 4. Route handler shape

```ts
// ✓ modules/reviews/routes.ts:30 — parse, call one service method, return a DTO
app.post('/pulls/:id/review', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(container, req);
  const body = RunRequest.parse(req.body ?? {});
  const targets = await service.resolveTargets(workspaceId, { ...body });
  const { runs, reviews } = await service.runReview(workspaceId, req.params.id, targets, req.log);
  return { pr_id: req.params.id, runs, reviews };
});
```

Note what is *not* here: no `db`, no `try/catch` mapping to status codes (the error handler
does that from `platform/errors.ts`), no decision about which agents to run —
`resolveTargets` owns that rule and throws `AppError('invalid_run_request', …, 400)`.

## 5. Row types: named once, imported everywhere

```ts
// ✗ before — the Drizzle expression spreading through ring 1 and ring 3
async executeRuns(..., repo: typeof schema.repos.$inferSelect, ...) { }
```

```ts
// ✓ after — db/rows.ts is the single naming site; the repository re-exports it
// db/rows.ts
export type RepoRow = typeof t.repos.$inferSelect;

// modules/reviews/run-executor.ts
import type { RepoRow } from '../../db/rows.js';
async executeRuns(..., repo: RepoRow, ...) { }
```

`db/rows.ts` already exists and explains itself: cross-cutting consumers reference a row
shape *without importing another module's data layer*. The rule is just to use it
consistently — `run-executor.ts:5` imports `AgentRow` from there and `$inferSelect` inline
from `db/schema.js` in the same file.

## 6. DTO is built, never cast

```ts
// ✓ modules/reviews/helpers.ts — an explicit mapper, side-effect free
export function findingRowToDto(row: FindingRow): ReviewDtoFinding {
  return { id: row.id, severity: row.severity as Finding['severity'], ... };
}
```

```ts
// ✗ the shortcut that couples the API contract to the table
return rows as unknown as ReviewDtoFinding[];
```

A column rename then silently changes the public API, and `fastify-type-provider-zod` is
the only thing that would notice — at runtime, in production.

## 7. A new adapter, end to end

Adding a Jira client:

1. **Ring 0** — declare the port in `server/src/vendor/shared/contracts/` and export it:
   ```ts
   export interface IssueTracker {
     getIssue(key: string): Promise<IssueMeta>;
   }
   ```
2. **Ring 2** — `src/adapters/issues/jira.ts` is the only file that imports the Jira SDK;
   the class declares `implements IssueTracker` and takes its token as a constructor
   argument. It does not read `process.env` and does not import `src/modules/**`.
3. **Ring 3** — `platform/container.ts` gains a lazy getter that pulls the token from
   `secrets` and an `issues?: IssueTracker` entry in `ContainerOverrides`.
4. **Tests** — a `MockIssueTracker` in `src/adapters/mocks.ts`, injected via the override.
   The service test stays hermetic (no Docker, no network).

If step 1 is skipped and the service imports the concrete class, every later step is
compromised: the override has nothing to override, and the SDK is now a ring-1 dependency.

## 8. What the rules do *not* ask for

- **Not** a repository per table. A repository that wraps a single `db.select()` with no
  aggregate boundary is a worse interface over Drizzle — `ReviewRepository` earns its keep
  because it owns reviews + findings + traces as one aggregate and enforces workspace
  scoping through the PR join (see `server/INSIGHTS.md`, 2026-09-17).
- **Not** a mapper between a domain entity and a row for every read path.
  `db/rows.ts` + a DTO mapper at the edge is the level this codebase has chosen.
- **Not** moving `platform/` files around. The split is a classification recorded in each
  file's header comment, not a folder move.
