import type { CiPostAs, CiTrigger } from "@devdigest/shared";

/* Canonical option lists, typed against the contract. They are not imported as runtime values:
   `contracts/eval-ci.ts` imports its siblings with `.js` specifiers, which webpack cannot
   resolve (client/INSIGHTS.md, 2026-09-17), so a value import 500s every route in `next dev`. */
export const CI_TRIGGERS = ["opened", "synchronize", "reopened"] as const satisfies readonly CiTrigger[];
export const CI_POST_AS = ["github_review", "pr_comment", "none"] as const satisfies readonly CiPostAs[];
