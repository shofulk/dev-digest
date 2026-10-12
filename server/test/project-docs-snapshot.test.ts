import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsProjectDocsSource } from '../src/adapters/project-docs/index.js';

/**
 * F7 (fix-list round 2, T2) — a full-tree `lstat` snapshot of the checkout
 * (every path's directory/symlink flag, size and mtime) taken before and
 * after EACH individual `FsProjectDocsSource` call, asserted unchanged. This
 * is stronger than `project-docs-adapter.test.ts`'s single-file `stat`
 * check: it also catches an accidental write to any OTHER file, a new file
 * created as a side effect, or a symlink silently replaced/dereferenced.
 *
 * Covers every listed outcome: `list()`; `read()` → ok / missing / too_large
 * / invalid_path (four invalid_path shapes: `..` traversal, an in-checkout
 * symlink to a non-.md file, a symlink escaping the checkout, and a symlink
 * into `.git/`).
 */

const DEFAULT_ROOTS = ['**/{specs,docs,insights}/**/*.md'];

interface SnapshotEntry {
  path: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size: number;
  mtimeMs: number;
}

/** Full-tree `lstat` snapshot (never follows symlinks) of everything under `root`. */
async function snapshotTree(root: string): Promise<SnapshotEntry[]> {
  const entries: SnapshotEntry[] = [];
  const walk = async (dir: string, relBase: string): Promise<void> => {
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      const abs = join(dir, dirent.name);
      const relPath = relBase ? `${relBase}/${dirent.name}` : dirent.name;
      const st = await lstat(abs);
      entries.push({
        path: relPath,
        isDirectory: st.isDirectory(),
        isSymbolicLink: st.isSymbolicLink(),
        size: st.size,
        mtimeMs: st.mtimeMs,
      });
      if (st.isDirectory()) {
        await walk(abs, relPath);
      }
    }
  };
  await walk(root, '');
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

describe('F7 — FsProjectDocsSource: full-tree snapshot unchanged after every call', () => {
  let root: string;
  let outsideDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'devdigest-pcdocs-snapshot-'));
    outsideDir = await mkdtemp(join(tmpdir(), 'devdigest-pcdocs-snapshot-outside-'));
    await mkdir(join(root, 'docs'), { recursive: true });
    await mkdir(join(root, '.git'), { recursive: true });
    await writeFile(join(root, 'docs', 'ok.md'), '# OK\n');
    await writeFile(join(root, 'docs', 'big.md'), 'B'.repeat(2000));
    await writeFile(join(root, 'docs', 'secret.txt'), 'not markdown');
    await writeFile(
      join(root, '.git', 'config'),
      '[remote "origin"]\n\turl = https://x-access-token:SECRET@github.com/acme/payments-api\n',
    );
    await writeFile(join(outsideDir, 'secret.md'), '# outside the checkout\n');
    // In-checkout symlink to a non-.md file.
    await symlink(join(root, 'docs', 'secret.txt'), join(root, 'docs', 'leak.md'));
    // In-checkout symlink straight into .git/.
    await symlink(join(root, '.git', 'config'), join(root, 'docs', 'gitleak.md'));
    // Symlink escaping the checkout root entirely.
    await symlink(join(outsideDir, 'secret.md'), join(root, 'docs', 'escape.md'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  it('1. list() returns the matching docs and leaves the tree unchanged', async () => {
    const source = new FsProjectDocsSource();
    const before = await snapshotTree(root);
    const { files } = await source.list(root, DEFAULT_ROOTS, 1000);
    const after = await snapshotTree(root);
    expect(files.map((f) => f.path).sort()).toEqual(['docs/big.md', 'docs/ok.md']);
    expect(after).toEqual(before);
  });

  it('2. read() -> ok leaves the tree unchanged', async () => {
    const source = new FsProjectDocsSource();
    const before = await snapshotTree(root);
    const result = await source.read(root, 'docs/ok.md', { roots: DEFAULT_ROOTS, maxBytes: 500 });
    const after = await snapshotTree(root);
    expect(result).toMatchObject({ status: 'ok', content: '# OK\n' });
    expect(after).toEqual(before);
  });

  it('3. read() -> missing leaves the tree unchanged', async () => {
    const source = new FsProjectDocsSource();
    const before = await snapshotTree(root);
    const result = await source.read(root, 'docs/nope.md', { roots: DEFAULT_ROOTS, maxBytes: 500 });
    const after = await snapshotTree(root);
    expect(result.status).toBe('missing');
    expect(after).toEqual(before);
  });

  it('4. read() -> too_large leaves the tree unchanged', async () => {
    const source = new FsProjectDocsSource();
    const before = await snapshotTree(root);
    const result = await source.read(root, 'docs/big.md', { roots: DEFAULT_ROOTS, maxBytes: 10 });
    const after = await snapshotTree(root);
    expect(result).toMatchObject({ status: 'too_large', size: 2000 });
    expect(after).toEqual(before);
  });

  it('5. read() -> invalid_path for a `..` path leaves the tree unchanged', async () => {
    const source = new FsProjectDocsSource();
    const before = await snapshotTree(root);
    const result = await source.read(root, '../x.md', { roots: DEFAULT_ROOTS, maxBytes: 500 });
    const after = await snapshotTree(root);
    expect(result.status).toBe('invalid_path');
    expect(after).toEqual(before);
  });

  it('6. read() -> invalid_path for an in-checkout symlink to a non-.md file leaves the tree unchanged', async () => {
    const source = new FsProjectDocsSource();
    const before = await snapshotTree(root);
    const result = await source.read(root, 'docs/leak.md', { roots: DEFAULT_ROOTS, maxBytes: 500 });
    const after = await snapshotTree(root);
    expect(result.status).toBe('invalid_path');
    expect(after).toEqual(before);
  });

  it('7. read() -> invalid_path for a symlink escaping the checkout leaves the tree unchanged', async () => {
    const source = new FsProjectDocsSource();
    const before = await snapshotTree(root);
    const result = await source.read(root, 'docs/escape.md', { roots: DEFAULT_ROOTS, maxBytes: 500 });
    const after = await snapshotTree(root);
    expect(result.status).toBe('invalid_path');
    expect(after).toEqual(before);
  });

  it('8. read() -> invalid_path for a symlink into .git/ leaves the tree unchanged', async () => {
    const source = new FsProjectDocsSource();
    const before = await snapshotTree(root);
    const result = await source.read(root, 'docs/gitleak.md', { roots: DEFAULT_ROOTS, maxBytes: 500 });
    const after = await snapshotTree(root);
    expect(result.status).toBe('invalid_path');
    expect(after).toEqual(before);
  });
});
