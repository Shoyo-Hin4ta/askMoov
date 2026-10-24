import { describe, expect, it } from "vitest";
import { EMPTY_CELL, formatPercent } from "./format";

describe("formatPercent", () => {
  it("one decimal, sign from the number", () => {
    expect(formatPercent(0.921)).toBe("92.1%");
    expect(formatPercent(-0.02)).toBe("-2.0%");
    expect(formatPercent(1)).toBe("100.0%");
    expect(formatPercent(1.4)).toBe("140.0%");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(-0.0004)).toBe("0.0%");
  });
  it("the empty cell marker is an em dash", () => {
    expect(EMPTY_CELL).toBe("—");
  });
});
