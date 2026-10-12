import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md → AGENTS.md + skills +
 * subagents, loaded via settingSources:["project"]) behaves as documented. Organized by scenario,
 * not by a single artifact, because these behaviors are cross-cutting.
 *
 * Evidence is the trace only: a subagent counts when an Agent/Task tool_use names it, a file counts
 * when a Read/Grep tool_use targets it. Prose like "I ran the reviewer" proves nothing.
 *
 * Every expected path is a routing target named in AGENTS.md ("Read when" / "Session protocol") —
 * keep them in sync when those files change. A path must NOT appear in its own prompt: reads are
 * recorded from tool_use inputs, so a control run could "read" a path it was simply told.
 *
 * Budget: 7 Claude sessions total.
 *   - 1 × dispatch                                        = 1
 *   - 1 × activation pair (positive + near-miss negative) = 2
 *   - 1 × contrast (treatment + control)                  = 2
 *   - 2 × trace     → 1 session each                      = 2
 */
export const cases: WorkflowCase[] = [
  // --- dispatch (1 session): an architecture-review task spawns architecture-reviewer ----------
  {
    kind: "dispatch",
    // The plan must describe code that does NOT exist yet (GET /reviews/:id/export is absent from
    // the server routes), or the model reviews existing code inline instead of dispatching.
    // The subagent is not named — the task alone has to route to it.
    name: "architecture-review task dispatches the architecture-reviewer subagent",
    prompt:
      "Потрібне архітектурне рев'ю мого плану. Я хочу додати НОВИЙ, ще не реалізований ендпоінт " +
      "GET /reviews/:id/export (віддає ревʼю як markdown): у routes.ts модуля reviews одразу імпортую " +
      "Drizzle-клієнт і роблю запит у БД прямо з хендлера, без сервісу. Доручи рев'ю профільному " +
      "рев'юеру архітектури цього репо — не рецензуй сам.",
    expectSubagent: "architecture-reviewer",
    maxTurns: 6,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    kind: "activation",
    name: "engineering-insights activates on a found bug cause",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — a plain question must NOT activate engineering-insights",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },

  // --- contrast (2 sessions): CLAUDE.md effect, treatment vs isolated control -------------------
  {
    kind: "contrast",
    // Treatment: real repo + project settings → AGENTS.md "Implementing a feature" routes to the
    // spec. Control: empty tmpdir, settingSources:[] → no CLAUDE.md, no repo, so it cannot find it.
    name: "CLAUDE.md routes a feature task to its .spec (treatment reads, control does not)",
    prompt:
      "Мені треба доробити фічу smart-diff на сервері. Перш ніж писати код — за настановами цього " +
      "репо знайди й прочитай документ, з якого треба починати реалізацію фічі.",
    expectFileRead: "server/.spec/smart-diff.spec.md",
    tools: ["Read", "Grep", "Glob"],
    maxTurns: 8,
  },

  // --- trace (1 session): "Touching any package" + Session protocol → AGENTS.md AND INSIGHTS.md --
  {
    kind: "trace",
    name: "package task reads the package AGENTS.md and INSIGHTS.md",
    prompt:
      "Я збираюся вносити зміни в пакет reviewer-core. Перш ніж торкатися коду — звірся з настановами " +
      "цього репо щодо того, що треба прочитати перед роботою в пакеті, і прочитай саме ці файли.",
    expectFilesRead: ["reviewer-core/AGENTS.md", "reviewer-core/INSIGHTS.md"],
    maxTurns: 8,
  },

  // --- trace (1 session): "Changing tests or CI" → TESTING.md -----------------------------------
  {
    kind: "trace",
    name: "tests/CI task follows AGENTS.md routing to TESTING.md",
    prompt:
      "Я хочу змінити, як у репо запускаються тести в CI. За настановами цього репо — який документ " +
      "треба прочитати перед такою зміною? Прочитай його.",
    expectFilesRead: ["TESTING.md"],
    maxTurns: 5,
  },
];
