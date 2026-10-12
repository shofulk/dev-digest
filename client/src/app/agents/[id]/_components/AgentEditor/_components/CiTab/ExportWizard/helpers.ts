/* Pure wizard logic — no React, no `use` prefix, testable without a renderer. */
import { parseDocument } from "yaml";
import { strToU8, zipSync } from "fflate";
import type { CiFile, CiTrigger } from "@devdigest/shared";
import { CI_TRIGGERS } from "./constants";

/** Triggers in the canonical order of the contract enum. */
export function sortTriggers(triggers: CiTrigger[]): CiTrigger[] {
  return CI_TRIGGERS.filter((t) => triggers.includes(t));
}

/** Replace only `on.pull_request.types` in an edited workflow; text that does not parse is returned unchanged. */
export function replaceTriggerTypes(text: string, triggers: CiTrigger[]): string {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return text;
  const types = doc.createNode(sortTriggers(triggers));
  types.flow = true;
  doc.setIn(["on", "pull_request", "types"], types);
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

/** `acme/payments-api` → `devdigest-ci-acme-payments-api.zip`. */
export function zipFileName(repoFullName: string): string {
  return `devdigest-ci-${repoFullName.replace("/", "-")}.zip`;
}

/** Every bundle file at its path. */
export function buildZip(files: CiFile[]): Uint8Array {
  return zipSync(Object.fromEntries(files.map((f) => [f.path, strToU8(f.contents ?? "")])));
}
