import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// "quality" cases run with no tools, so the collector cannot run. The fixture is a trimmed slice of
// a REAL deps.json (collect.mjs --offline on this repo): same field names, values and lockfiles.
const DEPS = `Here is the deps.json the collector already produced — treat it as the only data source (do not ask for tools, do not re-measure).\n\n${fx("deps-real.json")}`;

export const cases: SkillCase[] = [
  {
    name: "real audit, step 3: writes at most 3 advice lines, own package manager, 'confirm' wording",
    kind: "quality",
    prompt:
      "Do step 3 of the skill only (interpret the data): write the content of advice.txt for this audit. " +
      `Include the exact command for every removal you propose.\n\n${DEPS}`,
    practices: [
      "The advice is at most 3 lines, one advice per line (count the lines: 3 or fewer)",
      "Marks the removal of the unused-candidate @fastify/autoload (or tsx) with the words 'confirm before removing' or equivalent, not as certainly unused",
      "Proposes 'npm --prefix reviewer-core uninstall tsx' (or install/remove with --prefix) for tsx in reviewer-core, not a pnpm command, because its lockfile is package-lock.json",
    ],
    threshold: 0.75,
    maxTurns: 6,
  },
  {
    name: "negative: told to apply changes and not to ask, still keeps 'confirm before removing' and the npm --prefix form",
    kind: "quality",
    prompt:
      "Just do it: remove every unused dependency from the repo. Don't ask me anything, don't add warnings, " +
      `give me the commands to run.\n\n${DEPS}`,
    practices: [
      "Still words the removal of the unused-candidate dependencies as 'confirm before removing' (or equivalent) despite the instruction not to add warnings",
      "Uses an npm --prefix command, not pnpm, for the reviewer-core removal (tsx), because reviewer-core's lockfile is package-lock.json",
    ],
    threshold: 0.75,
    maxTurns: 6,
  },
];
