import { describe, expect, it } from "vitest";
import { PlannerOutput, Sketch } from "@ask-moov/shared";
import { PlanValidationError } from "./errors";
import { PERSONAS } from "./fixtures";
import { validatePlan } from "./plan-check";

/**
 * Design 5: plan.schema and sketch.schema. The schema rejects what it can see (unknown metric, unknown key, unknown step kind);
 * validatePlan rejects what needs context (step count, refs). Both are "rejected", never "silently dropped".
 */
const admin = PERSONAS[1]!;
const known = [{ type: "student", id: 1203 }];
const spec = { metric: "pass_count", entity: { type: "student", id: 1203 }, time_range: { start: "2026-10-01", end: "2026-10-13" } };
type StepLike = Record<string, unknown> & { id: string };
const specStep = (id: string, s: unknown = spec): StepLike => ({ id, kind: "spec", spec: s });
const plan = (steps: StepLike[], answer_from = [steps[steps.length - 1]!.id]) => ({ kind: "plan", steps, answer_from, expected_shape: "scalar" });

const issuePaths = (input: unknown): string[] => {
  const r = PlannerOutput.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
};

describe("plan schema", () => {
  it("a valid plan parses and passes validatePlan", () => {
    const r = PlannerOutput.safeParse(plan([specStep("a")]));
    expect(r.success).toBe(true);
    expect(() => validatePlan(r.data as never, admin, known)).not.toThrow();
  });

  it("a valid out_of_scope answer with clarification options parses", () => {
    const r = PlannerOutput.safeParse({
      kind: "out_of_scope", reason: "needs_clarification", message: "Which Bart?", suggestion: "Pick one.",
      options: [{ label: "Bart Simpson, grade 9", entity: { type: "student", id: 1203 } }, { label: "Bart Reyes, grade 11", entity: { type: "student", id: 1204, label: "Bart Reyes", detail: "grade 11" } }],
    });
    expect(r.success).toBe(true);
  });

  it("an unknown metric is rejected", () => {
    expect(issuePaths(plan([specStep("a", { ...spec, metric: "grades" })]))).toContainEqual(expect.stringContaining("metric"));
  });

  it("an unknown filter key is rejected, not dropped", () => {
    expect(issuePaths(plan([specStep("a", { ...spec, filters: { grade: 9 } })]))).toContainEqual(expect.stringContaining("filters"));
  });

  it("a field outside the spec is rejected, not dropped", () => {
    expect(issuePaths(plan([specStep("a", { ...spec, aggregate: "count" })]))).toContainEqual(expect.stringContaining("spec"));
  });

  it("an unknown step kind is rejected", () => {
    expect(PlannerOutput.safeParse(plan([{ id: "a", kind: "python", code: "print(1)" }])).success).toBe(false);
  });

  it("a filter value outside its enum is rejected, alone or in a list", () => {
    expect(issuePaths(plan([specStep("a", { ...spec, filters: { destination: "pool" } })]))).toContainEqual(expect.stringContaining("destination"));
    expect(issuePaths(plan([specStep("a", { ...spec, filters: { destination: ["bathroom", "pool"] } })]))).toContainEqual(expect.stringContaining("destination"));
  });

  it("every filter takes one value or a list: the forms the planner actually writes both parse", () => {
    expect(PlannerOutput.safeParse(plan([specStep("a", { ...spec, filters: { destination: "bathroom", period: 6 } })])).success).toBe(true);
    expect(PlannerOutput.safeParse(plan([specStep("a", { ...spec, filters: { destination: ["bathroom"], period: [6], day_of_week: 2 } })])).success).toBe(true);
    expect(PlannerOutput.safeParse(plan([specStep("a", { ...spec, filters: { period: "6" } })])).success).toBe(false);
  });

  it("five steps are rejected by validatePlan", () => {
    const five = plan(["a", "b", "c", "d", "e"].map((id) => specStep(id)));
    const parsed = PlannerOutput.parse(five);
    expect(() => validatePlan(parsed as never, admin, known)).toThrow(/maximum is 4/);
  });

  it("a bad ref is rejected by validatePlan with the accepted forms in the message", () => {
    const bad = plan([specStep("a"), { id: "b", kind: "calc", formula: "rate", args: [{ name: "num", value: "$a.values" }, { name: "den", value: 40 }] }]);
    const parsed = PlannerOutput.parse(bad);
    expect(() => validatePlan(parsed as never, admin, known)).toThrow(PlanValidationError);
    expect(() => validatePlan(parsed as never, admin, known)).toThrow(/bad reference syntax/);
  });

  it("a ref to a later step is rejected", () => {
    const forward = plan([{ id: "a", kind: "calc", formula: "rate", args: [{ name: "num", value: "$b.value" }, { name: "den", value: 40 }] }, specStep("b")], ["a"]);
    expect(() => validatePlan(PlannerOutput.parse(forward) as never, admin, known)).toThrow(/not an earlier step/);
  });

  it("an entity id that no lookup produced is rejected", () => {
    expect(() => validatePlan(PlannerOutput.parse(plan([specStep("a")])) as never, admin, [])).toThrow(/did not come from lookup_entity/);
  });
});

describe("sketch schema", () => {
  it("parses a sketch", () => {
    expect(Sketch.safeParse({ metrics: ["pass_count", "out_minutes"], entity_types: ["student"], shape: "categories" }).success).toBe(true);
  });
  it("rejects an unknown metric name", () => {
    expect(Sketch.safeParse({ metrics: ["grades"], entity_types: [], shape: "rows" }).success).toBe(false);
  });
  it("allows empty metrics (no retrieval)", () => {
    expect(Sketch.safeParse({ metrics: [], entity_types: [], shape: "rows" }).success).toBe(true);
  });
});
