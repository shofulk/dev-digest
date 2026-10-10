#!/usr/bin/env node
// dependencies-checker collector: read-only, zero dependencies, Node >= 22.
//
// Measures the direct and transitive dependencies of the standalone packages and writes
// one deterministic JSON document (deps.json, schemaVersion 1). The report is built only
// from that document; this script measures, the skill interprets.
//
// CLI
//   --root <dir>   repo root (default: three levels up from this script)
//   --pkg a,b      packages to analyse (default: server,client,reviewer-core,e2e,mcp-server)
//   --top N        length of each package's heaviest[] list (default: 10)
//   --offline      skip the outdated check, spawn no child process
//   --out <file>   write the JSON here (default: stdout); must lie outside --root
//
// The only thing written is --out. The only child processes are `pnpm outdated` and
// `npm outdated`, started with a fixed argv, no shell and a 60 s timeout.
//
// Size fields (bytes, from lstat blocks * 512, hard links counted once by inode, symlinks
// never followed, so the numbers are comparable with `du -sk`):
//   selfBytes        the dependency's own directory, without a nested node_modules
//   transitiveBytes  the dependency plus everything it pulls in (its closure)
//   exclusiveBytes   the closure minus the closures of every other direct dependency
//                    (what removing this one dependency would free)
//   nodeModulesBytes the whole node_modules of the package

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 1;
const DEFAULT_PKGS = ['server', 'client', 'reviewer-core', 'e2e', 'mcp-server'];
const NOT_INSTALLED = 'not installed, size unknown';
const OUTDATED_TIMEOUT_MS = 60_000;
const SOURCE_DIRS = ['src', 'test', 'lib'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage', '.turbo']);
const SOURCE_EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const ROOT_FILE_EXT = /\.(?:ts|mts|mjs|js|cjs)$/;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

function fail(message) {
  process.stderr.write(`collect.mjs: ${message}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const opts = { root: null, pkgs: DEFAULT_PKGS, top: 10, offline: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${arg} needs a value`);
      return v;
    };
    if (arg === '--root') opts.root = value();
    else if (arg === '--pkg') {
      opts.pkgs = value().split(',').map((s) => s.trim()).filter(Boolean);
      if (opts.pkgs.length === 0) fail('--pkg needs at least one package');
    } else if (arg === '--top') {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1) fail('--top needs a positive integer');
      opts.top = n;
    } else if (arg === '--offline') opts.offline = true;
    else if (arg === '--out') opts.out = value();
    else fail(`unknown argument ${arg}`);
  }
  return opts;
}

// ---------------------------------------------------------------- small helpers

const posix = (p) => p.split(path.sep).join('/');

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readJson(file) {
  const text = readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// tsconfig.json tolerates comments and trailing commas; JSON.parse does not.
function parseJsonc(text) {
  let stripped = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      stripped += c;
      if (c === '\\') stripped += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      stripped += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      stripped += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else stripped += c;
  }
  let out = '';
  inString = false;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (inString) {
      out += c;
      if (c === '\\') out += stripped[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === ',') {
      let j = i + 1;
      while (j < stripped.length && /\s/.test(stripped[j])) j++;
      if (stripped[j] !== '}' && stripped[j] !== ']') out += c;
    } else out += c;
  }
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canon(value[key]);
    return sorted;
  }
  return value;
}

// Resolve through the nearest existing ancestor so a symlinked parent cannot hide the
// real location of a not-yet-created --out file.
function realPathLoose(p) {
  const rest = [];
  let cur = path.resolve(p);
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// ---------------------------------------------------------------- disk walk

// Calls onFile(key, bytes) once per distinct inode below dir (dir itself included).
function walkDisk(dir, skipTopNodeModules, onFile) {
  const seen = new Set();
  const visit = (st) => {
    const key = `${st.dev}:${st.ino}`;
    if (seen.has(key)) return;
    seen.add(key);
    onFile(key, st.blocks * 512);
  };
  const stack = [[dir, true]];
  while (stack.length > 0) {
    const [current, top] = stack.pop();
    try {
      visit(fs.lstatSync(current));
    } catch {
      continue;
    }
    for (const ent of listDir(current)) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        if (top && skipTopNodeModules && ent.name === 'node_modules') continue;
        stack.push([full, false]);
      } else {
        try {
          visit(fs.lstatSync(full));
        } catch {
          // vanished while walking: ignore
        }
      }
    }
  }
}

