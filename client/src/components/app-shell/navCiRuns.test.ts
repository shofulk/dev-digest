import { describe, it, expect } from "vitest";
import { NAV } from "@devdigest/ui";

describe("nav", () => {
  it("AC-46: the GLOBAL group links CI Runs to /ci-runs", () => {
    const group = NAV.find((g) => g.section === "GLOBAL");
    expect(group?.items).toContainEqual(
      expect.objectContaining({ key: "ci-runs", label: "CI Runs", href: "/ci-runs" }),
    );
  });
});
