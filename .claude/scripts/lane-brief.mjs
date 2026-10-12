#!/usr/bin/env node
// Prints the slice of a Development Plan that one lane needs: the header, Goal, the
// acceptance criteria its steps cover, Constraints and every other non-review section,
// its Steps rows, its Execution row, its Test-plan rows and the Plan status line.
// The implementer reads this brief instead of the whole plan (plans run to ~100 KB).
//
// Usage: node .claude/scripts/lane-brief.mjs docs/plans/<feature>.plan.md L<n>
//        node .claude/scripts/lane-brief.mjs docs/plans/<feature>.plan.md --lanes
// A plan without a `Lane` column in its Steps table is one lane: every step is returned.

import { readFileSync } from "node:fs";

const [planPath, lane] = process.argv.slice(2);
if (!planPath || !lane) {
  console.error("usage: lane-brief.mjs <plan.md> <L<n> | --lanes>");
  process.exit(2);
}

const text = readFileSync(planPath, "utf8");
const lines = text.split("\n");

// Sections the implementer does not need: they are planning history or reviewer input.
const DROP = [/^requirements review/i, /^recommendations/i, /^review hand-off/i, /^revisions/i];
// Sections filtered row by row instead of copied whole.
const FILTERED = {
  steps: /^steps\b/i,
  execution: /^execution\b/i,
  tests: /^test plan\b/i,
  acs: /^acceptance criteria\b/i,
};

const STATUS = /^\*\*Plan status:\*\*/;

// Split a Markdown table row on `|` that is neither escaped nor inside a code span.
function cells(row) {
  const out = [];
  let cur = "";
  let tick = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === "\\" && row[i + 1] === "|") { cur += "\\|"; i++; continue; }
    if (c === "`") tick = !tick;
    if (c === "|" && !tick) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out.slice(1, -1);
}

// Expand "S1–S4, S7" / "AC2-AC3" into a Set of normalized IDs ("S1", "AC2").
function ids(cell) {
  const set = new Set();
  const norm = (p, n) => `${p.toUpperCase()}${Number(n)}`;
  const re = /\b(AC|S|T|L)-?(\d+)(?:\s*[–-]\s*(?:\1-?)?(\d+))?/gi;
  for (const m of cell.matchAll(re)) {
    const from = Number(m[2]);
    const to = m[3] ? Number(m[3]) : from;
    for (let n = from; n <= to && n - from < 200; n++) set.add(norm(m[1], n));
  }
  return set;
}

// Group lines into sections by `## ` heading; index 0 is the preamble (title + header line).
const sections = [];
let current = { title: "", body: [] };
for (const line of lines) {
  if (line.startsWith("## ")) {
    sections.push(current);
    current = { title: line.slice(3).trim(), body: [line] };
  } else current.body.push(line);
}
sections.push(current);

const find = (re) => sections.find((s) => re.test(s.title));

function table(section) {
  if (!section) return null;
  const start = section.body.findIndex((l) => l.trim().startsWith("|"));
  if (start < 0) return null;
  const rows = [];
  for (let i = start; i < section.body.length && section.body[i].trim().startsWith("|"); i++) {
    rows.push(section.body[i]);
  }
  return { start, rows, header: cells(rows[0]) };
}

const steps = table(find(FILTERED.steps));
if (!steps) {
  console.error(`${planPath}: no ## Steps table`);
  process.exit(1);
}
const laneCol = steps.header.findIndex((h) => /^lane$/i.test(h));
const coversCol = steps.header.findIndex((h) => /^covers$/i.test(h));
const stepRows = steps.rows.slice(2);
const laneOf = (row) => (laneCol < 0 ? "L1" : cells(row)[laneCol] ?? "");

const tests = table(find(FILTERED.tests));
const testLaneCol = tests ? tests.header.findIndex((h) => /^lane$/i.test(h)) : -1;
const testCoversCol = tests ? tests.header.findIndex((h) => /^covers$/i.test(h)) : -1;
const testRows = tests ? tests.rows.slice(2) : [];
const exec = table(find(FILTERED.execution));
const execRows = exec ? exec.rows.slice(2) : [];

