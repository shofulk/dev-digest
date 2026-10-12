// RING 2 — infrastructure adapter. The only place in the server that imports
// `node:fs` and `picomatch` for Project Context (`onion-architecture`). Real
// implementation of the `ProjectDocsSource` port (@devdigest/shared); resolved
// from `platform/container.ts`, never constructed by a ring-1 file.
import { promises as fs } from 'node:fs';
import { join, relative, sep } from 'node:path';
import picomatch from 'picomatch';
import type {
  ProjectDocEntry,
  ProjectDocRead,
  ProjectDocsListResult,
  ProjectDocsSource,
} from '@devdigest/shared';

/** Directories a scan never descends into, in addition to any dot-directory. */
const SKIP_DIRS = new Set(['node_modules', '.git']);

/**
 * Finds and reads `.md` documents under a repo's synced checkout.
 *
 * `list` walks the tree (skipping symlinks, dot-directories and
 * `node_modules`/`.git`), matching each `.md` file against the glob `roots`
 * (picomatch, `dot: false`). `read` re-checks syntax + roots, then resolves
 * the real path and requires it stay inside the checkout root (defends
 * against a symlink that escapes it) before stat/size-limit/read. Neither
 * method ever writes.
 */
export class FsProjectDocsSource implements ProjectDocsSource {
  async list(root: string, roots: string[], maxFiles: number): Promise<ProjectDocsListResult> {
    try {
      await fs.access(root);
    } catch (err) {
      // The checkout directory itself is missing — the service treats that
      // as "repository not synced" (AC-35), via this explicit outcome rather
      // than an errno the caller would have to interpret.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'root_missing' };
      throw err;
    }

    const matchers = roots.map((pattern) => picomatch(pattern, { dot: false }));
    const matchesAnyRoot = (relPath: string) => matchers.some((m) => m(relPath));

    const found: ProjectDocEntry[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
          await walk(abs);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          const relPath = relative(root, abs).split(sep).join('/');
          if (!matchesAnyRoot(relPath)) continue;
          try {
            const info = await fs.stat(abs);
            found.push({ path: relPath, size: info.size, mtimeMs: info.mtimeMs });
          } catch {
            // Deleted between readdir and stat — skip it, not a scan failure.
          }
        }
      }
    };
    await walk(root);
    found.sort((a, b) => a.path.localeCompare(b.path));

    const truncated = found.length > maxFiles;
    return { status: 'ok', files: found.slice(0, maxFiles), truncated };
  }

  async read(
    root: string,
    relPath: string,
    opts: { roots: string[]; maxBytes: number },
  ): Promise<ProjectDocRead> {
    if (!syntaxOk(relPath) || !this.matchesRoots(relPath, opts.roots)) {
      return { status: 'invalid_path' };
    }

    let realRoot: string;
    try {
      realRoot = await fs.realpath(root);
    } catch {
      return { status: 'missing' };
    }

    const candidate = join(root, relPath);
    let realTarget: string;
    try {
      realTarget = await fs.realpath(candidate);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
      return { status: 'invalid_path' };
    }

    // Containment check: the resolved file must stay under the resolved root —
    // defeats a symlink that points outside the checkout (EC-3/AC-26).
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
      return { status: 'invalid_path' };
    }

    // `realpath` above silently follows a symlink `relPath` may itself be (or
    // may pass through), so an in-checkout symlink such as `docs/x.md ->
    // ../.git/config` stays contained yet still leaks a non-`.md`, `.git/`
    // file. Re-check the RESOLVED, repo-relative path against the same
    // syntax/roots policy `relPath` already passed (dot:false already
    // excludes any `.git/` segment) before trusting it (AC-26).
    const realRelPath = relative(realRoot, realTarget).split(sep).join('/');
    if (!syntaxOk(realRelPath) || !this.matchesRoots(realRelPath, opts.roots)) {
      return { status: 'invalid_path' };
    }

    let info;
    try {
      info = await fs.stat(realTarget);
    } catch {
      return { status: 'missing' };
    }
    if (info.size > opts.maxBytes) return { status: 'too_large', size: info.size };

    const content = await fs.readFile(realTarget, 'utf8');
    return { status: 'ok', content, size: info.size };
  }

  matchesRoots(relPath: string, roots: string[]): boolean {
    return roots.some((pattern) => picomatch(pattern, { dot: false })(relPath));
  }
}

/**
 * Syntax-only check (D6), duplicated here rather than imported from
 * `modules/_shared/project-context/helpers.ts`: adapters never depend on a
 * module (`onion-architecture`, `adapters-dont-know-modules`).
 */
function syntaxOk(relPath: string): boolean {
  if (relPath.length === 0 || relPath.length > 512) return false;
  if (relPath.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(relPath)) return false;
  if (relPath.includes('\\')) return false;
  if (relPath.includes('\0')) return false;
  if (relPath.split('/').includes('..')) return false;
  if (!/\.md$/i.test(relPath)) return false;
  return true;
}