function totalBytes(dir) {
  let total = 0;
  walkDisk(dir, false, (_key, bytes) => {
    total += bytes;
  });
  return total;
}

// Every installed package of a node_modules tree, found by real directory (symlinks are
// skipped, so a pnpm top-level link and its .pnpm target are one package, not two).
function discoverPackages(nm) {
  const found = [];
  const seenReal = new Set();
  const addPackage = (dir) => {
    const meta = readJson(path.join(dir, 'package.json'));
    if (!meta) return;
    let real;
    try {
      real = fs.realpathSync(dir);
    } catch {
      return;
    }
    if (seenReal.has(real)) return;
    seenReal.add(real);
    found.push({ name: meta.name ?? path.basename(dir), version: meta.version ?? null, real });
    const nested = path.join(dir, 'node_modules');
    if (isDir(nested)) scanDir(nested);
  };
  const scanDir = (dir) => {
    for (const ent of listDir(dir)) {
      if (ent.name.startsWith('.') || ent.isSymbolicLink() || !ent.isDirectory()) continue;
      const full = path.join(dir, ent.name);
      if (ent.name.startsWith('@')) {
        for (const sub of listDir(full)) {
          if (!sub.isSymbolicLink() && sub.isDirectory()) addPackage(path.join(full, sub.name));
        }
      } else addPackage(full);
    }
  };
  scanDir(nm);
  const virtualStore = path.join(nm, '.pnpm');
  for (const ent of listDir(virtualStore)) {
    const inner = path.join(virtualStore, ent.name, 'node_modules');
    if (ent.isDirectory() && isDir(inner)) scanDir(inner);
  }
  return found;
}

// ---------------------------------------------------------------- usage scan (D2)

function listSourceFiles(dir) {
  const files = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const ent of listDir(current)) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) stack.push(full);
      } else if (ent.isFile() && SOURCE_EXT.test(ent.name)) files.push(full);
    }
  }
  return files;
}

// Stylesheets reference tooling by name (an at-import of a CSS framework); they are never
// scanned for imports, only searched by name.
function cssTexts(root, dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const ent of listDir(current)) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) stack.push(full);
      } else if (ent.isFile() && ent.name.endsWith('.css')) {
        const text = readText(full);
        if (text !== null && text.length <= MAX_SOURCE_BYTES) out.push({ rel: posix(path.relative(root, full)), text });
      }
    }
  }
  return out.sort((a, b) => byString(a.rel, b.rel));
}

