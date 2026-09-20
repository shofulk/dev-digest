import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseSkillImport, type ImportResult } from '../src/modules/skills/import.js';

const md = (s: string) => strToU8(s);
const zip = (files: Record<string, string | Uint8Array>) =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v]),
    ),
  );

function ok(r: ImportResult) {
  if (!r.ok) throw new Error(`expected a preview, got ${r.error.code}: ${r.error.message}`);
  return r.preview;
}
function refused(r: ImportResult) {
  if (r.ok) throw new Error('expected a refusal, got a preview');
  return r.error;
}

describe('parseSkillImport — markdown', () => {
  it('takes a .md payload without front matter whole as the body', () => {
    const text = '# Null checks\n\nFlag unguarded dereferences.\n\n- one\n- two\n';
    const p = ok(parseSkillImport(md(text), 'null-checks.md'));
    expect(p.body).toBe(text);
    expect(p.source).toBe('imported_file');
    expect(p.truncated).toBe(false);
    expect(p.ignored).toEqual([]);
    expect(p.type).toBe('custom');
  });

  it('accepts .markdown and is case-insensitive on the extension', () => {
    expect(ok(parseSkillImport(md('# A\n\nbody'), 'A.MARKDOWN')).name).toBe('A');
  });

  it('derives name and description from front matter, and strips it from the body', () => {
    const text = '---\nname: api-contract-gate\ndescription: "Block breaking API changes"\ntype: security\n---\n\n# Ignored heading\n\nIgnored paragraph.\n';
    const p = ok(parseSkillImport(md(text), 'x.md'));
    expect(p).toMatchObject({
      name: 'api-contract-gate',
      description: 'Block breaking API changes',
      type: 'security',
    });
    // The scalars are consumed above; leaving them in would render as an artifact in the
    // preview and reach the model as prompt bytes.
    expect(p.body).toBe('# Ignored heading\n\nIgnored paragraph.\n');
  });

  it('joins a folded front-matter description', () => {
    const text = '---\nname: folded\ndescription: >-\n  first line\n  second line\n---\nbody\n';
    expect(ok(parseSkillImport(md(text), 'x.md')).description).toBe('first line second line');
  });

  it('falls back to the first heading and the paragraph after it', () => {
    const text = 'Preamble is skipped.\n\n# Flaky tests\n\nLook for sleeps\nand retries.\n\nSecond paragraph.\n';
    const p = ok(parseSkillImport(md(text), 'x.md'));
    expect(p.name).toBe('Flaky tests');
    expect(p.description).toBe('Look for sleeps and retries.');
  });

  it('does not read a code fence as the description', () => {
    const text = '# T\n\n```\nnot prose\n```\n\nReal prose.\n';
    expect(ok(parseSkillImport(md(text), 'x.md')).description).toBe('Real prose.');
  });

  it('falls back to the file name when there is no front matter or heading', () => {
    const p = ok(parseSkillImport(md('just some rules'), 'my-rules.md'));
    expect(p.name).toBe('my-rules');
    expect(p.description).toBe('just some rules');
  });

  it('ignores an unknown front-matter type', () => {
    expect(ok(parseSkillImport(md('---\ntype: bogus\n---\nx'), 'x.md')).type).toBe('custom');
  });

  it('refuses an empty file, an unsupported type and non-UTF-8 text', () => {
    expect(refused(parseSkillImport(new Uint8Array(), 'a.md')).code).toBe('empty');
    expect(refused(parseSkillImport(md('   \n'), 'a.md')).code).toBe('empty');
    expect(refused(parseSkillImport(md('x'), 'a.txt')).code).toBe('unsupported-type');
    expect(refused(parseSkillImport(new Uint8Array([0xff, 0xfe, 0xfd]), 'a.md')).code).toBe(
      'invalid-text',
    );
  });

  it('refuses a markdown payload over 1 MiB with a readable message', () => {
    const big = new Uint8Array(1024 * 1024 + 1).fill(97);
    const e = refused(parseSkillImport(big, 'big.md'));
    expect(e.code).toBe('too-large');
    expect(e.message).toContain('1 MiB');
  });
});

