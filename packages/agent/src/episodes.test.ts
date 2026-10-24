import { describe, expect, it } from "vitest";
import { templatize } from "./episodes";
import type { ResolvedEntity } from "./tools/lookup-entity";

/** Design 5: episodes.templatize. No name from `resolved` may survive into memory. */
const bart: ResolvedEntity = { type: "student", id: 1203, label: "Bart Simpson", detail: "grade 9", text: "Bart" };
const lisa: ResolvedEntity = { type: "student", id: 1205, label: "Lisa Simpson", detail: "grade 8", text: "Lisa Simpson" };
const krabappel: ResolvedEntity = { type: "teacher", id: 12, label: "Edna Krabappel", detail: "", text: "Ms. Krabappel" };
const p4: ResolvedEntity = { type: "section", id: 42, label: "Math 9, period 4", detail: "Krabappel", text: "my 4th period" };
const room: ResolvedEntity = { type: "room", id: 214, label: "Room 214", detail: "classroom", text: "Room 214" };

describe("templatize", () => {
  it("replaces entities by type and date phrases by {date_range}", () => {
    expect(templatize("How many bathroom passes did Bart take this month?", [bart], ["this month"])).toBe("how many bathroom passes did {student} take {date_range}?");
  });

  it("replaces the full label, the matched text and a first name alone", () => {
    expect(templatize("Bart Simpson, then Bart, then bart simpson again", [bart], [])).toBe("{student}, then {student}, then {student} again");
  });

  it("no name from resolved survives, whatever form it took", () => {
    const out = templatize("What did Ms. Krabappel do about Lisa Simpson's tardies in my 4th period in Room 214 last week?", [lisa, krabappel, p4, room], ["last week"]);
    for (const word of ["lisa", "simpson", "krabappel", "edna", "4th period", "room 214", "214"]) expect(out).not.toContain(word);
    expect(out).toBe("what did {teacher} do about {student}'s tardies in {section} in {room} {date_range}?");
  });

  it("longest substitution first, so a full name does not become a token plus a stray surname", () => {
    expect(templatize("Bart Simpson", [bart], [])).toBe("{student}");
  });

  it("lowercases, collapses whitespace and newlines, and caps the length", () => {
    const long = `Show me   Bart's\n\npasses ${"again ".repeat(60)}`;
    const out = templatize(long, [bart], []);
    expect(out.startsWith("show me {student}'s passes again again")).toBe(true);
    expect(out).not.toMatch(/\s{2}|\n/);
    expect(out.length).toBeLessThanOrEqual(200);
  });

  it("leaves a question with no entities and no dates untouched apart from normalization", () => {
    expect(templatize("Who is out of class right now?", [], [])).toBe("who is out of class right now?");
  });
});
