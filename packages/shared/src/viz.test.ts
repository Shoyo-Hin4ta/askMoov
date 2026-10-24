import { describe, expect, it } from "vitest";
import { answerStepId, chartStepId, vizTypeForShape } from "./viz";

describe("chartStepId", () => {
  const of = (id: string) => ({ a: "rows", b: "rows" } as Record<string, string>)[id];
  it("uses the step the presenter recorded", () => {
    expect(chartStepId({ step: "b" }, ["a", "b"], of)).toBe("b");
  });
  it("falls back to the positional rule for runs stored without one", () => {
    expect(chartStepId(null, ["a", "b"], of)).toBe("a");
    expect(chartStepId({}, ["a", "b"], of)).toBe("a");
  });
});

describe("answerStepId (positional fallback)", () => {
  const of = (id: string) => ({ a: "series", b: "scalar", c: "categories" } as Record<string, string>)[id];
  it("prefers the first non-scalar step", () => {
    expect(answerStepId(["a", "b"], of)).toBe("a");
    expect(answerStepId(["b", "c"], of)).toBe("c");
  });
  it("falls back to the last step", () => {
    expect(answerStepId(["b"], of)).toBe("b");
    expect(answerStepId(["b", "x"], of)).toBe("x");
    expect(answerStepId([], of)).toBeUndefined();
  });
});

describe("vizTypeForShape", () => {
  it("maps every shape; a two-dimension breakdown is a (grouped) bar, not a table", () => {
    expect(vizTypeForShape("scalar")).toBe("stat");
    expect(vizTypeForShape("series")).toBe("line");
    expect(vizTypeForShape("categories")).toBe("bar");
    expect(vizTypeForShape("grouped")).toBe("bar");
    expect(vizTypeForShape("entity_by_day")).toBe("calendar");
    expect(vizTypeForShape("rows")).toBe("table");
  });
});
