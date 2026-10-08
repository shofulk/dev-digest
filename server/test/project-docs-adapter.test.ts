import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsProjectDocsSource } from '../src/adapters/project-docs/index.js';

/**
 * T2 (red, L3) — the real `FsProjectDocsSource` adapter (ring 2) over a real
 * `os.tmpdir()` fixture tree. No mocks: this is the one place that exercises
 * the actual `node:fs` + `picomatch` walk and the `realpath` containment check
 * (D2). The adapter is currently INTERFACE ONLY (L1) — every method returns a
 * neutral placeholder — so every assertion below fails until a later lane
 * implements the real glob walk and path containment.
 */

const DEFAULT_ROOTS = ['**/{specs,docs,insights}/**/*.md'];

describe('T2 — FsProjectDocsSource.list (AC-1, AC-36, NFR-6)', () => {
  let root: string;
  let outsideDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'devdigest-pcdocs-'));
    outsideDir = await mkdtemp(join(tmpdir(), 'devdigest-pcdocs-outside-'));
    await mkdir(join(root, 'docs'), { recursive: true });
    await mkdir(join(root, 'specs'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(root, '.hidden'), { recursive: true });
    await writeFile(join(root, 'docs', 'architecture.md'), '# Architecture\n');
    await writeFile(join(root, 'specs', 'spec.md'), '# Spec\n');
    await writeFile(join(root, 'docs', 'notes.txt'), 'not markdown');
    await writeFile(join(root, 'node_modules', 'pkg', 'readme.md'), '# should be skipped\n');
    await writeFile(join(root, '.hidden', 'secret.md'), '# should be skipped\n');
    await writeFile(join(outsideDir, 'outside.md'), '# outside the root\n');
    await symlink(join(outsideDir, 'outside.md'), join(root, 'docs', 'linked.md'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  it('AC-1/AC-36: matches .md under the default roots, skips non-.md/node_modules/dot-dirs/symlinks, writes nothing', async () => {
    const source = new FsProjectDocsSource();
    const before = await stat(join(root, 'docs', 'architecture.md'));
    const { files } = await source.list(root, DEFAULT_ROOTS, 1000);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(['docs/architecture.md', 'specs/spec.md']);
    const after = await stat(join(root, 'docs', 'architecture.md'));
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
  });

  it('NFR-6: caps at maxFiles and reports truncated', async () => {
    const source = new FsProjectDocsSource();
    const { files, truncated } = await source.list(root, DEFAULT_ROOTS, 1);
    expect(files).toHaveLength(1);
    expect(truncated).toBe(true);
  });
});

describe('T2 — FsProjectDocsSource.read (AC-1, AC-26, AC-36, AC-38, EC-3)', () => {
  let root: string;
  let outsideDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'devdigest-pcdocs-read-'));
    outsideDir = await mkdtemp(join(tmpdir(), 'devdigest-pcdocs-read-outside-'));
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'a.md'), '# A\nhello');
    await writeFile(join(root, 'docs', 'big.md'), 'B'.repeat(2000));
    await writeFile(join(outsideDir, 'secret.md'), '# outside\n');
    await symlink(join(outsideDir, 'secret.md'), join(root, 'docs', 'escape.md'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  const roots = DEFAULT_ROOTS;

  it('AC-1/AC-36: reads an existing matching document, writes nothing, an unknown path is missing', async () => {
    const source = new FsProjectDocsSource();
    const before = await stat(join(root, 'docs', 'a.md'));
    const result = await source.read(root, 'docs/a.md', { roots, maxBytes: 500 });
    expect(result).toMatchObject({ status: 'ok', content: '# A\nhello' });
    const missing = await source.read(root, 'docs/nope.md', { roots, maxBytes: 500 });
    expect(missing.status).toBe('missing');
    const after = await stat(join(root, 'docs', 'a.md'));
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
  });

  it('EC-3/AC-26: a symlink that escapes the checkout root gives invalid_path', async () => {
    const source = new FsProjectDocsSource();
    const result = await source.read(root, 'docs/escape.md', { roots, maxBytes: 500 });
    expect(result.status).toBe('invalid_path');
  });

  it('AC-26: `../x.md` and an absolute path give invalid_path', async () => {
    const source = new FsProjectDocsSource();
    const traversal = await source.read(root, '../x.md', { roots, maxBytes: 500 });
    expect(traversal.status).toBe('invalid_path');
    const absolute = await source.read(root, '/etc/passwd', { roots, maxBytes: 500 });
    expect(absolute.status).toBe('invalid_path');
  });

  it('AC-26: a path that does not match any search root gives invalid_path', async () => {
    const source = new FsProjectDocsSource();
    const result = await source.read(root, 'docs/a.md', { roots: ['**/other/**/*.md'], maxBytes: 500 });
    expect(result.status).toBe('invalid_path');
  });

  it('AC-38: a document over the size limit gives too_large', async () => {
    const source = new FsProjectDocsSource();
    const result = await source.read(root, 'docs/big.md', { roots, maxBytes: 500 });
    expect(result.status).toBe('too_large');
  });

});
