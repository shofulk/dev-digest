#!/usr/bin/env node
// dependencies-checker renderer: deterministic report renderer, deps.json -> report-<date>.md/.html;
// zero dependencies, Node >= 22.
//
// A pure function of (deps.json, optional advice file, --date, --base, flags): the same inputs
// give byte-identical files. It spawns no process and opens no network connection. Tiers
// (P0/P1/P2), findings, effort, commands and all numbers are computed here from deps.json
// fields only (see priorities.md and report-template.md; a change there is mirrored here).
//
// CLI
//   --deps <file>      deps.json written by collect.mjs (schemaVersion 1)      required
//   --out-dir <dir>    where report-<date>.md|.html go; created if missing      required
//   --date YYYY-MM-DD  report date, also part of the file name                  required
//   --base <sha>       git short sha of the base commit (hex, 7-40 chars)       required
//   --advice <file>    up to 3 non-empty lines of agent-written advice          optional
//   --no-html          write the Markdown report only                           optional
//
// Reads only --deps and --advice. Writes only <out-dir>/report-<date>.md and, unless
// --no-html, <out-dir>/report-<date>.html. All validation runs before the first write.
// stdout gets one JSON line with the finding count per tier.

import fs from 'node:fs';
import path from 'node:path';

const NOT_INSTALLED = 'not installed, size unknown';
const HEAVY_BYTES = 20971520;
const MAX_ADVICE_LINES = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BASE_RE = /^[0-9a-f]{7,40}$/;
const SAFE_NAME_RE = /^(?!-)(?!(?:.*\/)?\.\.(?:\/|$))[@A-Za-z0-9._~/-]+$/;
const SAFE_VERSION_RE = /^[0-9A-Za-z.+_-]+$/;

function fail(message) {
  process.stderr.write(`build-report.mjs: ${message}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const opts = { deps: null, outDir: null, date: null, base: null, advice: null, html: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${arg} needs a value`);
      return v;
    };
    if (arg === '--deps') opts.deps = value();
    else if (arg === '--out-dir') opts.outDir = value();
    else if (arg === '--date') opts.date = value();
    else if (arg === '--base') opts.base = value();
    else if (arg === '--advice') opts.advice = value();
    else if (arg === '--no-html') opts.html = false;
    else fail(`unknown argument ${arg}`);
  }
  if (!opts.deps) fail('--deps is required');
  if (!opts.outDir) fail('--out-dir is required');
  if (!opts.date) fail('--date is required');
  if (!DATE_RE.test(opts.date)) fail('--date must match YYYY-MM-DD');
  if (!opts.base) fail('--base is required');
  if (!BASE_RE.test(opts.base)) fail('--base must be 7-40 lowercase hex characters');
  return opts;
}

function readAdvice(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return fail(`cannot read --advice ${file}`);
  }
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lines.length > MAX_ADVICE_LINES) fail(`--advice holds ${lines.length} non-empty lines, at most ${MAX_ADVICE_LINES} allowed`);
  return lines;
}

function readDeps(file) {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fail(`cannot read or parse --deps ${file}`);
  }
  if (!doc || typeof doc !== 'object' || doc.schemaVersion !== 1) fail('deps.json schemaVersion must be 1');
  if (!Array.isArray(doc.packages)) fail('deps.json has no packages[]');
  return doc;
}

// ---------------------------------------------------------------- small helpers

const flat = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const mb = (b) => (b == null ? NOT_INSTALLED : `${(b / 1048576).toFixed(1)} MB`);
const saved = (b) => (b == null ? NOT_INSTALLED : `${mb(b)} saved`);
const majorOf = (v) => parseInt(String(v), 10);
const behind = (x) => Boolean(x.latest && x.installed && x.latest !== x.installed);
const majorBehind = (x) => behind(x) && majorOf(x.installed) !== majorOf(x.latest);

