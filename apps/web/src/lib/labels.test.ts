import { describe, expect, it } from "vitest";
import { displayId, labelFor, labelWithId } from "./labels";

const labels = { student: { "1203": "Bart Simpson" } };

describe("labels", () => {
  it("looks ids up as strings and falls back to the id", () => {
    expect(labelFor(labels, "student", 1203)).toBe("Bart Simpson");
    expect(labelFor(labels, "student", "1203")).toBe("Bart Simpson");
    expect(labelFor(labels, "student", 9)).toBeUndefined();
    expect(labelFor(labels, "room", 1203)).toBeUndefined();
    expect(labelFor(labels, "student", null)).toBeUndefined();
    expect(displayId(labels, "student", 9)).toBe("9");
    expect(displayId(labels, "student", null)).toBe("");
    expect(labelWithId(labels, "student", 1203)).toBe("Bart Simpson (1203)");
    expect(labelWithId(labels, "student", 9)).toBe("9");
  });
});
