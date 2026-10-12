import type { CiFailOn } from "@devdigest/shared";

/** CI gate policy options (labels under `ci.ciTab.failOn`). */
export const CI_FAIL_ON_VALUES = ["never", "critical", "warning", "any"] as const satisfies readonly CiFailOn[];