function cmpVersion(a, b) {
  const pa = String(a).split(/[.+-]/).map((s) => parseInt(s, 10) || 0);
  const pb = String(b).split(/[.+-]/).map((s) => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// The package's own manager decides the command form (priorities.md, Command forms).
function command(pkg, verb, dep, version, dev) {
  if (!SAFE_NAME_RE.test(String(pkg.name)) || !SAFE_NAME_RE.test(String(dep))) return 'command omitted: unsafe name';
  if (verb === 'add' && !SAFE_VERSION_RE.test(String(version))) return 'command omitted: unsafe version';
  const flag = dev ? ' -D' : '';
  if (pkg.lockfile === 'pnpm-lock.yaml') {
    return verb === 'remove' ? `pnpm --dir ${pkg.name} remove ${dep}` : `pnpm --dir ${pkg.name} add${flag} ${dep}@${version}`;
  }
  if (pkg.lockfile === 'package-lock.json') {
    return verb === 'remove' ? `npm --prefix ${pkg.name} uninstall ${dep}` : `npm --prefix ${pkg.name} install${flag} ${dep}@${version}`;
  }
  return 'command omitted: no lockfile';
}

// ---------------------------------------------------------------- analysis

const TIER_RANK = { p0: 0, p1: 1, p2: 2, ok: 3 };

function analyse(d) {
  const pkgs = d.packages.map((p) => ({ ...p, dependencies: p.dependencies ?? [], heaviest: p.heaviest ?? [], outdated: p.outdated ?? { status: 'skipped', note: '' } }));
  const duplicates = d.duplicates ?? [];
  const links = d.links ?? [];
  const top = Number.isInteger(d.top) && d.top > 0 ? d.top : 10;
  const okOutdated = (p) => p.outdated.status === 'ok';

  // Packages that compile the shared mirror: mirror holders, its source, and both ends of a
  // tsconfig-path into another package's vendor/ directory.
  const mirror = new Set();
  for (const l of links) {
    if (l.kind === 'vendor-mirror' && l.mirrorOf) {
      mirror.add(l.from);
      mirror.add(String(l.mirrorOf).split('/')[0]);
    } else if (l.kind === 'tsconfig-path' && l.to && l.to !== l.from && String(l.target ?? '').split('/').includes('vendor')) {
      mirror.add(l.from);
      mirror.add(l.to);
    }
  }

  const items = [];
  const issues = Object.fromEntries(pkgs.map((p) => [p.name, 0]));
  const worst = new Map();
  const mark = (pkgName, dep, tier) => {
    const key = `${pkgName}|${dep}`;
    if (!worst.has(key) || TIER_RANK[tier] < TIER_RANK[worst.get(key)]) worst.set(key, tier);
  };

  const unused = [];
  const outdated = [];
  const deprecated = [];
  const batches = new Map();
  for (const p of pkgs) {
    for (const x of p.dependencies) {
      if (x.usage === 'unused-candidate') {
        unused.push({ p, x });
        issues[p.name]++;
        const tier = x.kind === 'prod' ? 'p1' : 'p2';
        mark(p.name, x.name, tier);
        items.push({
          tier, pkg: p.name, key: `1|${p.name}|${x.name}`,
          what: `${p.name}/${x.name} ${x.declared}: ${x.kind} unused-candidate`,
          why: `usage = unused-candidate on a ${x.kind} dependency (heuristic).`,
          effort: `Effort S (estimate). Impact: ${saved(x.exclusiveBytes)}; risk low-medium: confirm before removing (it may be loaded by a string path).`,
          command: command(p, 'remove', x.name),
        });
      }
      if (!okOutdated(p)) continue;
      const isDeprecated = x.deprecated === true;
      if (isDeprecated) deprecated.push({ p, x });
      if (behind(x)) outdated.push({ p, x });
      if (!behind(x) && !isDeprecated) continue;
      issues[p.name]++;
      const major = majorBehind(x);
      if (isDeprecated) {
        mark(p.name, x.name, 'p0');
        items.push({
          tier: 'p0', pkg: p.name, key: `0|${p.name}|${x.name}`,
          what: `${p.name}/${x.name} ${x.installed}: deprecated`,
          why: 'deprecated = true on a declared dependency.',
          effort: `Effort ${behind(x) ? (major ? 'M' : 'S') : 'M'} (estimate). Impact: leaves a deprecated dependency; risk: ${behind(x) ? 'breaking changes, read the changelog' : 'no newer version, a replacement must be chosen'}.`,
          command: behind(x) ? command(p, 'add', x.name, x.latest, x.kind === 'dev') : 'command omitted: no newer version, choose a replacement',
        });
      } else if (x.kind === 'prod' && major) {
        mark(p.name, x.name, 'p1');
        items.push({
          tier: 'p1', pkg: p.name, key: `1|${p.name}|${x.name}`,
          what: `${p.name}/${x.name} ${x.installed} -> ${x.latest}`,
          why: 'prod dependency a major version behind latest.',
          effort: 'Effort M (estimate). Impact: no size change; risk: breaking changes, read the changelog.',
          command: command(p, 'add', x.name, x.latest, false),
        });
      } else {
        mark(p.name, x.name, 'p2');
        const level = major ? 'major' : 'minor';
        const bk = `${p.name}|${x.kind}|${level}`;
        if (!batches.has(bk)) batches.set(bk, { p, kind: x.kind, level, rows: [] });
        batches.get(bk).rows.push(x);
      }
    }
  }

  // Duplicates: one item per name.
  for (const u of duplicates) {
    const uses = u.uses ?? [];
    const inMirror = uses.filter((s) => mirror.has(s.package));
    const mirrorMajors = new Set(inMirror.map((s) => majorOf(s.version)));
    let tier = 'p2';
    if (u.majorSplit) tier = mirrorMajors.size > 1 ? 'p0' : 'p1';
    for (const s of uses) {
      issues[s.package] = (issues[s.package] ?? 0) + 1;
      mark(s.package, u.name, tier);
    }
    const highest = uses.map((s) => s.version).sort(cmpVersion).pop();
    const cmds = uses
      .filter((s) => cmpVersion(s.version, highest) < 0)
      .map((s) => {
        const target = pkgs.find((q) => q.name === s.package) ?? { name: s.package, lockfile: null, outdated: { status: 'skipped' } };
        return okOutdated(target) ? command(target, 'add', u.name, highest, s.kind === 'dev') : `command omitted for ${flat(s.package)}: outdated check skipped`;
      });
    items.push({
      tier, pkg: '', key: `2|${u.name}`,
      what: `${u.name}: ${uses.map((s) => `${s.package}=${s.version}`).join(', ')}${u.majorSplit ? ' (majorSplit=true)' : ''}`,
      why: u.majorSplit
        ? (tier === 'p0' ? 'Major-version split across packages that compile the shared mirror.' : 'Major-version split in duplicates[]; the packages that compile the shared mirror agree on the major.')
        : 'Minor/patch version duplicate in duplicates[].',
      effort: u.majorSplit
        ? 'Effort M-L (estimate). Impact: one version of the library; risk high: align a major across packages.'
        : 'Effort S (estimate). Impact: consistency only, no size change; risk low.',
      command: cmds.length ? `${cmds.join('; ')} (align to ${highest})` : 'none: already aligned',
    });
  }
  items.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || byString(a.key, b.key));

  const batchList = [...batches.values()].sort((a, b) => byString(a.p.name, b.p.name) || byString(a.kind, b.kind) || byString(a.level, b.level));
  for (const b of batchList) b.rows.sort((x, y) => byString(x.name, y.name));

  return { pkgs, duplicates, links, top, items, issues, worst, unused, outdated, deprecated, batchList };
}

// ---------------------------------------------------------------- sections as blocks

const T = (head, rows, opt = {}) => ({ t: 'table', head, rows, ...opt });
const P = (text) => ({ t: 'p', text });
const UL = (list) => ({ t: 'ul', items: list });
const H3 = (text) => ({ t: 'h3', text });
const CODE = (text) => ({ t: 'code', text });
const MM = (text) => ({ t: 'mermaid', text });

// Mermaid labels lose every character that can break out of a quoted label or a tag.
const label = (s) => flat(s).replace(/["[\]{}()<>|]/g, '').trim() || '?';

function buildSections(a, advice) {
  const { pkgs, links, top, items, issues, worst, unused, outdated, deprecated, batchList, duplicates } = a;
  const S = [];
  const sec = (title, blocks) => S.push({ title, blocks });
  const tierCount = (t) => items.filter((i) => i.tier === t).length;

  // 1 Summary
  const total = pkgs.reduce((acc, p) => acc + (p.nodeModulesBytes || 0), 0);
  const missing = pkgs.filter((p) => p.nodeModulesBytes == null);
  const skipped = pkgs.filter((p) => p.outdated.status === 'skipped');
  const skippedNotes = skipped.map((p) => `${flat(p.name)}: "${flat(p.outdated.note)}"`);
  sec('1. Summary', [
    T(['Package', 'Lockfile', 'Deps (prod / dev)', 'node_modules', 'Issues'], pkgs.map((p) => {
      const prod = p.dependencies.filter((x) => x.kind === 'prod').length;
      return [p.name, p.lockfile ?? 'none', `${p.dependencies.length} (${prod} / ${p.dependencies.length - prod})`, { v: mb(p.nodeModulesBytes), s: p.nodeModulesBytes ?? -1 }, String(issues[p.name])];
    })),
    P(`Total node_modules across ${pkgs.length} package${pkgs.length === 1 ? '' : 's'}: ${mb(total)}${missing.length ? ` (${missing.map((p) => p.name).join(', ')}: ${NOT_INSTALLED})` : ''}. Packages are independent, so shared tools are installed once per package by design. Outdated check: ${skipped.length ? `SKIPPED for ${skipped.map((p) => p.name).join(', ')}` : `ran for all ${pkgs.length} package${pkgs.length === 1 ? '' : 's'}`}.${skippedNotes.length ? ` Collector notes: ${skippedNotes.join('; ')}.` : ''}`),
  ]);

  // 2 Diagram
  const id = pkgs.map((p, i) => `${p.name.replace(/[^A-Za-z0-9]/g, '')}${i}`);
  const idOf = new Map(pkgs.map((p, i) => [p.name, id[i]]));
  const seenEdge = new Set();
  const edges = [];
  for (const l of links) {
    const to = l.kind === 'tsconfig-path' ? l.to : l.mirrorOf ? String(l.mirrorOf).split('/')[0] : null;
    if (!to || to === l.from || !idOf.has(l.from) || !idOf.has(to)) continue;
    const k = `${l.from}|${l.kind}|${to}`;
    if (seenEdge.has(k)) continue;
    seenEdge.add(k);
    edges.push(`  ${idOf.get(l.from)} ${l.kind === 'vendor-mirror' ? '-.->' : '-->'}|${label(l.kind)}| ${idOf.get(to)}`);
  }
  const rank = (p) => [...p.dependencies].sort((x, y) => (y.transitiveBytes ?? -1) - (x.transitiveBytes ?? -1) || byString(x.name, y.name)).slice(0, top);
  const classDefs = [
    '  classDef p0 fill:#f8d7da,stroke:#b02a37',
    '  classDef p1 fill:#fff3cd,stroke:#b58105',
    '  classDef p2 fill:#cff4fc,stroke:#087990',
    '  classDef ok fill:#d1e7dd,stroke:#146c43',
  ].join('\n');
  const diag = [
    P(`Top level: the packages and the links between them (\`tsconfig-path\` solid, \`vendor-mirror\` dotted). Vendor mirrors are links only, never findings.`),
    MM(['flowchart LR', ...pkgs.map((p, i) => `  ${id[i]}["${label(p.name)}"]`), ...edges].join('\n')),
    T(['Kind', 'From', 'To / path', 'Alias / mirrorOf'], links.map((l) => [l.kind, l.from, l.to ?? l.path ?? '-', l.alias ?? l.mirrorOf ?? '-'])),
    P(`Per package: top ${top} direct dependencies by transitiveBytes. Node label = size; colour = worst finding (p0 red, p1 yellow, p2 blue, ok green).`),
  ];
  pkgs.forEach((p, i) => {
    const lines = ['flowchart LR', `  ${id[i]}["${label(p.name)}"]`];
    const classes = [];
    rank(p).forEach((x, j) => {
      const nid = `${id[i]}d${j}`;
      lines.push(`  ${id[i]} --> ${nid}["${label(x.name)} ${mb(x.transitiveBytes)}"]`);
      classes.push(`  class ${nid} ${worst.get(`${p.name}|${x.name}`) ?? 'ok'}`);
    });
    diag.push(H3(p.name), MM([...lines, classDefs, ...classes].join('\n')));
  });
  sec('2. Diagram', diag);

  // 3 Size table
  const sizeRows = [];
  for (const p of pkgs) {
    const direct = new Set(p.dependencies.map((x) => x.name));
    for (const x of rank(p)) {
      sizeRows.push([x.name, p.name, 'direct', { v: mb(x.selfBytes), s: x.selfBytes ?? -1 }, { v: mb(x.transitiveBytes), s: x.transitiveBytes ?? -1 }, { v: x.sharePct == null ? '-' : `${x.sharePct.toFixed(1)} %`, s: x.sharePct ?? -1 }]);
    }
    for (const h of p.heaviest.filter((q) => !direct.has(q.name)).slice(0, top)) {
      sizeRows.push([h.name, p.name, `transitive (via ${h.via ?? 'unknown'})`, { v: mb(h.selfBytes), s: h.selfBytes ?? -1 }, { v: mb(h.selfBytes), s: h.selfBytes ?? -1 }, '-']);
    }
  }
  sec('3. Size table', [
    P(`Per package: top ${top} direct dependencies by transitiveBytes, then the heaviest non-direct packages from heaviest[]. sharePct exists only for direct dependencies.`),
    T(['Name', 'Package', 'Direct / transitive', 'selfBytes', 'transitiveBytes', 'sharePct'], sizeRows, { sortable: true }),
  ]);

  // 4 Findings
  const f4 = [];
  f4.push(H3('Unused candidates (heuristic: confirm before removing)'));
  f4.push(T(['Package', 'Dependency', 'Kind', 'Declared', 'Exclusive size', 'Evidence'], unused.map(({ p, x }) => [p.name, x.name, x.kind, x.declared, mb(x.exclusiveBytes), x.usageEvidence ?? 'no import found'])));
  f4.push(H3('Version duplicates across packages'));
  f4.push(T(['Name', 'Major split', 'Versions by package'], duplicates.map((u) => [u.name, u.majorSplit ? 'yes' : 'no', (u.uses ?? []).map((s) => `${s.package}=${s.version}`).join(', ')])));
  f4.push(H3('Outdated / deprecated'));
  const notes = pkgs.filter((p) => p.outdated.note).map((p) => `${flat(p.name)} (${p.outdated.status}): "${flat(p.outdated.note)}"`);
  f4.push(notes.length ? UL(notes.map((n) => `Collector note, ${n}`)) : P('No collector notes.'));
  f4.push(P(`Deprecated: ${deprecated.length ? deprecated.map(({ p, x }) => `${p.name}/${x.name}`).join(', ') : 'none reported'}. Packages whose outdated check was skipped, or whose manager does not report deprecation, are not covered.`));
  if (pkgs.some((p) => p.outdated.status === 'ok')) {
    f4.push(P(`${outdated.length} direct dependencies are behind latest (${outdated.filter(({ x }) => majorBehind(x)).length} by a major version). Format: name installed -> latest, [M] = major.`));
  } else f4.push(P('No version comparison is available: the outdated check did not run for any package.'));
  for (const p of pkgs) {
    if (p.outdated.status !== 'ok') continue;
    const rows = outdated.filter((o) => o.p === p);
    const fmt = (kind) => rows.filter((o) => o.x.kind === kind).map(({ x }) => `${x.name} ${x.installed} -> ${x.latest}${majorBehind(x) ? ' [M]' : ''}`).join('; ') || 'none';
    f4.push(T(['Package', 'Kind', 'Behind latest'], [[p.name, 'prod', fmt('prod')], [p.name, 'dev', fmt('dev')]]));
  }
  f4.push(H3('Heavy dependencies with a lighter alternative'));
  f4.push(P(`None assigned by the renderer. The rule needs a named lighter alternative with a source; such an alternative reaches this report only through the agent's advice (section 6). The table lists what is >= 20 MB exclusive, for orientation only.`));
  f4.push(T(['Package', 'Dependency', 'Kind', 'Exclusive size'], pkgs.flatMap((p) => p.dependencies.filter((x) => x.exclusiveBytes != null && x.exclusiveBytes >= HEAVY_BYTES).map((x) => [p.name, x.name, x.kind, mb(x.exclusiveBytes)]))));
  sec('4. Findings', f4);

  // 5 Prioritisation
  const f5 = [];
  const head = ['What', 'Why', 'Effort vs impact', 'Command (proposal)'];
  const rowOf = (i) => [i.what, i.why, i.effort, i.command];
  f5.push(H3('P0'), T(head, items.filter((i) => i.tier === 'p0').map(rowOf)));
  f5.push(H3('P1'), T(head, items.filter((i) => i.tier === 'p1').map(rowOf)));
  f5.push(H3('P2'), T(head, items.filter((i) => i.tier === 'p2').map(rowOf)));
  if (batchList.length) f5.push(P('Batch the remaining P2 version bumps per package. Major bumps of dev dependencies are separate PRs each, with breaking-change risk. Effort S (estimate) for minor/patch, M (estimate) for major; no size change.'));
  for (const b of batchList) {
    const cmds = b.rows.map((x) => command(b.p, 'add', x.name, x.latest, b.kind === 'dev')).join('\n');
    f5.push(P(`${b.p.name} (${b.kind}), ${b.level === 'major' ? 'major behind (separate PR each, breaking risk)' : 'minor/patch behind'}: ${b.rows.length}`), CODE(cmds));
  }
  sec('5. Prioritisation', f5);

  // 6 Advice: (a) data points, (b) agent lines, (c) Do not touch
  const points = [];
  const lead = items.find((i) => i.tier === 'p0') ?? items.find((i) => i.tier === 'p1');
  if (lead) points.push(`Start with ${lead.tier.toUpperCase()}: ${lead.what}. ${lead.why}`);
  const biggest = [...unused].filter(({ x }) => x.exclusiveBytes != null).sort((u, v) => v.x.exclusiveBytes - u.x.exclusiveBytes || byString(u.p.name, v.p.name) || byString(u.x.name, v.x.name))[0];
  if (biggest) points.push(`Largest unused candidate: ${biggest.p.name}/${biggest.x.name} (${biggest.x.kind}), ${saved(biggest.x.exclusiveBytes)} (exclusiveBytes); confirm before removing.`);
  if (outdated.length) {
    const perPkg = pkgs.map((p) => [p.name, outdated.filter((o) => o.p === p).length]).filter(([, n]) => n > 0).map(([n, c]) => `${n} ${c}`);
    points.push(`${outdated.length} direct dependencies are behind latest; do not chase them one by one. Batch per package (${perPkg.join(', ')}), one minor/patch PR each, majors separately.`);
  }
  if (points.length === 0) points.push('No P0/P1 item, unused candidate or outdated dependency in deps.json: nothing to start with.');
  sec('6. Advice', [
    UL([...points.slice(0, 3), ...advice]),
    P('Do not touch: `*/src/vendor/**` mirrors (edit `server/src/vendor/shared` and let the mirror follow), lockfiles by hand, hoisting dependencies to the repo root, and anything under `evals/`. CVEs are out of scope: use the `security` skill.'),
  ]);

  return { S, counts: { p0: tierCount('p0'), p1: tierCount('p1'), p2: tierCount('p2') + a.batchList.reduce((n, b) => n + b.rows.length, 0) } };
}

// ---------------------------------------------------------------- render

const mdText = (v) => String(v ?? '').replace(/</g, '&lt;');
const cell = (c) => mdText(flat(typeof c === 'object' && c !== null && 'v' in c ? c.v : c)).replace(/\|/g, '\\|');

function renderMarkdown(d, opts, S) {
  let md = `# Dependencies report\n\nDate ${opts.date} · Base \`${opts.base}\` · deps.json generated ${mdText(flat(d.generatedAt))} · offline: ${mdText(flat(d.offline))}\n`;
  for (const s of S) {
    md += `\n## ${s.title}\n`;
    for (const b of s.blocks) {
      if (b.t === 'p') md += `\n${mdText(b.text)}\n`;
      else if (b.t === 'h3') md += `\n### ${mdText(b.text)}\n`;
      else if (b.t === 'ul') md += '\n' + b.items.map((i) => `- ${mdText(flat(i))}`).join('\n') + '\n';
      else if (b.t === 'code') md += '\n```bash\n' + b.text + '\n```\n';
      else if (b.t === 'mermaid') md += '\n```mermaid\n' + b.text + '\n```\n';
      else if (b.t === 'table') md += b.rows.length ? `\n| ${b.head.join(' | ')} |\n|${b.head.map(() => '---').join('|')}|\n${b.rows.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n')}\n` : '\nnone\n';
    }
  }
  return md;
}

// The single escape function: every value interpolated into the HTML goes through it.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

const SORT_SCRIPT = `<script>
document.querySelectorAll('table.sortable').forEach(function(t){
  t.querySelectorAll('th').forEach(function(th,i){
    th.addEventListener('click',function(){
      var rows=Array.from(t.tBodies[0].rows),asc=th.dataset.asc!=='1';
      th.dataset.asc=asc?'1':'0';
      rows.sort(function(a,b){
        var x=a.cells[i],y=b.cells[i],xs=x.dataset.sort,ys=y.dataset.sort;
        var r=(xs!==undefined&&ys!==undefined)?(parseFloat(xs)-parseFloat(ys)):x.textContent.localeCompare(y.textContent);
        return asc?r:-r;
      });
      rows.forEach(function(r){t.tBodies[0].appendChild(r);});
    });
  });
});
</script>`;

const MERMAID_SCRIPT = `<script type="module">
try {
  const m = (await import('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs')).default;
  m.initialize({ startOnLoad: false, securityLevel: 'strict' });
  await m.run({ querySelector: 'pre.mermaid' });
} catch (e) { /* offline: the diagram source stays visible in the pre blocks */ }
</script>`;

function renderHtml(d, opts, S) {
  let h = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dependencies report ${esc(opts.date)}</title>
<style>
:root{--bg:#fff;--fg:#1c2230;--mut:#5b6475;--line:#d9dee7;--code:#f3f5f9}
@media (prefers-color-scheme:dark){:root{--bg:#14171f;--fg:#e6e9f0;--mut:#9aa3b5;--line:#2c3342;--code:#1d222d}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:16px}
h1,h2,h3{line-height:1.25}table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}th{cursor:default}
table.sortable th{cursor:pointer}pre,code{background:var(--code);border-radius:4px}pre{padding:10px;overflow-x:auto}code{padding:1px 4px}
.meta{color:var(--mut)}
</style></head><body>
<h1>Dependencies report</h1>
<p class="meta">Date ${esc(opts.date)} · Base <code>${esc(opts.base)}</code> · deps.json generated ${esc(flat(d.generatedAt))} · offline: ${esc(flat(d.offline))}</p>
`;
  for (const s of S) {
    h += `<h2>${esc(s.title)}</h2>\n`;
    for (const b of s.blocks) {
      if (b.t === 'p') h += `<p>${inline(b.text)}</p>\n`;
      else if (b.t === 'h3') h += `<h3>${esc(b.text)}</h3>\n`;
      else if (b.t === 'ul') h += '<ul>' + b.items.map((i) => `<li>${inline(flat(i))}</li>`).join('') + '</ul>\n';
      else if (b.t === 'code') h += `<pre>${esc(b.text)}</pre>\n`;
      else if (b.t === 'mermaid') h += `<pre class="mermaid">${esc(b.text)}</pre>\n`;
      else if (b.t === 'table') {
        if (!b.rows.length) {
          h += '<p>none</p>\n';
          continue;
        }
        h += `<table${b.sortable ? ' class="sortable"' : ''}><thead><tr>${b.head.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>`;
        for (const r of b.rows) {
          h += '<tr>' + r.map((c) => (typeof c === 'object' && c !== null && 'v' in c ? `<td data-sort="${esc(c.s)}">${esc(flat(c.v))}</td>` : `<td>${esc(flat(c))}</td>`)).join('') + '</tr>';
        }
        h += '</tbody></table>\n';
      }
    }
  }
  return `${h}${SORT_SCRIPT}\n${MERMAID_SCRIPT}\n</body></html>\n`;
}

// ---------------------------------------------------------------- main

function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) fail('Node >= 22 is required');
  const opts = parseArgs(process.argv.slice(2));
  const advice = opts.advice ? readAdvice(opts.advice) : [];
  const d = readDeps(opts.deps);

  let md;
  let html = null;
  let counts;
  try {
    const analysis = analyse(d);
    const built = buildSections(analysis, advice);
    counts = built.counts;
    md = renderMarkdown(d, opts, built.S);
    if (opts.html) html = renderHtml(d, opts, built.S);
  } catch (err) {
    return fail(`deps.json does not have the expected shape (${flat(err && err.message)})`);
  }

  fs.mkdirSync(opts.outDir, { recursive: true });
  fs.writeFileSync(path.join(opts.outDir, `report-${opts.date}.md`), md);
  if (html !== null) fs.writeFileSync(path.join(opts.outDir, `report-${opts.date}.html`), html);
  process.stdout.write(`${JSON.stringify(counts)}\n`);
}

main();
