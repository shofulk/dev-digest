#!/usr/bin/env node
// spec-lint.mjs — deterministic format check for feature specs (specs/README.md is the
// format of record). Wired from the `hooks:` block of .claude/agents/spec-creator.md.
//
//   node spec-lint.mjs check <file>...  — lint files, print errors, exit 1 if any
//   node spec-lint.mjs pre              — PreToolUse(Write|Edit): computes the content the
//                                         tool would produce; blocks (exit 2) only when
//                                         that content is `approved`/`implemented` and has
//                                         a lint error, so a broken spec is never frozen
//   node spec-lint.mjs post             — PostToolUse(Write|Edit): lints the file on disk;
//                                         exit 2 feeds the errors back to the agent, the
//                                         draft stays editable
//   node spec-lint.mjs self-test        — lints the reference example and a set of broken
//                                         mutations of it; exit 0 iff every case is right
//
// Scope: only <pkg>/.spec/*.spec.md (five packages) and specs/*.spec.md, and only files
// that carry a `Spec ID:` line (specs written before the format are left alone).
// FAIL-OPEN on an internal error (unparsable hook JSON, unreadable file): exit 0 with a
// warning on stderr. scope-guard.sh owns the write boundary; this hook judges only format.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES = ["server", "client", "reviewer-core", "e2e", "mcp-server"];
const ROLE_RE = new RegExp(`^(?:(?:${PACKAGES.join("|")})/\\.spec|specs)/[^/]+\\.spec\\.md$`);
const SECTIONS_BASE = [
  "Problem and user",
  "Goals / Non-goals",
  "User stories",
  "Acceptance criteria (EARS)",
  "Edge cases",
  "Non-functional requirements",
  "Assumptions",
  "Inputs and provenance",
  "Untrusted inputs",
  "Open questions",
  "Traceability",
];
const ITEM_PREFIX = {
  "User stories": "US",
  "Acceptance criteria (EARS)": "AC",
  "Edge cases": "EC",
  "Non-functional requirements": "NFR",
  "Assumptions": "A",
  "Open questions": "Q",
};
const VERIFY = "(?:unit|it|e2e|manual)(?: \\+ (?:unit|it|e2e|manual))*";
const VERIFY_RE = new RegExp(`\\*Verify: (${VERIFY})\\*\\s*$`);
const VAGUE = ["fast", "quickly", "nice", "properly", "user-friendly", "intuitive", "easy",
  "easily", "robust", "seamless", "seamlessly", "appropriate", "as needed", "etc"];
const VAGUE_RE = new RegExp(`\\b(${VAGUE.map(v => v.replace(/[-\s]/g, m => (m === "-" ? "\\-" : "\\s+"))).join("|")})\\b`, "i");

function expectedSections(rel) {
  if (!rel.startsWith("specs/")) return SECTIONS_BASE;
  const s = [...SECTIONS_BASE];
  s.splice(s.indexOf("Acceptance criteria (EARS)") + 1, 0, "Module interactions");
  return s;
}

