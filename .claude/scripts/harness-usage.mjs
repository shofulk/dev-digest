#!/usr/bin/env node
// Prints a Markdown digest of how the agent harness was actually used in this repo, read
// from the local Claude Code transcripts: tokens per feature (git branch), per agent type
// and per run, which skills were invoked, and the anomalies the harness-analyst clusters.
// The analyst cannot count tokens itself (bash readonly, transcripts live outside the
// repo), so this script does the counting and the analyst reasons over its output.
//
// Usage: node .claude/scripts/harness-usage.mjs        (no arguments, run from the repo root)
//
// Reads only. Sources: <config>/projects/<slug>*/<session>.jsonl (main sessions) and
// <session>/subagents/agent-*.jsonl + .meta.json (subagent runs, `agentType` in the meta),
// where <config> is $CLAUDE_CONFIG_DIR or ~/.claude and <slug> is the repo root path with
// every non-alphanumeric character replaced by `-` (`<slug>-server` etc. are the sessions
// started in a sub-directory, and are included).
//
// Counting rules:
// - One API response is written as several JSONL lines (one per content block), each
//   carrying the same `usage` — tokens are counted once per `message.id`.
// - "input" = input_tokens + cache_creation_input_tokens + cache_read_input_tokens: what
//   the model read on that turn. It grows with context, so it is the cost lever.
// - Skills are counted two ways. "Called": a `Skill` tool call, or a user-typed `/<name>`
//   slash command that is not a built-in (a string user message). "Preloaded": a skill an
//   agent's `skills:` frontmatter injected at start — it shows as a `<command-name>` text
//   block in an `isMeta` user message of the subagent transcript, never as a `Skill` call.
// - Feature = the plan a run works on: the `docs/plans/<slug>.plan.md` or
//   `.harness/retros/<slug>.retro.md` named most often in the run's own prompts; a run that
//   names none inherits its session's most-named plan, else `branch:<git branch>`. A branch
//   is not a feature — one branch often carries several plans.
// - A subagent resumed in a later session writes a second transcript under that session
//   with the same agent id and no .meta.json; it takes the original run's type and is
//   marked `(resumed)`. Message ids are deduplicated across all files, so the overlap is
//   counted once.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

if (process.argv.length > 2) {
  console.error("usage: harness-usage.mjs   (takes no arguments)");
  process.exit(2);
}

// Thresholds — the analyst cites these; change them here, not in the prompt.
const OUTLIER_FACTOR = 2; // run input > factor × median of its agent type
const OUTLIER_MIN_RUNS = 5; // …and only when that type has at least this many runs
const REPEAT_AGENT_MIN = 3; // same agent type launched ≥ n times in one session
const REPEAT_CMD_MIN = 3; // identical Bash command ≥ n times in one run
const TOP = 15; // rows per ranked table

const BUILTIN_COMMANDS = new Set([
  "clear", "compact", "model", "agents", "context", "memory", "mcp", "config", "help",
  "resume", "login", "logout", "cost", "status", "rename", "rc", "exit", "init", "doctor",
  "permissions", "hooks", "ide", "plugin", "plugins", "add-dir", "fast", "vim", "theme",
  "usage", "export", "list-agents", "statusline", "terminal-setup", "bug", "review",
]);

const root = process.cwd();
const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const projectsDir = join(configDir, "projects");
const slug = root.replace(/[^A-Za-z0-9]/g, "-");

if (!existsSync(projectsDir)) {
  console.log(`No transcripts: \`${projectsDir}\` does not exist.`);
  process.exit(0);
}
const projectDirs = readdirSync(projectsDir)
  .filter((d) => d === slug || d.startsWith(slug + "-"))
  .map((d) => join(projectsDir, d));

function readJsonl(path) {
  const out = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn last line of a live session */ }
  }
  return out;
}

const PLAN_RE = /(?:docs\/plans|\.harness\/retros)\/([a-z0-9][a-z0-9-]*)\.(?:plan|retro)\.md/g;
const seen = new Set(); // message ids, across every transcript (see "resumed" above)

// Text the user (or the delegating session) wrote — never a tool result, which would make
// any file the run merely read look like its plan.
function promptText(l) {
  const c = l.message?.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c.filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
}

const topKey = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

