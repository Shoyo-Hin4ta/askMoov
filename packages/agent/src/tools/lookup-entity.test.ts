import { describe, expect, it } from "vitest";
import { decide, lookupEntity, nameAgreement, type EntityMatch, type ResolvedEntity } from "./lookup-entity";

/** Design 4.5a: code decides ties; the thresholds are numbers. Similarities below are the ones measured on the seed (2026-10-24). */
const student = (label: string, confidence: number, id = 1): EntityMatch => ({ type: "student", id, label, detail: "", confidence });

describe("decide", () => {
  it("one candidate above the floor resolves", () => {
    expect(decide([student("Ralph Wiggum", 0.786)])).toMatchObject({ status: "resolved", match: { label: "Ralph Wiggum" } });
  });
  it("an exact match beats a prefix match on the same first name", () => {
    expect(decide([student("Bart Simpson", 1), student("Bart Reyes", 0.97, 2)])).toMatchObject({ status: "resolved", match: { label: "Bart Simpson" } });
  });
  it("two prefix matches within the tie margin are ambiguous", () => {
    expect(decide([student("Bart Simpson", 0.97), student("Bart Reyes", 0.97, 2)])).toMatchObject({ status: "ambiguous" });
  });
  it("a clear gap resolves to the top candidate", () => {
    expect(decide([student("Nelson Muntz", 0.97), student("Mia Nelson", 0.6, 2)])).toMatchObject({ status: "resolved", match: { label: "Nelson Muntz" } });
  });
  it("no candidates is none", () => {
    expect(decide([])).toEqual({ status: "none", candidates: [] });
  });
});

describe("nameAgreement", () => {
  it("a full name that only resembles a different person is dropped: Nelson Muntz is not Mia Nelson", () => {
    expect(nameAgreement("student", "Nelson Muntz", [student("Mia Nelson", 0.5)])).toEqual([]);
  });
  it("a typo in the last name keeps the person: same first name, fuzzy score", () => {
    expect(nameAgreement("student", "Bart Simpsen", [student("Bart Simpson", 0.625)])).toHaveLength(1);
    expect(nameAgreement("student", "Ralph Wigum", [student("Ralph Wiggum", 0.786)])).toHaveLength(1);
  });
  it("a containment or prefix match is kept whatever the first word: 'Van Houten' finds Milhouse", () => {
    expect(nameAgreement("student", "Van Houten", [student("Milhouse Van Houten", 0.9)])).toHaveLength(1);
  });
  it("a single word is left to the thresholds: a typo'd surname alone still resolves", () => {
    expect(nameAgreement("teacher", "Krabapel", [{ type: "teacher", id: 12, label: "Edna Krabappel", detail: "", confidence: 0.5 }])).toHaveLength(1);
  });
  it("rooms, sections, wings and schools are not names", () => {
    const room: EntityMatch = { type: "room", id: 191, label: "Entrance 2 (Bus Loop)", detail: "", confidence: 0.5 };
    expect(nameAgreement("room", "Bus Loop door", [room])).toEqual([room]);
  });
});

describe("lookupEntity", () => {
  const rows = (cands: EntityMatch[]) => cands.map((c) => ({ id: String(c.id), label: c.label, detail: c.detail, confidence: c.confidence }));

  it("strips an honorific before matching a person, so 'Ms. Krabappel' is looked up as 'Krabappel'", async () => {
    const seen: unknown[][] = [];
    const query = async (_sql: string, params: unknown[]) => { seen.push(params); return rows([{ type: "teacher", id: 12, label: "Edna Krabappel", detail: "teacher", confidence: 0.9 }]); };
    const r = await lookupEntity(query, [], "teacher", "Ms. Krabappel");
    expect(seen[0]![0]).toBe("Krabappel");
    expect(r).toMatchObject({ status: "resolved", match: { id: 12 } });
  });

  it("a teacher asking about a student outside her rosters gets none, not a resolved stranger", async () => {
    const query = async () => rows([student("Mia Nelson", 0.5, 1174)]);
    expect(await lookupEntity(query, [], "student", "Nelson Muntz")).toEqual({ status: "none", candidates: [] });
  });

  it("a pinned name resolves without touching the database", async () => {
    const pins: ResolvedEntity[] = [{ type: "student", id: 1203, label: "Bart Simpson", detail: "grade 9", text: "Bart" }];
    let queried = false;
    const r = await lookupEntity(async () => { queried = true; return []; }, pins, "student", "Bart");
    expect(queried).toBe(false);
    expect(r).toMatchObject({ status: "resolved", match: { id: 1203, confidence: 1 } });
  });

  it("numeric ids come back as numbers so compiled predicates bind cleanly", async () => {
    const r = await lookupEntity(async () => rows([student("Ralph Wiggum", 0.97, 1209)]), [], "student", "Ralph");
    expect(r).toMatchObject({ status: "resolved", match: { id: 1209 } });
    expect(typeof (r as { match: EntityMatch }).match.id).toBe("number");
  });
});