if (lane === "--lanes") {
  // Lanes come from the Execution table; a plan without one is a single lane L1.
  const names = execRows.length ? execRows.map((r) => [...ids(cells(r)[0])][0]).filter(Boolean) : ["L1"];
  for (const l of names) {
    const agent = execRows.length ? cells(execRows.find((r) => ids(cells(r)[0]).has(l)))[1] : "implementer";
    const n = stepRows.filter((r) => ids(laneOf(r)).has(l)).length;
    const t = testLaneCol < 0 ? 0 : testRows.filter((r) => ids(cells(r)[testLaneCol]).has(l)).length;
    console.log(`${l}\t${agent}\t${n} steps\t${t} tests`);
  }
  process.exit(0);
}

const want = lane.toUpperCase();
const mine = stepRows.filter((r) => ids(laneOf(r)).has(want));
const myTests = testLaneCol < 0 ? [] : testRows.filter((r) => ids(cells(r)[testLaneCol]).has(want));
if (mine.length === 0 && myTests.length === 0) {
  console.error(`${planPath}: no step or test is assigned to ${want}`);
  process.exit(1);
}
// The IDs this lane works on: its own steps and tests, and every AC they cover. A Test-plan
// row covering one of those ACs is shown too — a red test written by another lane is the
// target this lane has to turn green.
const myIds = new Set();
for (const r of mine) {
  for (const id of ids(cells(r)[0])) myIds.add(id);
  if (coversCol >= 0) for (const id of ids(cells(r)[coversCol])) myIds.add(id);
}
for (const r of myTests) {
  for (const id of ids(cells(r)[0])) myIds.add(id);
  if (testCoversCol >= 0) for (const id of ids(cells(r)[testCoversCol])) myIds.add(id);
}

const out = [];
const emit = (...ls) => out.push(...ls);

emit(...sections[0].body, `> Lane brief for **${want}** — generated by \`.claude/scripts/lane-brief.mjs\` from \`${planPath}\`. The plan file is the source of truth; read a dropped section only when a step cites it.`, "");

for (const s of sections.slice(1)) {
  if (DROP.some((re) => re.test(s.title))) continue;

  if (FILTERED.acs.test(s.title)) {
    // Numbered list items, possibly wrapped over several lines; keep the ones this lane covers.
    emit(s.body[0]);
    let keep = false;
    for (const l of s.body.slice(1)) {
      const item = l.match(/^\s*\d+\.\s/);
      if (item) keep = [...ids(l.split("—")[0])].some((id) => myIds.has(id));
      if (keep) emit(l);
    }
    emit("");
    continue;
  }

  if (FILTERED.steps.test(s.title) || FILTERED.execution.test(s.title) || FILTERED.tests.test(s.title)) {
    const t = table(s);
    if (!t) { emit(...s.body); continue; }
    const lc = t.header.findIndex((h) => /^lane$/i.test(h));
    const cc = t.header.findIndex((h) => /^covers$/i.test(h));
    const keepRow = (row) => {
      const c = cells(row);
      if (FILTERED.steps.test(s.title)) return mine.includes(row);
      if (FILTERED.execution.test(s.title)) return ids(c[0]).has(want);
      if (lc >= 0 && ids(c[lc]).has(want)) return true;
      return cc >= 0 && [...ids(c[cc])].some((id) => myIds.has(id) && id.startsWith("AC"));
    };
    emit(...s.body.slice(0, t.start), t.rows[0], t.rows[1], ...t.rows.slice(2).filter(keepRow));
    emit(...s.body.slice(t.start + t.rows.length));
    continue;
  }

  emit(...s.body.filter((l) => !STATUS.test(l)));
}

// The trailing status line lives in the last (dropped) section; the plan gate needs it.
emit("", lines.find((l) => STATUS.test(l)) ?? "**Plan status:** <missing>");
console.log(out.join("\n").replace(/\n{3,}/g, "\n\n"));
