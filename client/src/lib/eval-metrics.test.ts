import { describe, it, expect } from "vitest";
import { deltaTone, formatMetric, orderPair, signedDelta } from "./eval-metrics";

describe("formatMetric", () => {
  it("formats to two decimals and renders null as a dash", () => {
    expect(formatMetric(0.833)).toBe("0.83");
    expect(formatMetric(0)).toBe("0.00");
    expect(formatMetric(1)).toBe("1.00");
    expect(formatMetric(null)).toBe("—");
  });
});

describe("signedDelta / deltaTone", () => {
  it("signs positive, negative, zero and null", () => {
    expect(signedDelta(0.1)).toBe("+0.10");
    expect(signedDelta(-0.2)).toBe("−0.20");
    expect(signedDelta(0)).toBe("±0.00");
    expect(signedDelta(null)).toBe("—");
  });

  it("treats a delta that rounds to zero as flat", () => {
    expect(signedDelta(0.004)).toBe("±0.00");
    expect(deltaTone(0.004)).toBe("flat");
    expect(deltaTone(-0.004)).toBe("flat");
  });

  it("maps the tone", () => {
    expect(deltaTone(0.2)).toBe("up");
    expect(deltaTone(-0.25)).toBe("down");
    expect(deltaTone(0)).toBe("flat");
    expect(deltaTone(null)).toBe("none");
  });
});

describe("orderPair", () => {
  const runs = [
    { run_id: "new", started_at: "2026-10-02T10:00:00Z" },
    { run_id: "old", started_at: "2026-10-01T10:00:00Z" },
    { run_id: "mid", started_at: "2026-10-01T18:00:00Z" },
  ];

  it("returns [older, newer] when the ids are given newest-first", () => {
    expect(orderPair(runs, ["new", "old"])).toEqual(["old", "new"]);
  });

  it("keeps [older, newer] when already ordered, independent of list order", () => {
    expect(orderPair(runs, ["old", "mid"])).toEqual(["old", "mid"]);
    expect(orderPair(runs, ["mid", "old"])).toEqual(["old", "mid"]);
  });

  it("keeps the given order when a run is unknown", () => {
    expect(orderPair(runs, ["ghost", "old"])).toEqual(["ghost", "old"]);
  });
});
