// Subpath, not the "@devdigest/shared" barrel: the barrel re-exports with `.js`
// specifiers, which webpack cannot resolve against the TS sources, so importing a RUNTIME
// value (this is the Zod schema, not just its type) through it breaks `next dev`.
import { Severity } from "@devdigest/shared/contracts/findings";

/** Display order of the counter row — taken from the contract enum so the row can
 *  never drift from the severities the API can actually return. */
export const SEVERITY_LEVELS = Severity.options;