// Strip fenced code blocks (``` or ````), keep line numbers.
function unfenced(lines) {
  let fence = null;
  return lines.map(l => {
    const m = l.match(/^\s*(`{3,})/);
    if (m) {
      if (fence === null) { fence = m[1]; return ""; }
      if (m[1].length >= fence.length) { fence = null; return ""; }
    }
    return fence === null ? l : "";
  });
}

export function lint(content, rel, root) {
  const errs = [];
  const lines = content.split(/\r?\n/);
  const slug = path.basename(rel).replace(/\.spec\.md$/, "");

  // -- header --
  if (!/^# Spec: \S/.test(lines[0] || "")) errs.push("line 1 must be `# Spec: <feature name>`");
  const head = lines.slice(0, 8);
  const idLine = head.find(l => l.startsWith("Spec ID:"));
  const idM = idLine && idLine.match(/^Spec ID: SPEC-(\d{2,})-([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/);
  if (!idM) errs.push("missing or malformed `Spec ID: SPEC-NN-<feature>` in the header");
  else if (idM[2] !== slug) errs.push(`Spec ID slug \`${idM[2]}\` must equal the file name \`${slug}\``);
  const stLine = head.find(l => l.startsWith("Status:"));
  const stM = stLine && stLine.match(/^Status: (draft|approved|implemented)\s*$/);
  if (!stM) errs.push("missing or malformed `Status: draft | approved | implemented` in the header");
  const status = stM ? stM[1] : null;
  const supLine = head.find(l => l.startsWith("Supersedes:"));
  if (!supLine || !/^Supersedes: (none|\S+ \(SPEC-\d{2,}-[a-z0-9-]+\))\s*$/.test(supLine)) {
    errs.push("missing or malformed `Supersedes: none | <path> (SPEC-NN-<feature>)` in the header");
  }

  // -- global number is unique across the repo --
  if (idM && root) {
    for (const f of listSpecs(root)) {
      if (f === rel) continue;
      let txt; try { txt = fs.readFileSync(path.join(root, f), "utf8"); } catch { continue; }
      const m = txt.match(/^Spec ID: SPEC-(\d{2,})-/m);
      if (m && Number(m[1]) === Number(idM[1])) errs.push(`Spec number ${idM[1]} is already used by \`${f}\``);
    }
  }

  // -- sections --
  const plain = unfenced(lines);
  const secs = [];
  plain.forEach((l, i) => { const m = l.match(/^## (.+?)\s*$/); if (m) secs.push({ name: m[1], line: i }); });
  const want = expectedSections(rel);
  const got = secs.map(s => s.name);
  if (got.join("\n") !== want.join("\n")) {
    const missing = want.filter(w => !got.includes(w));
    const extra = got.filter(g => !want.includes(g));
    let msg = "sections must be exactly, in order: " + want.join(" · ");
    if (missing.length) msg += ` — missing: ${missing.join(", ")}`;
    if (extra.length) msg += ` — unexpected: ${extra.join(", ")}`;
    if (!missing.length && !extra.length) msg += " — wrong order";
    errs.push(msg);
  }
  const body = {};
  secs.forEach((s, k) => {
    const end = k + 1 < secs.length ? secs[k + 1].line : lines.length;
    body[s.name] = { start: s.line + 1, plain: plain.slice(s.line + 1, end), raw: lines.slice(s.line + 1, end) };
  });
  for (const s of secs) {
    if (!body[s.name].raw.some(l => l.trim() !== "")) errs.push(`section \`${s.name}\` is empty — write \`None.\` and why`);
  }

  // -- items --
  const items = {}; // id -> { prefix, text, section }
  for (const [sec, prefix] of Object.entries(ITEM_PREFIX)) {
    const b = body[sec];
    if (!b) continue;
    const list = parseItems(b.plain);
    for (const it of list) {
      if (it.prefix !== prefix) { errs.push(`\`${it.id}\` does not belong in \`${sec}\` (expected ${prefix}-n)`); continue; }
      if (items[it.id]) { errs.push(`duplicate ID \`${it.id}\``); continue; }
      items[it.id] = { ...it, section: sec };
    }
    const isNone = b.plain.some(l => /^None\./.test(l.trim()));
    if (!list.length && ["User stories", "Acceptance criteria (EARS)"].includes(sec)) {
      errs.push(`\`${sec}\` needs at least one ${prefix}-n item`);
    } else if (!list.length && !isNone && b.plain.some(l => l.trim() !== "")) {
      errs.push(`\`${sec}\` has text but no \`- **${prefix}-n**\` items — use items, or write \`None.\``);
    }
  }
  const ids = Object.keys(items);
  const has = id => Object.prototype.hasOwnProperty.call(items, id);
  const refs = t => (t.match(/\b(?:US|AC|EC|NFR|A|Q)-\d+\b/g) || []);
  const isIfAc = id => has(id) && /^IF\b/.test(acSentence(items[id].text, rel).sentence || "");

  for (const id of ids) {
    const it = items[id];
    const t = it.text;
    if (it.prefix === "US") {
      if (!/\bAs an? .+, I want .+, so that .+/.test(t)) errs.push(`${id}: use "As a <user>, I want <goal>, so that <benefit>."`);
      const r = (t.split("→")[1] || "");
      const acs = refs(r).filter(x => x.startsWith("AC-"));
      if (!acs.length) errs.push(`${id}: must point to at least one AC-n after \`→\``);
      for (const a of acs) if (!has(a)) errs.push(`${id}: points to unknown \`${a}\``);
    } else if (it.prefix === "AC") {
      const { tag, sentence } = acSentence(t, rel);
      if (rel.startsWith("specs/") && !tag) errs.push(`${id}: a cross-module criterion needs a package tag ([${PACKAGES.join("] [")}])`);
      if (!/^(The|WHEN|WHILE|IF|WHERE)\b/.test(sentence)) errs.push(`${id}: must start with The / WHEN / WHILE / IF / WHERE (EARS)`);
      if (!/\bshall\b/.test(sentence)) errs.push(`${id}: must contain \`shall\``);
      if (/^IF\b/.test(sentence) && !/\bTHEN\b/.test(sentence)) errs.push(`${id}: IF needs THEN`);
      if (!VERIFY_RE.test(t)) errs.push(`${id}: must end with \`*Verify: unit | it | e2e | manual*\` (join several with " + ")`);
      const v = sentence.replace(/"[^"]*"|`[^`]*`/g, "").match(VAGUE_RE);
      if (v) errs.push(`${id}: vague word \`${v[1]}\` — give a number, a state or the exact text`);
    } else if (it.prefix === "EC") {
      const acs = refs(t.split("→")[1] || "").filter(x => x.startsWith("AC-"));
      if (!acs.length) errs.push(`${id}: must point to at least one AC-n after \`→\``);
      for (const a of acs) if (!has(a)) errs.push(`${id}: points to unknown \`${a}\``);
      if (acs.length && !acs.some(isIfAc)) errs.push(`${id}: must point to at least one IF … THEN criterion`);
    } else if (it.prefix === "NFR") {
      if (!/\d/.test(t)) errs.push(`${id}: needs a number and unit`);
      if (!VERIFY_RE.test(t)) errs.push(`${id}: must end with \`*Verify: …*\``);
      const v = t.replace(/"[^"]*"|`[^`]*`/g, "").match(VAGUE_RE);
      if (v) errs.push(`${id}: vague word \`${v[1]}\``);
    } else if (it.prefix === "A") {
      if (!/Risk if wrong:/.test(t)) errs.push(`${id}: add "Risk if wrong: <one line>."`);
    } else if (it.prefix === "Q") {
      const m = t.match(/^\((blocking|non-blocking|planner)\)/);
      if (!m) errs.push(`${id}: start with (blocking), (non-blocking) or (planner)`);
      else if (m[1] === "blocking" && status && status !== "draft") errs.push(`${id}: a (blocking) question is not allowed in an ${status} spec`);
    }
  }

  // -- [NEEDS CLARIFICATION: Q-n] markers: an open question shown where the text depends on it --
  const qBody = body["Open questions"];
  const inQ = i => qBody && i >= qBody.start && i < qBody.start + qBody.plain.length;
  const isBlocking = id => has(id) && /^\(blocking\)/.test(items[id].text);
  const marked = new Set();
  plain.forEach((l, i) => {
    if (inQ(i)) return;
    for (const mk of l.replace(/`[^`]*`/g, "").matchAll(/\[NEEDS CLARIFICATION\b[^\]]*\]?/g)) {
      const q = mk[0].match(/^\[NEEDS CLARIFICATION: (Q-\d+)\]$/);
      if (!q) { errs.push(`line ${i + 1}: write the marker as \`[NEEDS CLARIFICATION: Q-n]\``); continue; }
      if (status && status !== "draft") { errs.push(`line ${i + 1}: \`${mk[0]}\` is not allowed in an ${status} spec`); continue; }
      if (!has(q[1])) errs.push(`line ${i + 1}: \`${mk[0]}\` points to unknown \`${q[1]}\``);
      else if (!isBlocking(q[1])) errs.push(`line ${i + 1}: \`${q[1]}\` is not (blocking) — settle the text and remove the marker`);
      marked.add(q[1]);
    }
  });
  for (const id of ids) {
    if (isBlocking(id) && !marked.has(id)) errs.push(`${id}: a (blocking) question needs at least one \`[NEEDS CLARIFICATION: ${id}]\` marker where the spec text depends on it`);
  }

  // -- traceability --
  const tb = body["Traceability"];
  if (tb) {
    const rows = {};
    for (const l of tb.plain) {
      const m = l.match(/^\|\s*(AC-\d+)\s*\|(.*)\|\s*$/);
      if (!m) continue;
      const cells = m[2].split("|").map(c => c.trim());
      if (rows[m[1]]) errs.push(`Traceability: duplicate row for \`${m[1]}\``);
      rows[m[1]] = cells;
      if (!has(m[1])) errs.push(`Traceability: unknown \`${m[1]}\``);
      for (const r of refs(cells.join(" "))) if (!has(r)) errs.push(`Traceability: \`${m[1]}\` row cites unknown \`${r}\``);
      const verify = cells[cells.length - 1] || "";
      if (!new RegExp(`^${VERIFY}$`).test(verify)) errs.push(`Traceability: \`${m[1]}\` needs a Verify value (unit | it | e2e | manual)`);
      else if (has(m[1])) {
        const vm = items[m[1]].text.match(VERIFY_RE);
        if (vm && vm[1] !== verify) errs.push(`Traceability: \`${m[1]}\` Verify \`${verify}\` differs from the criterion (\`${vm[1]}\`)`);
      }
    }
    for (const id of ids) if (id.startsWith("AC-") && !rows[id]) errs.push(`Traceability: no row for \`${id}\``);
  }
  return errs;
}

function acSentence(t, rel) {
  const m = t.match(/^\[([a-z-]+)\]\s*(.*)$/s);
  const tag = m && PACKAGES.includes(m[1]) ? m[1] : null;
  return { tag, sentence: (m ? m[2] : t).trim() };
}

// `- **XX-n** text` plus indented continuation lines.
function parseItems(plain) {
  const out = [];
  let cur = null;
  for (const l of plain) {
    const m = l.match(/^- \*\*([A-Z]+)-(\d+)\*\*\s*(.*)$/);
    if (m) { cur = { prefix: m[1], id: `${m[1]}-${m[2]}`, text: m[3] }; out.push(cur); continue; }
    if (cur && /^\s{2,}\S/.test(l)) { cur.text += " " + l.trim(); continue; }
    cur = null;
  }
  return out;
}

function listSpecs(root) {
  const out = [];
  const dirs = [...PACKAGES.map(p => `${p}/.spec`), "specs"];
  for (const d of dirs) {
    let names; try { names = fs.readdirSync(path.join(root, d)); } catch { continue; }
    for (const n of names) if (n.endsWith(".spec.md")) out.push(`${d}/${n}`);
  }
  return out;
}

function projectRoot(json) {
  return process.env.CLAUDE_PROJECT_DIR || (typeof json?.cwd === "string" ? json.cwd : process.cwd());
}

function relOf(root, file) {
  const abs = path.isAbsolute(file) ? file : path.resolve(root, file);
  return path.relative(root, abs).split(path.sep).join("/");
}

function inScope(rel, content) {
  return ROLE_RE.test(rel) && /^Spec ID:/m.test(content);
}

function report(rel, errs) {
  return `spec-lint: ${rel} has ${errs.length} format error(s) (format of record: specs/README.md):\n` +
    errs.map(e => `  - ${e}`).join("\n") + "\n";
}

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, "utf8")); }
  catch { process.stderr.write("spec-lint: could not parse hook JSON — allowing (fail-open)\n"); process.exit(0); }
}

function hookPre() {
  const j = readStdin();
  const ti = j?.tool_input || {};
  const file = ti.file_path;
  if (typeof file !== "string") process.exit(0);
  const root = projectRoot(j);
  const rel = relOf(root, file);
  let next;
  if (j.tool_name === "Write") next = typeof ti.content === "string" ? ti.content : "";
  else if (j.tool_name === "Edit") {
    let cur; try { cur = fs.readFileSync(path.resolve(root, file), "utf8"); } catch { process.exit(0); }
    if (typeof ti.old_string !== "string" || typeof ti.new_string !== "string" || !cur.includes(ti.old_string)) process.exit(0);
    next = ti.replace_all === true ? cur.split(ti.old_string).join(ti.new_string) : cur.replace(ti.old_string, () => ti.new_string);
  } else process.exit(0);
  if (!inScope(rel, next)) process.exit(0);
  const st = (next.match(/^Status: (\w+)/m) || [])[1];
  if (st !== "approved" && st !== "implemented") process.exit(0);
  const errs = lint(next, rel, root);
  if (!errs.length) process.exit(0);
  process.stderr.write("BLOCKED by spec-lint: a spec cannot become `" + st + "` with format errors — fix the draft first.\n" + report(rel, errs));
  process.exit(2);
}

function hookPost() {
  const j = readStdin();
  const file = j?.tool_input?.file_path;
  if (typeof file !== "string") process.exit(0);
  const root = projectRoot(j);
  const rel = relOf(root, file);
  let txt; try { txt = fs.readFileSync(path.resolve(root, file), "utf8"); } catch { process.exit(0); }
  if (!inScope(rel, txt)) process.exit(0);
  const errs = lint(txt, rel, root);
  if (!errs.length) process.exit(0);
  process.stderr.write(report(rel, errs) + "Fix them with Edit while the spec is a draft.\n");
  process.exit(2);
}

function check(files) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let bad = 0;
  for (const f of files) {
    const rel = relOf(root, f);
    const txt = fs.readFileSync(path.resolve(root, f), "utf8");
    if (!inScope(rel, txt)) { process.stdout.write(`skip  ${rel} (not a spec path, or no Spec ID line)\n`); continue; }
    const errs = lint(txt, rel, root);
    if (errs.length) { bad++; process.stdout.write(report(rel, errs)); }
    else process.stdout.write(`ok    ${rel}\n`);
  }
  process.exit(bad ? 1 : 0);
}

function selfTest() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const example = fs.readFileSync(path.join(here, "../skills/spec-writing/references/intent-card.spec.md"), "utf8");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spec-lint-"));
  let fails = 0;
  const run = (name, rel, content, wantOk, other) => {
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const d of ["specs", "client/.spec"]) fs.mkdirSync(path.join(tmp, d), { recursive: true });
    if (other) fs.writeFileSync(path.join(tmp, other.rel), other.content);
    const errs = lint(content, rel, tmp);
    const ok = errs.length === 0;
    if (ok === wantOk) process.stdout.write(`ok    ${name}\n`);
    else { fails++; process.stdout.write(`FAIL  ${name} (want ${wantOk ? "clean" : "errors"}, got ${JSON.stringify(errs)})\n`); }
  };
  const R = "specs/intent-card.spec.md";
  const sub = (a, b) => { if (!example.includes(a)) throw new Error("self-test fixture drift: " + a); return example.replace(a, b); };

  run("reference example is clean", R, example, true);
  run("approved example is clean", R, sub("Status: draft", "Status: approved"), true);
  run("bad title", R, sub("# Spec: PR intent card", "# PR intent card"), false);
  run("slug differs from file name", "specs/other.spec.md", example, false);
  run("Spec ID without slug", R, sub("SPEC-00-intent-card", "SPEC-00"), false);
  run("bad status", R, sub("Status: draft", "Status: wip"), false);
  run("bad Supersedes", R, sub("Supersedes: none", "Supersedes: old one"), false);
  run("duplicate global number", R, example, false, { rel: "client/.spec/x.spec.md", content: "# Spec: x\nSpec ID: SPEC-00-x\n" });
  run("missing section", R, sub("## Assumptions\n", ""), false);
  run("Module interactions missing in specs/", R, sub("## Module interactions", "## Interactions"), false);
  run("Module interactions not allowed in <pkg>/.spec", "client/.spec/intent-card.spec.md", example, false);
  run("empty section", R, sub("## Untrusted inputs\n\n- PR title", "## Untrusted inputs\n\n## Junk\n- PR title"), false);
  run("AC without shall", R, sub("the Overview tab shall show\n  the intent card", "the Overview tab shows\n  the intent card"), false);
  run("AC without EARS trigger", R, sub("**AC-1** [client] WHEN the user", "**AC-1** [client] Once the user"), false);
  run("IF without THEN", R, sub("IF no intent exists for the PR, THEN the", "IF no intent exists for the PR, the"), false);
  run("AC without Verify", R, sub("above the Description. *Verify: e2e*", "above the Description."), false);
  run("AC with bad Verify", R, sub("above the Description. *Verify: e2e*", "above the Description. *Verify: browser*"), false);
  run("AC without package tag in specs/", R, sub("**AC-1** [client] WHEN", "**AC-1** WHEN"), false);
  run("AC vague word", R, sub("show\n  the intent card above", "quickly show\n  the intent card above"), false);
  run("vague word inside quotes is fine", R, sub("\"No intent derived yet\"", "\"Easy start\""), true);
  run("duplicate AC ID", R, sub("**AC-2** [client]", "**AC-1** [client]"), false);
  run("US without AC link", R, sub("before I read findings. → AC-1, AC-2", "before I read findings."), false);
  run("US points to unknown AC", R, sub("→ AC-6, AC-7", "→ AC-6, AC-77"), false);
  run("US not in story form", R, sub("**US-3** As a reviewer, I want", "**US-3** Reviewer wants"), false);
  run("EC without IF criterion", R, sub("**EC-1** The PR was never analysed, so no intent exists. → AC-8", "**EC-1** The PR was never analysed, so no intent exists. → AC-1"), false);
  run("NFR without number", R, sub("within 300 ms at p95", "within a short time at peak"), false);
  run("Assumption without risk", R, sub("Risk if wrong: the server needs a\n  contract change first.", "That is all."), false);
  run("Q without kind", R, sub("**Q-1** (non-blocking) Should", "**Q-1** Should"), false);
  const blockingQ = sub("**Q-1** (non-blocking)", "**Q-1** (blocking)");
  const markedQ = blockingQ.replace("above the Description. *Verify: e2e*", "above the Description [NEEDS CLARIFICATION: Q-1]. *Verify: e2e*");
  run("blocking Q with a marker in draft is fine", R, markedQ, true);
  run("blocking Q without a marker", R, blockingQ, false);
  run("blocking Q in approved", R, markedQ.replace("Status: draft", "Status: approved"), false);
  run("marker in approved", R, sub("above the Description. *Verify: e2e*", "above the Description [NEEDS CLARIFICATION: Q-1]. *Verify: e2e*").replace("Status: draft", "Status: approved"), false);
  run("marker on a non-blocking Q", R, sub("above the Description. *Verify: e2e*", "above the Description [NEEDS CLARIFICATION: Q-1]. *Verify: e2e*"), false);
  run("marker to unknown Q", R, markedQ.replace("[NEEDS CLARIFICATION: Q-1]", "[NEEDS CLARIFICATION: Q-9] [NEEDS CLARIFICATION: Q-1]"), false);
  run("malformed marker", R, markedQ.replace("[NEEDS CLARIFICATION: Q-1]", "[NEEDS CLARIFICATION: Q-1] [NEEDS CLARIFICATION]"), false);
  run("marker inside inline code is ignored", R, sub("above the Description. *Verify: e2e*", "above the Description `[NEEDS CLARIFICATION]`. *Verify: e2e*"), true);
  run("Traceability row missing", R, sub("| AC-11 | — | EC-4 | — | unit |\n", ""), false);
  run("Traceability unknown ID", R, sub("| AC-2 | US-1 | — | — | unit |", "| AC-2 | US-9 | — | — | unit |"), false);
  run("Traceability Verify differs", R, sub("| AC-3 | US-2 | — | NFR-1 | it |", "| AC-3 | US-2 | — | NFR-1 | unit |"), false);
  run("diagram headings inside a fence are ignored", R, sub("sequenceDiagram", "sequenceDiagram\n## not a section"), true);

  // hook dispatch: pre blocks a broken approve, allows a broken draft; post feeds back.
  const hook = (mode, json) => {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), mode], { input: JSON.stringify(json), env: { ...process.env, CLAUDE_PROJECT_DIR: tmp } });
    return r.status;
  };
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, "specs"), { recursive: true });
  const broken = example.replace("*Verify: e2e*\n- **AC-2**", "\n- **AC-2**");
  fs.writeFileSync(path.join(tmp, R), broken);
  const expect = (name, got, want) => { if (got === want) process.stdout.write(`ok    ${name}\n`); else { fails++; process.stdout.write(`FAIL  ${name} (want exit ${want}, got ${got})\n`); } };
  expect("pre: Edit to approved on a broken draft is blocked", hook("pre", { tool_name: "Edit", tool_input: { file_path: R, old_string: "Status: draft", new_string: "Status: approved" } }), 2);
  expect("pre: Edit on a broken draft stays allowed", hook("pre", { tool_name: "Edit", tool_input: { file_path: R, old_string: "Problem and user", new_string: "Problem and user" } }), 0);
  expect("pre: Write of a clean approved spec is allowed", hook("pre", { tool_name: "Write", tool_input: { file_path: "specs/new.spec.md", content: example.replace(/intent-card/g, "new").replace("Status: draft", "Status: approved").replace("SPEC-00-", "SPEC-01-") } }), 0);
  expect("post: broken draft feeds errors back", hook("post", { tool_name: "Edit", tool_input: { file_path: R } }), 2);
  fs.writeFileSync(path.join(tmp, R), example);
  expect("post: clean draft passes", hook("post", { tool_name: "Edit", tool_input: { file_path: R } }), 0);
  expect("post: non-spec path is ignored", hook("post", { tool_name: "Write", tool_input: { file_path: "docs/x.md" } }), 0);
  fs.writeFileSync(path.join(tmp, "specs/old.spec.md"), "# Old format\n\n## Goal\n");
  expect("post: old-format spec without Spec ID is ignored", hook("post", { tool_name: "Edit", tool_input: { file_path: "specs/old.spec.md" } }), 0);
  expect("pre: garbage stdin fails open", spawnSync(process.execPath, [fileURLToPath(import.meta.url), "pre"], { input: "garbage" }).status, 0);

  fs.rmSync(tmp, { recursive: true, force: true });
  process.stdout.write(`\n${fails} failing case(s)\n`);
  process.exit(fails ? 1 : 0);
}

const [mode, ...rest] = process.argv.slice(2);
try {
  if (mode === "pre") hookPre();
  else if (mode === "post") hookPost();
  else if (mode === "check") check(rest);
  else if (mode === "self-test") selfTest();
  else { process.stderr.write("usage: spec-lint.mjs check <file>... | pre | post | self-test\n"); process.exit(mode ? 2 : 0); }
} catch (e) {
  if (mode === "self-test" || mode === "check") throw e;
  process.stderr.write(`spec-lint: internal error (${e && e.message}) — allowing (fail-open)\n`);
  process.exit(0);
}
