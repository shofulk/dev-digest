/**
 * Onion-architecture rules for @devdigest/api — the machine-checkable subset of
 * .claude/skills/onion-architecture/SKILL.md.
 *
 * Install:   cp .claude/skills/onion-architecture/enforcement/dependency-cruiser.cjs \
 *              server/.dependency-cruiser.cjs
 * Run:       pnpm --dir server exec depcruise src --config .dependency-cruiser.cjs
 *
 * dependency-cruiser is already a server dependency (it also backs
 * src/adapters/depgraph), so this needs no install.
 *
 * Severity policy: `error` = clean today, keep it clean. `warn` = known
 * outstanding violations, named in the rule comment. Promote a rule to `error`
 * in the same commit that clears its last violation; never add a new violation
 * to a `warn` rule.
 */

// --- ring paths (keep in sync with the table in SKILL.md) -------------------
const EDGE = '^src/(server|app)\\.ts$|^src/modules/index\\.ts$|^src/modules/[^/]+/(routes|index)\\.ts$|^src/platform/(container|config)\\.ts$|^src/plugins/|^src/modules/_shared/context\\.ts$';
const PERSISTENCE = '^src/db/|^src/adapters/|^src/modules/[^/]+/repository(\\.ts$|/)|^src/platform/jobs\\.ts$';
const CORE = '^src/vendor/shared/';

const SDKS = [
  'octokit',
  '@octokit/',
  'openai',
  '@anthropic-ai/sdk',
  'simple-git',
  '@ast-grep/napi',
  '@vscode/ripgrep',
  'dependency-cruiser',
  'js-tiktoken',
  'graphology',
];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-fastify-below-edge',
      comment:
        'Fastify is ring 3. Only routes.ts, modules/index.ts, server.ts, plugins and ' +
        '_shared/context.ts may import it; a service that needs the request passes ' +
        'plain arguments and the Logger port instead.',
      severity: 'error',
      from: { path: '^src/', pathNot: EDGE },
      to: { dependencyTypes: ['npm'], path: '^(fastify|@fastify/|fastify-)' },
    },
    {
      name: 'no-orm-outside-persistence',
      comment:
        'Drizzle, postgres and db/schema are ring 2. Allowed only in db/**, ' +
        'adapters/**, modules/*/repository* and platform/jobs.ts. `db/client` is also ' +
        'allowed at the composition root (app.ts, container.ts), which owns the pool.\n' +
        'OUTSTANDING (do not add more): modules/{workspace,settings,pulls,polling}/routes.ts, ' +
        'modules/settings/feature-models.ts, modules/reviews/{run-executor,diff-loader}.ts, ' +
        'modules/repos/helpers.ts — all import db/schema for a row type; the fix is a named ' +
        'row type in db/rows.ts.',
      severity: 'warn',
      from: { path: '^src/', pathNot: `${PERSISTENCE}|^src/db/|${EDGE}` },
      to: { path: '^src/db/schema|drizzle-orm|/postgres/' },
    },
    {
      name: 'no-sdk-outside-adapters',
      comment:
        'One SDK, one adapter. A second import site means a port is missing from ' +
        '@devdigest/shared.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/adapters/|^src/platform/container\\.ts$' },
      to: {
        dependencyTypes: ['npm'],
        path: `^(${SDKS.map((s) => s.replace(/[/@.]/g, '\\$&')).join('|')})`,
      },
    },
    {
      name: 'adapters-dont-know-modules',
      comment:
        'Ring 2 never depends on ring 1/3. If an adapter needs a module\'s data, the ' +
        'data is passed in.\n' +
        'OUTSTANDING (do not add more): adapters/{depgraph,astgrep}/index.ts import ' +
        'modules/repo-intel/constants.ts; those constants belong in the adapter or in a ' +
        'ring-0 contract.',
      severity: 'warn',
      from: { path: '^src/adapters/' },
      to: { path: '^src/modules/|^src/platform/container\\.ts$' },
    },
    {
      name: 'core-stays-pure',
      comment:
        'vendor/shared is ring 0: Zod and its own files only. It is a mirror of ' +
        '@devdigest/shared — edit the source, not the mirror.',
      severity: 'error',
      from: { path: CORE },
      to: { pathNot: `${CORE}|node_modules/zod/` },
    },
    {
      name: 'routes-dont-touch-persistence',
      comment:
        'A handler parses, calls one service method and returns a DTO. Reaching the ' +
        'DB from ring 3 skips the use case entirely.\n' +
        'OUTSTANDING (do not add more): modules/{workspace,settings,pulls,polling}/routes.ts.',
      severity: 'warn',
      from: { path: '^src/modules/[^/]+/routes\\.ts$' },
      to: { path: '^src/db/(schema|client)|^src/modules/[^/]+/repository(\\.ts$|/)' },
    },
    {
      name: 'services-dont-import-routes',
      comment: 'Ring 1 never names ring 3.',
      severity: 'error',
      from: { path: '^src/modules/', pathNot: EDGE },
      to: { path: '^src/modules/[^/]+/routes\\.ts$|^src/(server|app)\\.ts$' },
    },
    {
      name: 'no-cross-module-internals',
      comment:
        'A module may not reach into another module\'s service/repository. Share ' +
        'through modules/_shared/, db/rows.ts, or a repository hung off the container.',
      // OUTSTANDING (do not add more): modules/repos/service.ts imports
      // modules/repo-intel/constants.ts.
      severity: 'warn',
      from: { path: '^src/modules/([^/]+)/', pathNot: `${EDGE}|^src/modules/_shared/` },
      to: {
        path: '^src/modules/([^/]+)/',
        pathNot: ['^src/modules/$1/', '^src/modules/_shared/'],
      },
    },
    {
      name: 'reviewer-core-stays-pure',
      comment:
        'reviewer-core is ring 0 for both consumers (studio + CI runner): no fastify, no ' +
        'db, no fs, no child_process, no GitHub. Its only side effect is the call through ' +
        'the injected LLMProvider — which is why the openai SDK is allowed there (it is ' +
        'the transport of OpenRouterProvider, the one adapter the package owns).\n' +
        'The paths are unanchored on purpose: pnpm resolves to ' +
        '../reviewer-core/node_modules/<pkg> and node_modules/.pnpm/<pkg>@<ver>/...',
      severity: 'error',
      from: { path: '^\\.\\./reviewer-core/src/' },
      to: {
        // `^src/` is the server: reviewer-core may not reach into it. The one
        // exception is vendor/shared — the contracts are ring 0 on both sides
        // (the alias @devdigest/shared resolves there).
        path:
          'node_modules/(fastify|drizzle-orm|postgres|octokit|simple-git|@ast-grep)/|' +
          '^src/|^node:(fs|child_process|net|http)',
        pathNot: '^src/vendor/shared/',
      },
    },
    {
      name: 'no-circular',
      comment:
        'A cycle means the two files are one module that has not admitted it yet.\n' +
        'OUTSTANDING (do not add more): container.ts <-> modules/repo-intel/service.ts ' +
        '(and through it the repo-intel pipeline) — the container constructs the service ' +
        'while the service takes the container; and modules/agents/helpers.ts <-> ' +
        'repository.ts.',
      severity: 'warn',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-dev-dep',
      comment: 'Runtime code must not import a devDependency.',
      severity: 'error',
      from: { path: '^src/', pathNot: '\\.test\\.ts$|^src/db/(seed|migrate|backfill)' },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require'] },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
