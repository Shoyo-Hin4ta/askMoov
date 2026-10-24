import { describe, expect, it } from "vitest";
import { calc, evaluate } from "./calc";
import { CalcError } from "../errors";

describe("calc: normal results", () => {
  it("rate, change, pct_of, avg", () => {
    expect(calc("rate", { num: 3, den: 4 })).toEqual({ value: 0.75, explanation: "3 / 4" });
    const c = calc("change", { before: 11, after: 2 });
    expect(c.value).toBeCloseTo(-0.818, 3);
    expect(c.explanation).toBe("(2 - 11) / 11");
    expect(calc("pct_of", { part: 1, whole: 4 })).toEqual({ value: 0.25, explanation: "1 / 4" });
    expect(calc("avg", { values: [1, 2, 3] })).toEqual({ value: 2, explanation: "sum of 3 values / 3" });
  });
  it("classes_to_target: story 7 (34 of 40 to 90% is 20 more), already at target, unreachable", () => {
    expect(calc("classes_to_target", { attended: 34, scheduled: 40, target: 0.9 }).value).toBe(20);
    expect(calc("classes_to_target", { attended: 36, scheduled: 40, target: 0.9 })).toEqual({ value: 0, explanation: "already at or above target" });
    expect(calc("classes_to_target", { attended: 34, scheduled: 40, target: 1.2 }).value).toBe("unreachable");
    expect(calc("classes_to_target", { attended: 34, scheduled: 40, target: 1 }).value).toBe("unreachable");
  });
  it("expr: precedence, parentheses, unary minus", () => {
    expect(calc("expr", { expr: "(a - b) / b", a: 2, b: 11 } as never).value).toBeCloseTo(-0.818, 3);
    expect(evaluate("-(a + 2) * 3", { a: 1 })).toBe(-9);
    expect(evaluate("2 + 3 * 4", {})).toBe(14);
  });
});

describe("calc: a zero baseline is a defined result, not an error", () => {
  it("change: nothing before and nothing after is no change", () => {
    expect(calc("change", { before: 0, after: 0 })).toEqual({ value: 0, explanation: "0 before and 0 after: no change" });
  });
  it("change: something after nothing has no baseline; the explanation names both numbers and the signed delta", () => {
    expect(calc("change", { before: 0, after: 5 })).toEqual({ value: null, explanation: "from 0 to 5 (+5); a relative change has no baseline at zero" });
    expect(calc("change", { before: 0, after: -3 }).explanation).toBe("from 0 to -3 (-3); a relative change has no baseline at zero");
  });
  it("rate, pct_of, avg, classes_to_target", () => {
    expect(calc("rate", { num: 5, den: 0 })).toEqual({ value: null, explanation: "5 / 0: a rate over a zero denominator has no value" });
    expect(calc("pct_of", { part: 3, whole: 0 })).toEqual({ value: null, explanation: "3 of 0: a share of a zero whole has no value" });
    expect(calc("avg", { values: [] })).toEqual({ value: null, explanation: "no values to average" });
    expect(calc("classes_to_target", { attended: 0, scheduled: 0, target: 0.9 })).toEqual({ value: null, explanation: "0 attended of 0 scheduled: there is no attendance rate to raise" });
  });
  it("expr: division by zero is null with the bound variables named, never NaN", () => {
    expect(calc("expr", { expr: "a / b", a: 5, b: 0 } as never)).toEqual({ value: null, explanation: "a / b with a = 5, b = 0: division by zero, no value" });
    expect(calc("expr", { expr: "0 / 0" } as never)).toEqual({ value: null, explanation: "0 / 0: division by zero, no value" });
  });
});

describe("calc: plan mistakes still throw CalcError", () => {
  it("unknown formula, non-numeric or missing argument, non-list for avg, non-string expr", () => {
    expect(() => calc("median", { values: [1] })).toThrow(CalcError);
    expect(() => calc("rate", { num: "x", den: 2 } as never)).toThrow(CalcError);
    expect(() => calc("rate", { num: 1 })).toThrow(CalcError);
    expect(() => calc("avg", { values: 3 })).toThrow(CalcError);
    expect(() => calc("expr", { expr: 3 } as never)).toThrow(CalcError);
  });
  it("expr syntax: unknown variable, trailing input, missing paren, bad character", () => {
    expect(() => evaluate("a / c", { a: 1 })).toThrow(/unknown variable "c"/);
    expect(() => evaluate("a b", { a: 1, b: 2 })).toThrow(/trailing input/);
    expect(() => evaluate("(a / b", { a: 1, b: 2 })).toThrow(/missing \)/);
    expect(() => evaluate("a $ b", { a: 1, b: 2 })).toThrow(/unexpected character/);
  });
  it("expr: a syntax error wins over a zero divisor", () => {
    expect(() => evaluate("a / b )", { a: 1, b: 0 })).toThrow(/trailing input/);
  });
});
