import { describe, expect, it } from "vitest";
import type { PlanOut, StepOut } from "@/lib/client/api";
import { calcInputs } from "./calc-inputs";

const spec = (id: string, metric: string, type: string, entityId: unknown) => ({ id, kind: "spec" as const, spec: { metric, entity: { type, id: entityId } } });
const calc = (id: string, formula: string, args: { name: string; value: unknown }[]) => ({ id, kind: "calc" as const, formula, args });
const plan = (steps: NonNullable<Extract<PlanOut, { kind: "plan" }>["steps"]>): PlanOut => ({ kind: "plan", steps, answer_from: [steps[steps.length - 1]!.id], expected_shape: "scalar" });
const values = (v: Record<string, unknown>): StepOut[] => Object.entries(v).map(([id, value]) => ({ id, kind: "spec", value }));

describe("calcInputs", () => {
  it("a comparison of two schools shows both rates, named by school", () => {
    const p = plan([spec("a", "attendance_rate", "school", 1), spec("b", "attendance_rate", "school", 2), calc("c", "change", [{ name: "before", value: "$a.value" }, { name: "after", value: "$b.value" }])]);
    const labels = { school: { "1": "Springfield High", "2": "Shelbyville High" } };
    expect(calcInputs(p, values({ a: 0.9212, b: 0.8983, c: -0.0249 }), labels, "c")).toEqual([
      { label: "Springfield High", text: "92.1%" },
      { label: "Shelbyville High", text: "89.8%" },
    ]);
  });

  it("the same student before and after is labelled by role, each value in its own format", () => {
    const p = plan([spec("a", "tardy_count", "student", 1203), spec("b", "tardy_count", "student", 1203), calc("c", "change", [{ name: "before", value: "$a.value" }, { name: "after", value: "$b.value" }])]);
    expect(calcInputs(p, values({ a: 7, b: 1 }), { student: { "1203": "Bart Simpson" } }, "c")).toEqual([
      { label: "Before", text: "7" },
      { label: "After", text: "1" },
    ]);
  });

  it("a target shows what it was computed from and skips its literal arguments", () => {
    const p = plan([spec("a", "present_count", "student", 1205), spec("b", "scheduled_count", "student", 1205), calc("c", "classes_to_target", [{ name: "attended", value: "$a.value" }, { name: "scheduled", value: "$b.value" }, { name: "target", value: 0.98 }])]);
    expect(calcInputs(p, values({ a: 269, b: 275 }), {}, "c")).toEqual([
      { label: "Attended", text: "269" },
      { label: "Scheduled", text: "275" },
    ]);
  });

  it("a run stored without entity names falls back to the roles", () => {
    const p = plan([spec("a", "attendance_rate", "school", 1), spec("b", "attendance_rate", "school", 2), calc("c", "change", [{ name: "before", value: "$a.value" }, { name: "after", value: "$b.value" }])]);
    expect(calcInputs(p, values({ a: 0.9212, b: 0.8983 }), {}, "c").map((i) => i.label)).toEqual(["Before", "After"]);
  });

  it("nothing to show: a spec step, a missing value, or fewer than two inputs", () => {
    const p = plan([spec("a", "pass_count", "student", 1203), spec("b", "pass_count", "student", 1204), calc("c", "change", [{ name: "before", value: "$a.value" }, { name: "after", value: "$b.value" }])]);
    expect(calcInputs(p, values({ a: 18, b: 22 }), {}, "a")).toEqual([]);
    expect(calcInputs(p, values({ a: 18, b: null }), {}, "c")).toEqual([]);
    expect(calcInputs(null, [], {}, "c")).toEqual([]);
  });
});