const SPECIFIER_RE =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\.mock\(\s*|\bimportActual\(\s*)(["'`])([^"'`\n]+)\1/g;
const TRIPLE_SLASH_RE = /\/\/\/\s*<reference\s+types=["']([^"']+)["']/g;

function moduleName(spec) {
  if (spec.startsWith('.') || spec.startsWith('/')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function lineOf(text, index) {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

function scanUsage(root, pkgName, pkgDir) {
  const imports = new Map();
  let builtinEvidence = null;
  const files = [];
  for (const sub of SOURCE_DIRS) {
    const dir = path.join(pkgDir, sub);
    if (isDir(dir)) files.push(...listSourceFiles(dir));
  }
  const rootFiles = [];
  for (const ent of listDir(pkgDir)) {
    if (ent.isFile() && ROOT_FILE_EXT.test(ent.name)) rootFiles.push(path.join(pkgDir, ent.name));
  }
  files.push(...rootFiles);
  // vendor/ is compiled, so its imports count, but a non-vendor file is better evidence.
  const isVendor = (f) => posix(f).includes('/vendor/');
  files.sort((a, b) => Number(isVendor(a)) - Number(isVendor(b)) || byString(a, b));
  const rootTexts = [];
  const allTexts = [];
  for (const sub of SOURCE_DIRS) {
    const dir = path.join(pkgDir, sub);
    if (isDir(dir)) rootTexts.push(...cssTexts(root, dir));
  }
  for (const file of files) {
    let text;
    try {
      if (fs.statSync(file).size > MAX_SOURCE_BYTES) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = posix(path.relative(root, file));
    if (rootFiles.includes(file)) rootTexts.push({ rel, text });
    allTexts.push({ rel, text });
    const note = (spec, index) => {
      if (spec.startsWith('node:')) {
        builtinEvidence ??= `${rel}:${lineOf(text, index)}`;
        return;
      }
      const name = moduleName(spec);
      if (name && !imports.has(name)) imports.set(name, `${rel}:${lineOf(text, index)}`);
    };
    for (const m of text.matchAll(SPECIFIER_RE)) note(m[2], m.index);
    for (const m of text.matchAll(TRIPLE_SLASH_RE)) note(m[1], m.index);
  }
  return { imports, builtinEvidence, rootTexts, allTexts };
}

function binNames(meta, depName) {
  if (!meta || !meta.bin) return [];
  if (typeof meta.bin === 'string') return [depName.split('/').pop()];
  return Object.keys(meta.bin);
}

function classify(dep, ctx) {
  const { usage, scripts, tsTypes, depMeta, peerOf } = ctx;
  const imported = usage.imports.get(dep);
  if (imported) return { usage: 'imported', usageEvidence: imported };
  if (dep.startsWith('@types/')) {
    const base = dep.slice('@types/'.length);
    const mapped = base.includes('__') ? `@${base.replace('__', '/')}` : base;
    const via = usage.imports.get(mapped);
    if (via) return { usage: 'types', usageEvidence: via };
    if (tsTypes.includes(base) || tsTypes.includes(dep)) {
      return { usage: 'types', usageEvidence: 'tsconfig:types' };
    }
    if (base === 'node' && usage.builtinEvidence) {
      return { usage: 'types', usageEvidence: usage.builtinEvidence };
    }
  }
  if (tsTypes.some((t) => t === dep || t.startsWith(`${dep}/`))) {
    return { usage: 'types', usageEvidence: 'tsconfig:types' };
  }
  const names = [dep, ...binNames(depMeta, dep)];
  for (const scriptName of Object.keys(scripts).sort()) {
    const body = scripts[scriptName];
    if (typeof body !== 'string') continue;
    for (const n of names) {
      const re = new RegExp(`(^|[\\s;&|()"'=/])${escapeRegExp(n)}(?=$|[\\s;&|()"'])`);
      if (re.test(body)) return { usage: 'tooling', usageEvidence: `script:${scriptName}` };
    }
  }
  const quoted = new RegExp(`(["'\`])${escapeRegExp(dep)}\\1`);
  for (const { rel, text } of usage.allTexts) {
    const m = quoted.exec(text);
    if (m) return { usage: 'tooling', usageEvidence: `${rel}:${lineOf(text, m.index)}` };
  }
  if (peerOf.has(dep)) return { usage: 'tooling', usageEvidence: `peer-of:${peerOf.get(dep)}` };
  const nameRe = new RegExp(`(?<![\\w@./-])${escapeRegExp(dep)}(?![\\w-])`);
  for (const { rel, text } of usage.rootTexts) {
    const m = nameRe.exec(text);
    if (m) return { usage: 'tooling', usageEvidence: `${rel}:${lineOf(text, m.index)}` };
  }
  return { usage: 'unused-candidate', usageEvidence: null };
}

// ---------------------------------------------------------------- outdated (D3)

function firstLine(text) {
  const line = String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.slice(0, 200);
}

function runOutdated(pkgDir, lockfile, installed, offline) {
  const skipped = (note) => ({ status: 'skipped', note, map: null });
  if (offline) return Promise.resolve(skipped('offline: --offline given, outdated check not run'));
  if (!installed) return Promise.resolve(skipped(`${NOT_INSTALLED}: outdated check needs node_modules`));
  let cmd;
  let args;
  if (lockfile === 'pnpm-lock.yaml') {
    cmd = 'pnpm';
    args = ['outdated', '--format', 'json'];
  } else if (lockfile === 'package-lock.json') {
    cmd = 'npm';
    args = ['outdated', '--json'];
  } else return Promise.resolve(skipped('no lockfile: no package manager to ask'));
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: pkgDir, timeout: OUTDATED_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && err.killed) return resolve(skipped(`${cmd} outdated timed out after 60 s`));
        if (err && err.code === 'ENOENT') return resolve(skipped(`${cmd} not found on PATH`));
        const raw = String(stdout ?? '').trim();
        const why = firstLine(stderr) || firstLine(err?.message) || 'no output';
        if (raw === '') {
          return resolve(err ? skipped(`${cmd} outdated failed: ${why}`) : { status: 'ok', note: '', map: {} });
        }
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return resolve(skipped(`${cmd} outdated did not print JSON: ${why}`));
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return resolve(skipped(`${cmd} outdated printed unexpected JSON: ${why}`));
        }
        if (parsed.error && typeof parsed.error === 'object') {
          const e = parsed.error;
          return resolve(skipped(`${cmd} outdated failed: ${firstLine(e.summary ?? e.message ?? e.code)}`));
        }
        const note = cmd === 'npm' ? 'npm outdated does not report deprecation' : '';
        resolve({ status: 'ok', note, map: parsed });
      },
    );
  });
}

// ---------------------------------------------------------------- one package

function emptySizes() {
  return {
    selfBytes: null,
    transitiveBytes: null,
    exclusiveBytes: null,
    transitiveCount: null,
    sharePct: null,
  };
}

function collectPackage(root, name, opts) {
  const dir = path.join(root, name);
  const meta = readJson(path.join(dir, 'package.json'));
  if (!meta) fail(`package ${name}: ${posix(path.join(name, 'package.json'))} not found or unreadable`);

  const lockfile = exists(path.join(dir, 'pnpm-lock.yaml'))
    ? 'pnpm-lock.yaml'
    : exists(path.join(dir, 'package-lock.json'))
      ? 'package-lock.json'
      : null;
  const nm = path.join(dir, 'node_modules');
  const installed = isDir(nm);

  let packageManager = null;
  if (installed) {
    const modules = readText(path.join(nm, '.modules.yaml'));
    const m = modules && /^\s*["']?packageManager["']?\s*:\s*["']?([^"',\n]+?)["']?\s*,?\s*$/m.exec(modules);
    if (m) packageManager = m[1];
    else if (exists(path.join(nm, '.package-lock.json'))) packageManager = 'npm';
  }

  const declared = [];
  for (const [kind, key] of [['prod', 'dependencies'], ['dev', 'devDependencies']]) {
    for (const [depName, range] of Object.entries(meta[key] ?? {})) {
      declared.push({ name: depName, kind, declared: range });
    }
  }
  declared.sort((a, b) => byString(a.name, b.name));

  const usage = scanUsage(root, name, dir);
  const tsconfig = parseJsonc(readText(path.join(dir, 'tsconfig.json')) ?? '') ?? {};
  const tsTypes = Array.isArray(tsconfig.compilerOptions?.types) ? tsconfig.compilerOptions.types : [];
  const scripts = meta.scripts && typeof meta.scripts === 'object' ? meta.scripts : {};

  const outdatedPromise = runOutdated(dir, lockfile, installed, opts.offline);

  // ----- disk sizes (only when installed)
  const selfCache = new Map();
  const selfOf = (real) => {
    let entry = selfCache.get(real);
    if (!entry) {
      entry = { keys: [], bytes: [], total: 0 };
      walkDisk(real, true, (key, bytes) => {
        entry.keys.push(key);
        entry.bytes.push(bytes);
        entry.total += bytes;
      });
      selfCache.set(real, entry);
    }
    return entry;
  };
  const metaCache = new Map();
  const childNames = (real) => {
    let names = metaCache.get(real);
    if (!names) {
      const m = readJson(path.join(real, 'package.json')) ?? {};
      names = [...Object.keys(m.dependencies ?? {}), ...Object.keys(m.optionalDependencies ?? {})];
      metaCache.set(real, names);
    }
    return names;
  };
  // Node resolution: every ancestor that is not itself a node_modules directory.
  const resolveFrom = (start, depName) => {
    let current = start;
    while (isInside(dir, current)) {
      if (path.basename(current) !== 'node_modules') {
        const candidate = path.join(current, 'node_modules', depName);
        if (exists(path.join(candidate, 'package.json'))) {
          try {
            return fs.realpathSync(candidate);
          } catch {
            return null;
          }
        }
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  };
  const closureOf = (startReal) => {
    const members = new Set([startReal]);
    const queue = [startReal];
    while (queue.length > 0) {
      const current = queue.pop();
      for (const child of childNames(current)) {
        const real = resolveFrom(current, child);
        if (real && !members.has(real)) {
          members.add(real);
          queue.push(real);
        }
      }
    }
    return members;
  };
  const sumDeduped = (reals) => {
    const seen = new Set();
    let total = 0;
    for (const real of reals) {
      const e = selfOf(real);
      for (let i = 0; i < e.keys.length; i++) {
        if (!seen.has(e.keys[i])) {
          seen.add(e.keys[i]);
          total += e.bytes[i];
        }
      }
    }
    return total;
  };

  const dependencies = [];
  const closures = new Map();
  let nodeModulesBytes = null;
  if (installed) {
    nodeModulesBytes = totalBytes(nm);
    const refCount = new Map();
    for (const d of declared) {
      const real = resolveFrom(dir, d.name);
      const closure = real ? closureOf(real) : null;
      closures.set(d.name, { real, closure });
      if (closure) for (const member of closure) refCount.set(member, (refCount.get(member) ?? 0) + 1);
    }
    const metas = new Map();
    const peerOf = new Map();
    for (const d of declared) {
      const real = closures.get(d.name).real;
      const depMeta = real ? readJson(path.join(real, 'package.json')) : null;
      metas.set(d.name, depMeta);
      for (const peer of Object.keys(depMeta?.peerDependencies ?? {})) {
        if (!peerOf.has(peer)) peerOf.set(peer, d.name);
      }
    }
    for (const d of declared) {
      const { real, closure } = closures.get(d.name);
      const depMeta = metas.get(d.name);
      const cls = classify(d.name, { usage, scripts, tsTypes, depMeta, peerOf });
      const base = { ...d, installed: depMeta?.version ?? null, ...cls };
      if (!real) {
        dependencies.push({ ...base, ...emptySizes(), sizeNote: 'declared but not found in node_modules' });
        continue;
      }
      const transitiveBytes = sumDeduped(closure);
      const exclusive = [...closure].filter((member) => refCount.get(member) === 1);
      dependencies.push({
        ...base,
        selfBytes: selfOf(real).total,
        transitiveBytes,
        exclusiveBytes: sumDeduped(exclusive),
        transitiveCount: closure.size - 1,
        sharePct: nodeModulesBytes > 0 ? Math.round((transitiveBytes / nodeModulesBytes) * 10000) / 100 : null,
        sizeNote: null,
      });
    }
  } else {
    for (const d of declared) {
      const cls = classify(d.name, { usage, scripts, tsTypes, depMeta: null, peerOf: new Map() });
      dependencies.push({ ...d, installed: null, ...cls, ...emptySizes(), sizeNote: NOT_INSTALLED });
    }
  }

  // ----- heaviest packages of the whole tree
  let heaviest = [];
  if (installed) {
    const viaOf = (real) => {
      for (const d of declared) {
        if (closures.get(d.name)?.closure?.has(real)) return d.name;
      }
      return null;
    };
    heaviest = discoverPackages(nm)
      .map((p) => ({ name: p.name, version: p.version, selfBytes: selfOf(p.real).total, via: viaOf(p.real) }))
      .sort((a, b) => b.selfBytes - a.selfBytes || byString(a.name, b.name) || byString(a.version ?? '', b.version ?? ''))
      .slice(0, opts.top);
  }

  return {
    pkg: {
      name,
      packageName: meta.name ?? null,
      lockfile,
      packageManager,
      installed,
      nodeModulesBytes,
      sizeNote: installed ? null : NOT_INSTALLED,
      dependencies,
      heaviest,
      outdated: { status: 'skipped', note: '' },
    },
    outdatedPromise,
  };
}

function applyOutdated(pkg, result) {
  pkg.outdated = { status: result.status, note: result.note };
  for (const dep of pkg.dependencies) {
    if (result.status !== 'ok') {
      dep.latest = null;
      dep.deprecated = null;
      continue;
    }
    let entry = result.map[dep.name];
    if (Array.isArray(entry)) entry = entry[0];
    dep.latest = entry?.latest ?? (entry ? null : dep.installed);
    dep.deprecated = entry && 'isDeprecated' in entry ? Boolean(entry.isDeprecated) : entry ? null : false;
    if (result.note.startsWith('npm outdated')) dep.deprecated = null;
  }
}

// ---------------------------------------------------------------- cross-package

function findDuplicates(packages) {
  const byName = new Map();
  for (const pkg of packages) {
    for (const dep of pkg.dependencies) {
      if (!dep.installed) continue;
      if (!byName.has(dep.name)) byName.set(dep.name, []);
      byName.get(dep.name).push({ package: pkg.name, version: dep.installed, kind: dep.kind, declared: dep.declared });
    }
  }
  const out = [];
  for (const [depName, uses] of byName) {
    const versions = new Set(uses.map((u) => u.version));
    if (versions.size < 2) continue;
    const majors = new Set([...versions].map((v) => parseInt(v, 10)));
    uses.sort((a, b) => byString(a.package, b.package));
    out.push({ name: depName, majorSplit: majors.size > 1, uses });
  }
  return out.sort((a, b) => byString(a.name, b.name));
}

function findLinks(root, pkgNames) {
  const links = [];
  const known = new Set(pkgNames);
  for (const name of pkgNames) {
    const dir = path.join(root, name);
    const tsconfig = parseJsonc(readText(path.join(dir, 'tsconfig.json')) ?? '');
    const paths = tsconfig?.compilerOptions?.paths;
    if (paths && typeof paths === 'object') {
      const baseDir = path.resolve(dir, tsconfig.compilerOptions.baseUrl ?? '.');
      for (const [alias, targets] of Object.entries(paths)) {
        for (const target of Array.isArray(targets) ? targets : []) {
          const abs = path.resolve(baseDir, String(target).replace(/\*$/, ''));
          const rel = posix(path.relative(root, abs));
          const leaves = !isInside(dir, abs);
          if (!leaves && !rel.split('/').includes('vendor')) continue;
          const first = rel.split('/')[0];
          links.push({ kind: 'tsconfig-path', from: name, to: known.has(first) ? first : null, alias, target: rel });
        }
      }
    }
    const vendorDir = path.join(dir, 'src', 'vendor');
    for (const ent of listDir(vendorDir)) {
      if (!ent.isDirectory()) continue;
      links.push({
        kind: 'vendor-mirror',
        from: name,
        name: ent.name,
        path: posix(path.relative(root, path.join(vendorDir, ent.name))),
        mirrorOf: ent.name === 'shared' && name !== 'server' ? 'server/src/vendor/shared' : null,
      });
    }
  }
  return links.sort(
    (a, b) =>
      byString(a.kind, b.kind) ||
      byString(a.from, b.from) ||
      byString(a.alias ?? a.path, b.alias ?? b.path) ||
      byString(a.target ?? '', b.target ?? ''),
  );
}

// ---------------------------------------------------------------- main

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) fail('Node >= 22 is required');
  const opts = parseArgs(process.argv.slice(2));
  const root = path.resolve(
    opts.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'),
  );
  if (!isDir(root)) fail(`--root ${root} is not a directory`);

  let outFile = null;
  if (opts.out !== null) {
    outFile = realPathLoose(opts.out);
    if (isInside(realPathLoose(root), outFile)) {
      fail('--out must lie outside --root (the collector never writes into the repo)');
    }
  }

  const names = [...new Set(opts.pkgs)].sort();
  const collected = names.map((n) => collectPackage(root, n, opts));
  const results = await Promise.all(collected.map((c) => c.outdatedPromise));
  collected.forEach((c, i) => applyOutdated(c.pkg, results[i]));
  const packages = collected.map((c) => c.pkg);

  const doc = canon({
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    offline: opts.offline,
    top: opts.top,
    packages,
    duplicates: findDuplicates(packages),
    links: findLinks(root, names),
  });
  const json = `${JSON.stringify(doc, null, 2)}\n`;
  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, json);
  } else process.stdout.write(json);
}

main().catch((err) => fail(String(err && err.stack ? err.stack : err)));
