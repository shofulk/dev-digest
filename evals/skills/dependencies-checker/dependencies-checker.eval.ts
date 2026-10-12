import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./dependencies-checker.cases.js";

describeSkill("dependencies-checker", () => runSkillCases("dependencies-checker", cases));
