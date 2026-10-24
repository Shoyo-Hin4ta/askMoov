import { describe, expect, it } from "vitest";
import { RefError } from "./errors";
import { referencedSteps, resolveRef, resolveRefsDeep, type StepValues } from "./refs";

/** Design 5: refs.test. */
const results: Record<string, StepValues> = {
  a: { value: 12, row_count: 2, rows: [{ student_id: 1203, x: 1 }, { student_id: 1204, x: 2 }] },
  b: { row_count: 3 },
};

describe("refs", () => {
  it("resolves value, row_count, an indexed row field and a column across rows", () => {
    expect(resolveRef("$a.value", results)).toBe(12);
    expect(resolveRef("$a.row_count", results)).toBe(2);
    expect(resolveRef("$a.rows[0].student_id", results)).toBe(1203);
    expect(resolveRef("$a.rows[1].x", results)).toBe(2);
    expect(resolveRef("$a.rows[*].x", results)).toEqual([1, 2]);
  });

  it.each([
    ["unknown step", "$z.value", /unknown step "z".*available: a, b/],
    ["index out of range", "$a.rows[5].x", /has 2 rows, index 5 is out of range/],
    ["missing column", "$a.rows[0].nope", /no column "nope"; columns: student_id, x/],
    ["bad syntax", "$a.vale", /bad reference syntax/],
    ["no scalar value", "$b.value", /has no scalar value/],
    ["no rows", "$b.rows[0].x", /has no rows/],
  ])("fails readably on %s", (_name, ref, message) => {
    expect(() => resolveRef(ref, results)).toThrow(RefError);
    expect(() => resolveRef(ref, results)).toThrow(message);
  });

  it("walks nested values and leaves plain strings alone", () => {
    const input = { entity: { type: "student", id: "$a.rows[*].student_id" }, note: "plain text stays", list: ["$a.value", 7] };
    expect(resolveRefsDeep(input, results)).toEqual({ entity: { type: "student", id: [1203, 1204] }, note: "plain text stays", list: [12, 7] });
  });

  it("any string starting with $ is a reference: a malformed one fails instead of passing through as text", () => {
    expect(() => resolveRefsDeep({ v: "$ is not a ref without a step" }, results)).toThrow(RefError);
  });

  it("lists the steps a value references, once each", () => {
    expect(referencedSteps({ x: "$a.value", y: ["$b.row_count", "$a.rows[*].x"], z: 3 }).sort()).toEqual(["a", "b"]);
    expect(referencedSteps(null)).toEqual([]);
  });

  it("referencedSteps rejects bad syntax before anything runs", () => {
    expect(() => referencedSteps({ x: "$a.values" })).toThrow(RefError);
  });
});