// Summarise one transcript (main session or subagent run).
function summarise(lines) {
  const s = {
    turns: 0, input: 0, output: 0, peak: 0, models: new Set(), branch: null,
    start: null, end: null, skills: [], preloaded: [], agents: [], bash: new Map(), plans: new Map(),
  };
  for (const l of lines) {
    if (l.gitBranch && !s.branch) s.branch = l.gitBranch;
    if (l.timestamp) {
      if (!s.start || l.timestamp < s.start) s.start = l.timestamp;
      if (!s.end || l.timestamp > s.end) s.end = l.timestamp;
    }
    if (l.type === "user") {
      const text = promptText(l);
      const m = /<command-name>\/?([^<\s]+)<\/command-name>/.exec(text);
      if (m && l.isMeta) s.preloaded.push(m[1]);
      else if (m && !BUILTIN_COMMANDS.has(m[1])) s.skills.push(m[1]);
      for (const pm of text.matchAll(PLAN_RE)) s.plans.set(pm[1], (s.plans.get(pm[1]) || 0) + 1);
    }
    if (l.type !== "assistant" || !l.message) continue;
    const msg = l.message;
    for (const c of Array.isArray(msg.content) ? msg.content : []) {
      if (c.type !== "tool_use") continue;
      if (c.name === "Skill" && c.input?.skill) s.skills.push(c.input.skill);
      if ((c.name === "Agent" || c.name === "Task") && c.input) {
        s.agents.push(c.input.subagent_type || "general-purpose");
      }
      if (c.name === "Bash" && typeof c.input?.command === "string") {
        const cmd = c.input.command.trim().replace(/\s+/g, " ");
        s.bash.set(cmd, (s.bash.get(cmd) || 0) + 1);
      }
    }
    const id = msg.id || l.requestId || l.uuid;
    if (!msg.usage || seen.has(id)) continue;
    seen.add(id);
    const u = msg.usage;
    const read = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    s.turns++;
    s.input += read;
    s.output += u.output_tokens || 0;
    if (read > s.peak) s.peak = read;
    if (msg.model && msg.model !== "<synthetic>") s.models.add(msg.model);
  }
  return s;
}

const sessions = [];
const runs = [];
for (const dir of projectDirs) {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    const id = f.slice(0, -6);
    const main = summarise(readJsonl(join(dir, f)));
    const session = { id, dir, ...main, runs: [] };
    sessions.push(session);
    const subDir = join(dir, id, "subagents");
    if (!existsSync(subDir) || !statSync(subDir).isDirectory()) continue;
    for (const sf of readdirSync(subDir)) {
      if (!sf.endsWith(".jsonl")) continue;
      let meta = {};
      try { meta = JSON.parse(readFileSync(join(subDir, sf.replace(/\.jsonl$/, ".meta.json")), "utf8")); } catch { /* no meta */ }
      const r = summarise(readJsonl(join(subDir, sf)));
      const run = {
        ...r, session: id, file: sf,
        agentId: sf.slice(0, -6),
        type: meta.agentType || null,
        description: meta.description || "",
        branch: r.branch || main.branch,
        resumed: false,
      };
      runs.push(run);
      session.runs.push(run);
    }
  }
}

// Resumed runs: borrow type/description from the transcript of the same agent id that has
// a .meta.json.
const metaById = new Map(runs.filter((r) => r.type).map((r) => [r.agentId, r]));
for (const r of runs) {
  if (r.type) continue;
  const orig = metaById.get(r.agentId);
  r.type = orig ? orig.type : "unknown";
  r.description = orig ? orig.description : "";
  r.resumed = Boolean(orig);
}

// Feature per run and per session (see the header).
for (const s of sessions) {
  const all = new Map(s.plans);
  for (const r of s.runs) for (const [k, n] of r.plans) all.set(k, (all.get(k) || 0) + n);
  s.feature = topKey(all) || "branch:" + (s.branch || "(none)");
  for (const r of s.runs) r.feature = topKey(r.plans) || s.feature;
}
// A resumed run that names no plan itself continues its original run's feature.
for (const r of runs) {
  if (r.resumed && !r.plans.size) r.feature = metaById.get(r.agentId).feature;
}
const label = (r) => r.type + (r.resumed ? " (resumed)" : "");

// ---- formatting helpers ----
const M = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n));
const day = (ts) => (ts ? ts.slice(0, 10) : "?");
const median = (xs) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
function table(head, rows) {
  if (!rows.length) return "_none_\n";
  return [
    "| " + head.join(" | ") + " |",
    "|" + head.map(() => "---").join("|") + "|",
    ...rows.map((r) => "| " + r.map(cell).join(" | ") + " |"),
  ].join("\n") + "\n";
}
const short = (s, n = 70) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ---- aggregate ----
const totalIn = (s) => s.input + s.runs.reduce((a, r) => a + r.input, 0);
const totalOut = (s) => s.output + s.runs.reduce((a, r) => a + r.output, 0);
const all = sessions.filter((s) => s.turns || s.runs.length);
const starts = all.map((s) => s.start).filter(Boolean).sort();

