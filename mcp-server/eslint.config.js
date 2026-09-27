// ESLint flat config — @devdigest/mcp-server.
//
// Enforces the C1 onion rings as per-ring ALLOWLISTS (rev 5 — replaces the earlier
// per-ring denylist, which a spelling absent from the list could bypass, e.g.
// `'../config'` extensionless or `'..'`): `src/domain/**` may import only its own `./`
// ring-0 files; `src/app/**` only `./` and `../domain/`; `src/adapters/**` may reach
// upward only into `../domain/`. Also bans `@devdigest/shared`/`server/**` everywhere
// (rev 3: the shared contracts are Zod 3 source and fail to typecheck under this
// package's Zod 4), the C5 stdout-is-the-JSON-RPC-channel rule (no console.log, no
// process.stdout.write outside the SDK transport), `process.env` confined to
// src/config.ts, and network access (fetch, globalThis/global/self.fetch, `node:http`
// and friends, `undici`) confined to src/adapters/** (rev 4/5). `moduleResolution:
// NodeNext` (tsconfig.json) additionally fails `typecheck` on an extensionless relative
// import — the two guards are complementary (R17). Flat-config rule *options* replace,
// never merge (R13): every block below that redeclares a rule repeats the full base list
// of that rule minus its one exemption — it does not just add to it.
// Severity encodes STATE, the repo convention: `error` = clean today.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const noSharedImport = [
  {
    group: ['@devdigest/shared', '@devdigest/shared/*'],
    message: 'mcp-server does not import @devdigest/shared (Zod 3 source fails under Zod 4). Declare local types in src/domain/contracts.ts instead.',
  },
  {
    group: ['../server/*', '../../server/*', '**/server/src/*'],
    message: 'mcp-server never imports from server/ — it is a client of the HTTP API only.',
  },
];

// Ring 0 — allowlist: only './x.js' same-ring imports; no package, no node:*, no '..' segment.
const DOMAIN_ONLY_LOCAL_IMPORTS = {
  regex: String.raw`^(?!\./)|/\.\.(/|$)`,
  message: 'src/domain/** may import only ./ ring-0 files — no package, no node:*, no parent directory.',
};
// Ring 1 — allowlist: './x.js' or '../domain/x.js' only.
const APP_ONLY_DOMAIN_IMPORTS = {
  regex: String.raw`^(?!\./|\.\./domain/)|/\.\.(/|$)`,
  message: 'src/app/** may import only ./ and ../domain/ — ring 0 and its own ring.',
};
// Ring 2 — a parent-relative import may only enter ../domain/ ('..', '../index', '../config[.js]', '../app', '../tools' are banned).
const ADAPTERS_NO_OUTER_IMPORTS = {
  regex: String.raw`^\.\.(/|$)(?!domain/)|/\.\.(/|$)`,
  message: 'src/adapters/** may import only ../domain/ upward — never a ring-3 root file, app or tools.',
};
// Network modules — banned everywhere except src/adapters/**.
const NETWORK_MODULE_IMPORTS = {
  regex: String.raw`^(node:)?(http|https|http2|net|tls|dgram)(/|$)|^undici(/|$)`,
  message: 'Network access lives only in src/adapters/**.',
};
const MCP_SDK_IMPORTS = { group: ['@modelcontextprotocol/*'], message: 'Only ring 3 (src/tools/**, server.ts, index.ts) knows the MCP SDK.' };

const noProcessEnv = { object: 'process', property: 'env', message: '`process.env` is read only in src/config.ts.' };
const noProcessStdout = { object: 'process', property: 'stdout', message: 'Nothing but MCP frames goes to stdout — log through src/log.ts (stderr).' };
// fetch by property — also catches `const { fetch } = globalThis` (no-restricted-properties checks ObjectPattern destructuring).
const noFetchProperties = [
  { object: 'globalThis', property: 'fetch', message: 'fetch() is only used in src/adapters/**.' },
  { object: 'global', property: 'fetch', message: 'fetch() is only used in src/adapters/**.' },
  { object: 'self', property: 'fetch', message: 'fetch() is only used in src/adapters/**.' },
];

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['error', { allow: ['error'] }],
      'no-restricted-imports': ['error', { patterns: [...noSharedImport, NETWORK_MODULE_IMPORTS] }],
      'no-restricted-globals': ['error', { name: 'fetch', message: 'fetch() is only used in src/adapters/**.' }],
      'no-restricted-properties': ['error', noProcessEnv, noProcessStdout, ...noFetchProperties],
    },
  },
  // Ring 0 — domain: allowlist, only ./ ring-0 files. No package, no node:*, no MCP SDK, no
  // fetch, no process.env.
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...noSharedImport, NETWORK_MODULE_IMPORTS, DOMAIN_ONLY_LOCAL_IMPORTS, MCP_SDK_IMPORTS] },
      ],
    },
  },
  // Ring 1 — application: allowlist, only ./ and ../domain/. No MCP SDK, no fetch.
  {
    files: ['src/app/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...noSharedImport, NETWORK_MODULE_IMPORTS, APP_ONLY_DOMAIN_IMPORTS, MCP_SDK_IMPORTS] },
      ],
    },
  },
  // Ring 2 — adapters: a parent-relative import may only enter ../domain/. No MCP SDK.
  // fetch() and process.env/process.stdout are the exemptions this block carries (config
  // still owns process.env's *reading*, constructor args only — but the ban on the global
  // is scoped to config.ts, and adapters never touch process.env or process.stdout either
  // way). No network-module ban here — this is the one ring allowed to talk to the network.
  {
    files: ['src/adapters/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...noSharedImport, ADAPTERS_NO_OUTER_IMPORTS, MCP_SDK_IMPORTS] },
      ],
      'no-restricted-globals': 'off',
      'no-restricted-properties': ['error', noProcessEnv, noProcessStdout],
    },
  },
  // config.ts is the sole place allowed to read process.env; it still may not write stdout
  // or reach for fetch (only src/adapters/http-api.ts talks to the network).
  {
    files: ['src/config.ts'],
    rules: {
      'no-restricted-properties': ['error', noProcessStdout, ...noFetchProperties],
    },
  },
  // log.ts is the sole place allowed to write to stderr via console.error / process.stderr.
  {
    files: ['src/log.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
      'no-console': 'off',
    },
  },
);
