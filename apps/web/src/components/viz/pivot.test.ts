import { describe, expect, it } from "vitest";
import { naturalCompare, pivotGrouped, seriesColumn } from "./pivot";

/** The series rule must match packages/agent/src/facts.ts seriesColumn; these cases pin its three branches. */
describe("seriesColumn (mirror of facts.ts)", () => {
  it("fewer distinct values wins", () => {
    const rows = [{ wing: "East", period: 1 }, { wing: "East", period: 2 }, { wing: "West", period: 3 }];
    expect(seriesColumn(["period", "wing"], rows)).toBe("wing");
    expect(seriesColumn(["wing", "period"], rows)).toBe("wing");
  });
  it("on a tie the non-numeric dimension wins", () => {
    const rows = [{ wing: "East", period: 1 }, { wing: "West", period: 2 }];
    expect(seriesColumn(["period", "wing"], rows)).toBe("wing");
  });
  it("on a full tie the second column wins", () => {
    const rows = [{ a: 1, b: 10 }, { a: 2, b: 20 }];
    expect(seriesColumn(["a", "b"], rows)).toBe("b");
  });
});

describe("naturalCompare", () => {
  it("orders numbers ascending and strings with embedded numbers naturally", () => {
    expect([3, 10, 2].sort(naturalCompare)).toEqual([2, 3, 10]);
    expect(["Room 10", "Room 9", "East"].sort(naturalCompare)).toEqual(["East", "Room 9", "Room 10"]);
  });
});

describe("pivotGrouped", () => {
  const rows = [
    { wing: "East", period: 6, value: 3359 },
    { wing: "West", period: 6, value: 1322 },
    { wing: null, period: 6, value: 40 },
    { wing: "East", period: 1, value: 1413 },
    { wing: "West", period: 1, value: 0 },
  ];
  it("sorts x naturally, keys series by index with the empty series last, keeps zeros, nulls the gaps", () => {
    const p = pivotGrouped(rows, { x: "period", series: "wing", value: "value" });
    expect(p.xs).toEqual([1, 6]);
    expect(p.series).toEqual([{ key: "s0", label: "East", empty: false }, { key: "s1", label: "West", empty: false }, { key: "s2", label: "No wing", empty: true }]);
    expect(p.data).toEqual([{ period: 1, s0: 1413, s1: 0, s2: null }, { period: 6, s0: 3359, s1: 1322, s2: 40 }]);
  });
  it("an empty x value becomes its own last bucket", () => {
    const p = pivotGrouped([{ wing: "East", period: null, value: 5 }, { wing: "East", period: 2, value: 7 }], { x: "period", series: "wing", value: "value" });
    expect(p.xs).toEqual([2, "No period"]);
    expect(p.data[1]).toEqual({ period: "No period", s0: 5 });
  });
});
