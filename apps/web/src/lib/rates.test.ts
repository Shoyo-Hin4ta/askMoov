import { describe, expect, it } from "vitest";
import type { PlanOut } from "./client/api";
import { isRateStep } from "./rates";

const plan: PlanOut = {
  kind: "plan",
  answer_from: ["c"],
  expected_shape: "scalar",
  steps: [
    { id: "a", kind: "spec", spec: { metric: "attendance_rate" } },
    { id: "b", kind: "spec", spec: { metric: "pass_count" } },
    { id: "c", kind: "calc", formula: "change" },
    { id: "d", kind: "calc", formula: "avg" },
    { id: "e", kind: "sql" },
  ],
};

describe("isRateStep", () => {
  it("rate metrics and fraction formulas are rates; counts, averages, sql and unknown steps are not", () => {
    expect(isRateStep(plan, "a")).toBe(true);
    expect(isRateStep(plan, "b")).toBe(false);
    expect(isRateStep(plan, "c")).toBe(true);
    expect(isRateStep(plan, "d")).toBe(false);
    expect(isRateStep(plan, "e")).toBe(false);
    expect(isRateStep(plan, "zz")).toBe(false);
    expect(isRateStep(plan, undefined)).toBe(false);
    expect(isRateStep(null, "a")).toBe(false);
    expect(isRateStep({ kind: "out_of_scope", reason: "permission", message: "" }, "a")).toBe(false);
  });
});
