// RING 1 — pure application logic. No DB, no container, no Fastify
// (`onion-architecture`). Imports only `@devdigest/shared` and `constants.ts`.
import type { SmartDiff, SmartDiffRole } from '@devdigest/shared';
import { ROLE_ORDER, SPLIT_THRESHOLD_LINES } from './constants.js';

// ---- Declarative matchers (D8) --------------------------------------------
// Small named predicates over a repo-relative, `/`-separated, case-sensitive
// path. `ROLE_RULES` below reads like the AC6 rule list because every entry
// is one of these, never a raw RegExp.

type Matcher = (path: string) => boolean;

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/** Exact basename match. */
function name(n: string): Matcher {
  return (path) => basename(path) === n;
}

/** Basename ends with `.${e}` — a single, literal extension. */
function ext(e: string): Matcher {
  return (path) => basename(path).endsWith(`.${e}`);
}

/** Whole path ends with a literal string (for compound endings like `.min.js`). */
function suffix(s: string): Matcher {
  return (path) => path.endsWith(s);
}

/** Basename starts with a literal string (for `README*`, `.env*`, …). */
function prefix(p: string): Matcher {
  return (path) => basename(path).startsWith(p);
}

/** Whole path contains a literal string (for `.config.`, `.generated.`). */
function infix(i: string): Matcher {
  return (path) => path.includes(i);
}

/** Any `/`-separated path segment equals `seg` — matches at any depth. */
function dir(seg: string): Matcher {
  return (path) => path.split('/').includes(seg);
}

/** The FIRST path segment equals `seg` (a repo-root folder). */
function root(seg: string): Matcher {
  return (path) => path.split('/')[0] === seg;
}

/**
 * Minimal glob: `*` matches any run of non-`/` characters, `{a,b}` is a
 * literal alternation. No dependency is added (C4) — this only covers the
 * two patterns AC6 needs (`tsconfig*.json`, `docker-compose*.y{a,}ml`).
 */
function glob(pattern: string): Matcher {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withBraces = escaped.replace(/\\\{([^}]*)\\\}/g, (_m, alts: string) =>
    `(${alts.split(',').join('|')})`,
  );
  const withStars = withBraces.replace(/\*/g, '[^/]*');
  const re = new RegExp(`^${withStars}$`);
  return (path) => re.test(basename(path)) || re.test(path);
}

// ---- Rule table (AC6, D7, D8) ----------------------------------------------
// Ordered `[role, matchers[]][]`; the first role whose matcher list has a hit
// wins. `core` is not listed — it is the fallback when nothing else matches.

const ROLE_RULES: [Exclude<SmartDiffRole, 'core'>, Matcher[]][] = [
  [
    'boilerplate',
    [
      suffix('.lock'),
      name('pnpm-lock.yaml'),
      name('package-lock.json'),
      name('yarn.lock'),
      dir('dist'),
      dir('build'),
      dir('__snapshots__'),
      ext('snap'),
      infix('.generated.'),
      suffix('.min.js'),
    ],
  ],
  [
    'tests',
    [
      suffix('.test.ts'),
      suffix('.test.tsx'),
      suffix('.it.test.ts'),
      suffix('.spec.ts'),
      dir('test'),
      dir('tests'),
      dir('__tests__'),
      root('e2e'),
    ],
  ],
  [
    'wiring',
    [
      name('index.ts'),
      name('index.js'),
      infix('.config.'),
      glob('tsconfig*.json'),
      prefix('.eslintrc'),
      prefix('.env'),
      glob('docker-compose*.y{a,}ml'),
      root('.github'),
      root('.claude'),
    ],
  ],
  [
    'docs',
    [
      ext('md'),
      root('docs'),
      prefix('README'),
      prefix('CHANGELOG'),
      name('LICENSE'),
    ],
  ],
];

/** Deterministic, first-match-wins classifier (AC6). Pure function of the path. */
export function classifyFile(path: string): SmartDiffRole {
  for (const [role, matchers] of ROLE_RULES) {
    if (matchers.some((m) => m(path))) return role;
  }
  return 'core';
}

// ---- Grouping + finding overlay (AC7) --------------------------------------

export interface SmartDiffInputFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface SmartDiffInputFinding {
  file: string;
  startLine: number;
  endLine: number;
  dismissedAt: Date | string | null;
}

/** Sorted, de-duplicated union of `startLine..endLine` for every open finding
 *  on `path` (D4: open = `dismissedAt == null`). */
function findingLinesFor(path: string, findings: SmartDiffInputFinding[]): number[] {
  const lines = new Set<number>();
  for (const f of findings) {
    if (f.file !== path || f.dismissedAt != null) continue;
    for (let l = f.startLine; l <= f.endLine; l += 1) lines.add(l);
  }
  return [...lines].sort((a, b) => a - b);
}

/**
 * Builds the deterministic `SmartDiff` DTO: role groups in `ROLE_ORDER`
 * (empty groups dropped, PR-file order kept inside a group), per-file open
 * finding lines, and the split-suggestion flag (AC7). No pseudocode summary
 * or proposed splits in P1 (O1/O2).
 */
export function buildSmartDiff(files: SmartDiffInputFile[], findings: SmartDiffInputFinding[]): SmartDiff {
  const byRole = new Map<SmartDiffRole, SmartDiffInputFile[]>();
  for (const file of files) {
    const role = classifyFile(file.path);
    const bucket = byRole.get(role);
    if (bucket) bucket.push(file);
    else byRole.set(role, [file]);
  }

  const groups = ROLE_ORDER.filter((role) => byRole.has(role)).map((role) => ({
    role,
    files: byRole.get(role)!.map((file) => ({
      path: file.path,
      pseudocode_summary: null,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: findingLinesFor(file.path, findings),
    })),
  }));

  const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);

  return {
    groups,
    split_suggestion: {
      too_big: totalLines > SPLIT_THRESHOLD_LINES,
      total_lines: totalLines,
      proposed_splits: [],
    },
  };
}
