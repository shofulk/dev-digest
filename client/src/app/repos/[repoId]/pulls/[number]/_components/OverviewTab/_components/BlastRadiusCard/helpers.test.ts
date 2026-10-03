import { describe, it, expect } from "vitest";
import type { BlastRadius } from "@devdigest/shared";
import { blastCounts, callerHref, degradedReasonKey, splitSymbols } from "./helpers";

function blast(overrides: Partial<BlastRadius>): BlastRadius {
  return {
    changed_symbols: [],
    downstream: [],
    summary: "s",
    ...overrides,
  };
}

describe("blastCounts (T7)", () => {
  it("dedupes endpoints across two symbols sharing one endpoint; counts crons separately; counts depth-2 callers", () => {
    const b = blast({
      changed_symbols: [
        { name: "alpha", file: "a.ts", kind: "function" },
        { name: "beta", file: "b.ts", kind: "function" },
      ],
      downstream: [
        {
          symbol: "alpha",
          callers: [
            { name: "c1", file: "c1.ts", line: 1 },
            { name: "c2", file: "c2.ts", line: 2, depth: 2, via: "c1" },
          ],
          endpoints_affected: ["GET /x"],
          crons_affected: [],
        },
        {
          symbol: "beta",
          callers: [{ name: "c3", file: "c3.ts", line: 3 }],
          endpoints_affected: ["GET /x"],
          crons_affected: ["job:a"],
        },
      ],
    });
    expect(blastCounts(b)).toEqual({ symbols: 2, callers: 3, endpoints: 1, crons: 1 });
  });
});

describe("splitSymbols (T7)", () => {
  it("a symbol present in changed_symbols but absent from downstream -> withoutCallers", () => {
    const b = blast({
      changed_symbols: [
        { name: "alpha", file: "a.ts", kind: "function" },
        { name: "beta", file: "b.ts", kind: "function" },
      ],
      downstream: [
        {
          symbol: "alpha",
          callers: [{ name: "c1", file: "c1.ts", line: 1 }],
          endpoints_affected: [],
          crons_affected: [],
        },
      ],
    });
    const { withCallers, withoutCallers } = splitSymbols(b);
    expect(withCallers.map((d) => d.symbol)).toEqual(["alpha"]);
    expect(withoutCallers).toEqual(["beta"]);
  });

  it("lists a same-name symbol declared in several changed files once", () => {
    const b = blast({
      changed_symbols: [
        { name: "complete", file: "a.ts", kind: "method" },
        { name: "complete", file: "b.ts", kind: "method" },
        { name: "embed", file: "a.ts", kind: "method" },
      ],
    });
    expect(splitSymbols(b).withoutCallers).toEqual(["complete", "embed"]);
  });
});

describe("degradedReasonKey (T7)", () => {
  it("maps each enum value to reason.<v>, and null/unknown to reason.unknown", () => {
    expect(degradedReasonKey("flag_off")).toBe("reason.flag_off");
    expect(degradedReasonKey("index_failed")).toBe("reason.index_failed");
    expect(degradedReasonKey("index_partial")).toBe("reason.index_partial");
    expect(degradedReasonKey("repo_too_large")).toBe("reason.repo_too_large");
    expect(degradedReasonKey("no_data")).toBe("reason.no_data");
    expect(degradedReasonKey(null)).toBe("reason.unknown");
    expect(degradedReasonKey(undefined)).toBe("reason.unknown");
    expect(degradedReasonKey("bogus")).toBe("reason.unknown");
  });
});

describe("callerHref (T7)", () => {
  it("pins to headSha with #L<line> when indexedSha is null; null when repoFullName is null", () => {
    expect(callerHref("acme/api", null, "abc123", "src/x.ts", 23)).toBe(
      "https://github.com/acme/api/blob/abc123/src/x.ts#L23",
    );
    expect(callerHref(null, null, "abc123", "src/x.ts", 23)).toBeNull();
  });
});

describe("callerHref link sha (T18)", () => {
  it("prefers indexedSha over headSha when both are given (distinct shas)", () => {
    expect(callerHref("acme/api", "c6af1e4", "abc123", "src/x.ts", 409)).toBe(
      "https://github.com/acme/api/blob/c6af1e4/src/x.ts#L409",
    );
  });

  it("falls back to headSha when indexedSha is null", () => {
    expect(callerHref("acme/api", null, "abc123", "src/x.ts", 409)).toBe(
      "https://github.com/acme/api/blob/abc123/src/x.ts#L409",
    );
  });

  it("falls back to headSha when indexedSha is undefined", () => {
    expect(callerHref("acme/api", undefined, "abc123", "src/x.ts", 409)).toBe(
      "https://github.com/acme/api/blob/abc123/src/x.ts#L409",
    );
  });

  it("stays null when repoFullName is null, regardless of indexedSha", () => {
    expect(callerHref(null, "c6af1e4", "abc123", "src/x.ts", 409)).toBeNull();
  });
});