// A run is billed to its own feature; a main session's own turns to the session's feature.
const ROUND_TYPES = ["implementation-planner", "planner", "implementer", "test-writer", "architecture-reviewer", "plan-verifier", "security-reviewer", "retro-writer"];
const byFeature = new Map();
function feat(k) {
  let b = byFeature.get(k);
  if (!b) {
    b = { sessions: new Set(), branches: new Set(), runs: 0, input: 0, output: 0, first: null, last: null, rounds: new Map(), skills: new Map(), preloaded: new Map() };
    byFeature.set(k, b);
  }
  return b;
}
function touch(b, x) {
  if (x.start && (!b.first || x.start < b.first)) b.first = x.start;
  if (x.end && (!b.last || x.end > b.last)) b.last = x.end;
}
for (const s of all) {
  const b = feat(s.feature);
  b.sessions.add(s.id);
  if (s.branch) b.branches.add(s.branch);
  b.input += s.input;
  b.output += s.output;
  touch(b, s);
  for (const k of s.skills) b.skills.set(k, (b.skills.get(k) || 0) + 1);
  for (const r of s.runs) {
    const rb = feat(r.feature);
    rb.sessions.add(s.id);
    if (r.branch) rb.branches.add(r.branch);
    rb.runs++;
    rb.input += r.input;
    rb.output += r.output;
    touch(rb, r);
    if (!r.resumed) rb.rounds.set(r.type, (rb.rounds.get(r.type) || 0) + 1);
    for (const k of r.skills) rb.skills.set(k, (rb.skills.get(k) || 0) + 1);
    for (const k of r.preloaded) rb.preloaded.set(k, (rb.preloaded.get(k) || 0) + 1);
  }
}
const tally = (m, n = 6) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => k + " ×" + v).join(", ");

const byType = new Map();
for (const r of runs) {
  if (r.resumed) continue; // a continuation, not a separate launch
  const t = byType.get(r.type) || [];
  t.push(r);
  byType.set(r.type, t);
}

const skillCount = new Map();
for (const s of all) {
  for (const [who, list] of [["main", s.skills], ...s.runs.map((r) => [r.type, r.skills])]) {
    for (const k of list) {
      const e = skillCount.get(k) || { calls: 0, sessions: new Set(), by: new Set() };
      e.calls++;
      e.sessions.add(s.id);
      e.by.add(who);
      skillCount.set(k, e);
    }
  }
}

// ---- output ----
const out = [];
out.push("# Harness usage digest\n");
out.push(`Sources: ${projectDirs.map((d) => "`" + d.replace(homedir(), "~") + "`").join(", ") || "_none_"}  `);
out.push(`Sessions: ${all.length} · subagent runs: ${runs.length} · period: ${day(starts[0])} → ${day(starts[starts.length - 1])}  `);
out.push(`Tokens: input = input + cache creation + cache read, counted once per API response. Thresholds: outlier > ${OUTLIER_FACTOR}× type median (types with ≥ ${OUTLIER_MIN_RUNS} runs), repeated agent ≥ ${REPEAT_AGENT_MIN}/session, repeated Bash ≥ ${REPEAT_CMD_MIN}/run.\n`);

out.push("## By feature (plan)\n");
out.push(table(
  ["Feature", "Branches", "Sessions", "Subagent runs", "Input", "Output", "First", "Last"],
  [...byFeature.entries()].sort((a, b) => b[1].input - a[1].input)
    .map(([k, b]) => [k, [...b.branches].join(", "), b.sessions.size, b.runs, M(b.input), M(b.output), day(b.first), day(b.last)]),
));

out.push("\n## Rounds per feature\n");
out.push("Launches per agent type, resumed continuations excluded. More than one implementer or reviewer launch per feature is a fix round (or a lane).\n");
out.push(table(
  ["Feature", ...ROUND_TYPES, "Other"],
  [...byFeature.entries()].filter(([, b]) => b.runs > 0).sort((a, b) => b[1].runs - a[1].runs)
    .map(([k, b]) => [k, ...ROUND_TYPES.map((t) => b.rounds.get(t) || ""),
      tally(new Map([...b.rounds].filter(([t]) => !ROUND_TYPES.includes(t))))]),
));

out.push("\n## Skills per feature\n");
out.push(table(
  ["Feature", "Called (calls)", "Preloaded (runs)"],
  [...byFeature.entries()].filter(([, b]) => b.skills.size || b.preloaded.size).sort((a, b) => b[1].input - a[1].input)
    .map(([k, b]) => [k, tally(b.skills, 12) || "—", tally(b.preloaded, 8) || "—"]),
));