describe('parseSkillImport — archives', () => {
  it('prefers SKILL.md at the root over README.md and everything else', () => {
    const p = ok(
      parseSkillImport(
        zip({ 'README.md': '# Readme', 'SKILL.md': '# The skill\n\nCore.', 'a.md': '# a' }),
        'pack.zip',
      ),
    );
    expect(p.name).toBe('The skill');
    expect(p.body).toContain('Core.');
    expect(p.ignored).toContainEqual({ path: 'README.md', reason: 'not-markdown' });
    expect(p.ignored).toContainEqual({ path: 'a.md', reason: 'not-markdown' });
  });

  it('falls back to a root README.md, then the shallowest alphabetical *.md', () => {
    expect(ok(parseSkillImport(zip({ 'z.md': '# z', 'README.md': '# readme' }), 'p.zip')).name).toBe(
      'readme',
    );
    const p = ok(
      parseSkillImport(
        zip({ 'docs/deep/a.md': '# deep', 'docs/b.md': '# b', 'docs/a.md': '# a' }),
        'p.zip',
      ),
    );
    expect(p.name).toBe('a');
  });

  it('only counts SKILL.md at the root as the top-precedence file', () => {
    const p = ok(parseSkillImport(zip({ 'sub/SKILL.md': '# nested', 'top.md': '# top' }), 'p.zip'));
    expect(p.name).toBe('top');
  });

  it('falls back to the archive name when the core file has no title', () => {
    expect(ok(parseSkillImport(zip({ 'SKILL.md': 'plain rules' }), 'flaky-test-patterns.zip')).name).toBe(
      'flaky-test-patterns',
    );
  });

  it('reports executables and binaries in `ignored` and never reads them into the body', () => {
    const marker = 'CANARY-DO-NOT-LEAK';
    const p = ok(
      parseSkillImport(
        zip({
          'SKILL.md': '# Skill\n\nrules',
          'install.sh': `#!/bin/sh\necho ${marker}`,
          'scripts/run.py': `print("${marker}")`,
          'tools/build.js': `//${marker}`,
          Makefile: `all:\n\techo ${marker}`,
          'installer': marker,
          'logo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]),
          'notes.txt': 'plain',
          'empty-dir/': new Uint8Array(),
        }),
        'pack.zip',
      ),
    );
    expect(p.body).not.toContain(marker);
    expect(p.ignored).toEqual(
      expect.arrayContaining([
        { path: 'install.sh', reason: 'executable' },
        { path: 'scripts/run.py', reason: 'executable' },
        { path: 'tools/build.js', reason: 'executable' },
        { path: 'Makefile', reason: 'executable' },
        { path: 'installer', reason: 'executable' },
        { path: 'logo.png', reason: 'binary' },
        { path: 'notes.txt', reason: 'not-markdown' },
      ]),
    );
    expect(p.ignored.map((i) => i.path)).not.toContain('SKILL.md');
    expect(p.ignored.map((i) => i.path)).not.toContain('empty-dir/');
  });

  it('does not treat INSTALL.md as an executable and skips macOS archive junk', () => {
    const p = ok(
      parseSkillImport(
        zip({ 'SKILL.md': '# S', 'INSTALL.md': '# how', '__MACOSX/._SKILL.md': 'junk', '._x.md': 'j' }),
        'p.zip',
      ),
    );
    expect(p.ignored).toContainEqual({ path: 'INSTALL.md', reason: 'not-markdown' });
    expect(p.ignored).toContainEqual({ path: '__MACOSX/._SKILL.md', reason: 'not-markdown' });
    expect(p.name).toBe('S');
  });

  it('drops a markdown entry that is really binary content', () => {
    const p = ok(
      parseSkillImport(
        zip({ 'SKILL.md': '# S', 'AAA.md': new Uint8Array([0, 1, 2, 3]) }),
        'p.zip',
      ),
    );
    expect(p.ignored).toContainEqual({ path: 'AAA.md', reason: 'binary' });
  });

  it('refuses absolute and parent-escaping entry paths (zip-slip)', () => {
    for (const evil of ['../evil.md', 'a/../../evil.md', '/etc/passwd.md', 'C:\\evil.md', 'a\\..\\b.md']) {
      const e = refused(parseSkillImport(zip({ 'SKILL.md': '# ok', [evil]: 'x' }), 'p.zip'));
      expect(e.code, evil).toBe('path-traversal');
      expect(e.message).toContain('unsafe path');
    }
  });

  it('refuses an unsafe path even when the entry is not markdown', () => {
    expect(refused(parseSkillImport(zip({ 'SKILL.md': '# ok', '../x.png': 'x' }), 'p.zip')).code).toBe(
      'path-traversal',
    );
  });

  it('refuses more than 200 entries and accepts exactly 200', () => {
    const files = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}.txt`, 'x']));
    expect(
      refused(parseSkillImport(zip({ 'SKILL.md': '# s', ...files(200) }), 'p.zip')).code,
    ).toBe('too-many-entries');
    expect(ok(parseSkillImport(zip({ 'SKILL.md': '# s', ...files(199) }), 'p.zip')).ignored).toHaveLength(199);
  });

  it('refuses an archive that expands past 10 MiB although it is tiny compressed', () => {
    const bomb = new Uint8Array(11 * 1024 * 1024);
    const bytes = zip({ 'SKILL.md': '# s', 'data.txt': bomb });
    expect(bytes.byteLength).toBeLessThan(5 * 1024 * 1024);
    const e = refused(parseSkillImport(bytes, 'p.zip'));
    expect(e.code).toBe('uncompressed-too-large');
    expect(e.message).toContain('10 MiB');
  });

  it('refuses an archive file over 5 MiB', () => {
    const e = refused(parseSkillImport(new Uint8Array(5 * 1024 * 1024 + 1), 'p.zip'));
    expect(e.code).toBe('too-large');
    expect(e.message).toContain('5 MiB');
  });

  it('refuses an oversized markdown entry inside an archive', () => {
    const e = refused(
      parseSkillImport(zip({ 'SKILL.md': new Uint8Array(1024 * 1024 + 1).fill(97) }), 'p.zip'),
    );
    expect(e.code).toBe('too-large');
  });

  it('refuses a nested archive', () => {
    const inner = zip({ 'x.md': '# x' });
    for (const name of ['inner.zip', 'deep/thing.tar.gz', 'a.7z']) {
      const e = refused(parseSkillImport(zip({ 'SKILL.md': '# s', [name]: inner }), 'p.zip'));
      expect(e.code, name).toBe('nested-archive');
    }
  });

  it('refuses an archive with no markdown at all', () => {
    const e = refused(parseSkillImport(zip({ 'a.txt': 'x', 'run.sh': 'echo' }), 'p.zip'));
    expect(e.code).toBe('no-markdown');
    expect(e.message).toMatch(/no markdown/i);
  });

  it('refuses bytes that are not a zip', () => {
    expect(refused(parseSkillImport(md('definitely not a zip'), 'p.zip')).code).toBe('invalid-archive');
  });
});
