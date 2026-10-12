import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsProjectDocsSource } from '../src/adapters/project-docs/index.js';

/**
 * Fix F1 (security, round 1) — `read()` must not follow an IN-CHECKOUT
 * symlink to a file the same `.md` / roots / `dot:false` policy would
 * otherwise reject (e.g. `docs/x.md -> ../.git/config`): the old containment
 * check only verified the resolved target stayed under the checkout root, not
 * that it still satisfied the policy. An external symlink (escaping the
 * checkout) stays covered by `project-docs-adapter.test.ts`'s EC-3/AC-26 case
 * and is not repeated here.
 */

const DEFAULT_ROOTS = ['**/{specs,docs,insights}/**/*.md'];

describe('FsProjectDocsSource.read — in-checkout symlink (F1)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'devdigest-pcdocs-symlink-'));
    await mkdir(join(root, 'docs'), { recursive: true });
    await mkdir(join(root, '.git'), { recursive: true });
    await writeFile(join(root, 'docs', 'ok.md'), '# OK\n');
    await writeFile(join(root, '.git', 'config'), '[remote "origin"]\n\turl = https://x-access-token:SECRET@github.com/acme/payments-api\n');
    await writeFile(join(root, 'docs', 'secret.txt'), 'not markdown');
    // In-checkout symlink to a non-.md file.
    await symlink(join(root, 'docs', 'secret.txt'), join(root, 'docs', 'leak.md'));
    // In-checkout symlink straight into .git/.
    await symlink(join(root, '.git', 'config'), join(root, 'docs', 'gitleak.md'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('an in-checkout symlink to a non-.md file gives invalid_path', async () => {
    const source = new FsProjectDocsSource();
    const result = await source.read(root, 'docs/leak.md', { roots: DEFAULT_ROOTS, maxBytes: 500 });
    expect(result.status).toBe('invalid_path');
  });

  it('an in-checkout symlink into .git/ gives invalid_path', async () => {
    const source = new FsProjectDocsSource();
    const result = await source.read(root, 'docs/gitleak.md', { roots: DEFAULT_ROOTS, maxBytes: 500 });
    expect(result.status).toBe('invalid_path');
  });

  it('a plain, non-symlinked .md document still reads ok', async () => {
    const source = new FsProjectDocsSource();
    const result = await source.read(root, 'docs/ok.md', { roots: DEFAULT_ROOTS, maxBytes: 500 });
    expect(result).toMatchObject({ status: 'ok', content: '# OK\n' });
  });
});