out.push("\n## By agent type\n");
out.push(table(
  ["Agent type", "Runs", "Median turns", "Median input", "Max input", "Total input", "Total output", "Models"],
  [
    ["main session", all.length, median(all.map((s) => s.turns)), M(median(all.map((s) => s.input))),
      M(Math.max(0, ...all.map((s) => s.input))), M(all.reduce((a, s) => a + s.input, 0)),
      M(all.reduce((a, s) => a + s.output, 0)), [...new Set(all.flatMap((s) => [...s.models]))].join(", ")],
    ...[...byType.entries()].sort((a, b) => b[1].reduce((x, r) => x + r.input, 0) - a[1].reduce((x, r) => x + r.input, 0))
      .map(([t, rs]) => [t, rs.length, median(rs.map((r) => r.turns)), M(median(rs.map((r) => r.input))),
        M(Math.max(...rs.map((r) => r.input))), M(rs.reduce((a, r) => a + r.input, 0)),
        M(rs.reduce((a, r) => a + r.output, 0)), [...new Set(rs.flatMap((r) => [...r.models]))].join(", ")]),
  ],
));

out.push(`\n## Most expensive subagent runs (top ${TOP})\n`);
out.push(table(
  ["Agent type", "Feature", "Date", "Turns", "Input", "Peak context", "Skills", "Description", "Transcript"],
  [...runs].sort((a, b) => b.input - a.input).slice(0, TOP)
    .map((r) => [label(r), r.feature, day(r.start), r.turns, M(r.input), M(r.peak), tally(new Map(r.skills.map((k) => [k, r.skills.filter((x) => x === k).length])), 4) || "—", short(r.description), `${r.session}/${r.file}`]),
));

out.push("\n## Skills by agent type\n");
out.push("Runs with at least one `Skill` call, out of all launches of that type; preloaded = injected by the agent's `skills:` frontmatter.\n");
out.push(table(
  ["Agent type", "Runs", "Runs calling Skill", "Calls", "Skills called", "Preloaded"],
  [...byType.entries()].sort((a, b) => b[1].length - a[1].length)
    .map(([t, rs]) => {
      const m = new Map();
      for (const r of rs) for (const k of r.skills) m.set(k, (m.get(k) || 0) + 1);
      const pre = new Map();
      for (const r of rs) for (const k of new Set(r.preloaded)) pre.set(k, (pre.get(k) || 0) + 1);
      return [t, rs.length, rs.filter((r) => r.skills.length).length, [...m.values()].reduce((a, n) => a + n, 0), tally(m, 8) || "—", tally(pre, 6) || "—"];
    }),
));

out.push("\n## Skills invoked\n");
out.push(table(
  ["Skill", "Calls", "Sessions", "Invoked by"],
  [...skillCount.entries()].sort((a, b) => b[1].calls - a[1].calls)
    .map(([k, e]) => [k, e.calls, e.sessions.size, [...e.by].join(", ")]),
));

out.push("\n## Anomalies\n");
out.push("### Cost outliers\n");
const outliers = [];
for (const [t, rs] of byType) {
  if (rs.length < OUTLIER_MIN_RUNS) continue;
  const med = median(rs.map((r) => r.input));
  for (const r of rs) if (med > 0 && r.input > OUTLIER_FACTOR * med) outliers.push([r, med]);
}
out.push(table(
  ["Agent type", "Feature", "Date", "Input", "× median", "Turns", "Description", "Transcript"],
  outliers.sort((a, b) => b[0].input / b[1] - a[0].input / a[1]).slice(0, TOP)
    .map(([r, med]) => [r.type, r.feature, day(r.start), M(r.input), (r.input / med).toFixed(1), r.turns, short(r.description), `${r.session}/${r.file}`]),
));

out.push("\n### Repeated agent launches in one session\n");
const repeated = [];
for (const s of all) {
  const c = new Map();
  for (const r of s.runs) if (!r.resumed) c.set(r.type, (c.get(r.type) || 0) + 1);
  for (const [t, n] of c) if (n >= REPEAT_AGENT_MIN) repeated.push([s, t, n]);
}
out.push(table(
  ["Session", "Feature", "Date", "Agent type", "Launches", "Descriptions"],
  repeated.sort((a, b) => b[2] - a[2]).slice(0, TOP)
    .map(([s, t, n]) => [s.id, s.feature, day(s.start), t, n,
      short(s.runs.filter((r) => r.type === t).map((r) => r.description).join(" / "), 140)]),
));

out.push("\n### Repeated Bash commands in one run\n");
const reps = [];
for (const s of all) {
  for (const [who, b, f] of [["main", s.bash, s.feature], ...s.runs.map((r) => [label(r), r.bash, r.feature])]) {
    for (const [cmd, n] of b) if (n >= REPEAT_CMD_MIN) reps.push([s, who, cmd, n, f]);
  }
}
out.push(table(
  ["Session", "Feature", "Run", "Times", "Command"],
  reps.sort((a, b) => b[3] - a[3]).slice(0, TOP)
    .map(([s, who, cmd, n, f]) => [s.id, f, who, n, "`" + short(cmd.replace(/`/g, "'"), 90) + "`"]),
));

process.stdout.write(out.join("\n"));
