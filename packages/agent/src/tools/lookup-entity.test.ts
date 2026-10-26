import { describe, expect, it } from "vitest";
import { chosenFor, decide, lookupEntity, lookupKey, nameAgreement, pinEntity, settledByChoice, type EntityMatch, type LookupResult, type ResolvedEntity } from "./lookup-entity";

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

  it("two pins that both answer a bare name do not pick one: the search runs and ties", async () => {
    const pins: ResolvedEntity[] = [
      { type: "student", id: 1203, label: "Bart Simpson", detail: "grade 9", text: "Bart Simpson" },
      { type: "student", id: 1204, label: "Bart Reyes", detail: "grade 11", text: "Bart Reyes" },
    ];
    let queried = false;
    const r = await lookupEntity(async () => { queried = true; return rows([student("Bart Reyes", 0.97, 1204), student("Bart Simpson", 0.97, 1203)]); }, pins, "student", "Bart");
    expect(queried).toBe(true);
    expect(r.status).toBe("ambiguous");
    expect(await lookupEntity(async () => [], pins, "student", "Bart Reyes")).toMatchObject({ status: "resolved", match: { id: 1204 } });
  });

  it("numeric ids come back as numbers so compiled predicates bind cleanly", async () => {
    const r = await lookupEntity(async () => rows([student("Ralph Wiggum", 0.97, 1209)]), [], "student", "Ralph");
    expect(r).toMatchObject({ status: "resolved", match: { id: 1209 } });
    expect(typeof (r as { match: EntityMatch }).match.id).toBe("number");
  });
});

describe("chosenFor", () => {
  const section: ResolvedEntity = { type: "section", id: 58, label: "Biology, period 4 (Edna Krabappel)", detail: "period 4, Edna Krabappel", text: "Biology, period 4 (Edna Krabappel)" };
  const room: ResolvedEntity = { type: "room", id: 153, label: "214", detail: "classroom", text: "214" };
  const bart: ResolvedEntity = { type: "student", id: 1203, label: "Bart Simpson", detail: "grade 9", text: "Bart Simpson" };

  it("a section chip answers a nameless section lookup in its run", () => {
    expect(chosenFor([section], "section", "my class")).toBe(section);
    expect(chosenFor([section], "section", "my 4th period")).toBe(section);
  });
  it("a number in the lookup text must appear in the chip: a period-4 chip does not answer for 6th period", () => {
    expect(chosenFor([section], "section", "my 6th period")).toBeUndefined();
    expect(chosenFor([room], "room", "Room 214")).toBe(room);
    expect(chosenFor([room], "room", "Room 118")).toBeUndefined();
  });
  it("only the matching type", () => {
    expect(chosenFor([section], "room", "my class")).toBeUndefined();
    expect(chosenFor([bart], "teacher", "Bart")).toBeUndefined();
  });
  it("a person chip answers a lookup whose words are all in its name: a surname tie does not come back after the click", () => {
    expect(chosenFor([bart], "student", "Simpson")).toBe(bart);
    expect(chosenFor([bart], "student", "Bart")).toBe(bart);
    expect(chosenFor([bart], "student", "bart  simpson")).toBe(bart);
    const edna: ResolvedEntity = { type: "teacher", id: 12, label: "Edna Krabappel", detail: "", text: "Edna Krabappel" };
    expect(chosenFor([edna], "teacher", "Ms. Krabappel")).toBe(edna);
  });
  it("a person chip never answers for someone else", () => {
    expect(chosenFor([bart], "student", "Lisa")).toBeUndefined();
    expect(chosenFor([bart], "student", "Bart Reyes")).toBeUndefined();
    expect(chosenFor([bart], "student", "Lisa Simpson")).toBeUndefined();
    expect(chosenFor([bart], "student", "Ms.")).toBeUndefined();
  });
});

describe("lookupKey", () => {
  it("the same lookup is the same key whatever the case, spacing or filter order", () => {
    expect(lookupKey("section", "My  Class ", {})).toBe(lookupKey("section", "my class", {}));
    expect(lookupKey("student", "Bart", { grade: 9, period: 4 })).toBe(lookupKey("student", "bart", { period: 4, grade: 9 }));
  });
  it("a different type, different words or different filters are different lookups", () => {
    expect(lookupKey("room", "my class", {})).not.toBe(lookupKey("section", "my class", {}));
    expect(lookupKey("section", "my 4th period", {})).not.toBe(lookupKey("section", "my 6th period", {}));
    expect(lookupKey("student", "Bart", { grade: 9 })).not.toBe(lookupKey("student", "Bart", { grade: 11 }));
    expect(lookupKey("student", "Bart", { grade: 9 })).not.toBe(lookupKey("student", "Bart", {}));
  });
});

describe("settledByChoice", () => {
  const simpsons: LookupResult = { status: "ambiguous", candidates: [
    { type: "student", id: 1203, label: "Bart Simpson", detail: "grade 9", confidence: 0.9 },
    { type: "student", id: 1205, label: "Lisa Simpson", detail: "grade 7", confidence: 0.9 },
  ] };
  const bart: ResolvedEntity = { type: "student", id: 1203, label: "Bart Simpson", detail: "grade 9", text: "Bart Simpson" };
  const lisa: ResolvedEntity = { type: "student", id: 1205, label: "Lisa Simpson", detail: "grade 7", text: "Lisa Simpson" };

  it("a tie that contains the entity the user clicked resolves to it, whatever words the lookup used", () => {
    expect(settledByChoice([bart], simpsons)).toMatchObject({ status: "resolved", match: { id: 1203, confidence: 1 } });
  });
  it("no chosen entity in the tie, two in it, or no tie at all: nothing to settle", () => {
    const reyes: ResolvedEntity = { type: "student", id: 1204, label: "Bart Reyes", detail: "grade 11", text: "Bart Reyes" };
    expect(settledByChoice([reyes], simpsons)).toBeNull();
    expect(settledByChoice([bart, lisa], simpsons)).toBeNull();
    expect(settledByChoice([bart], { status: "none", candidates: [] })).toBeNull();
    expect(settledByChoice([], simpsons)).toBeNull();
  });
});

describe("pinEntity", () => {
  const simpson: ResolvedEntity = { type: "student", id: 1203, label: "Bart Simpson", detail: "grade 9", text: "Bart Simpson" };
  const reyes: ResolvedEntity = { type: "student", id: 1204, label: "Bart Reyes", detail: "grade 11", text: "Bart Reyes" };

  it("naming someone else with the same first name replaces an inherited pin, so a bare name means the one named last", () => {
    const set = pinEntity({ inherited: [simpson], added: [] }, reyes);
    expect(set.inherited).toEqual([]);
    expect(set.added.map((p) => p.id)).toEqual([1204]);
  });
  it("an inherited pin named again in this run is kept when a later lookup names a same-first-name person", () => {
    let set = pinEntity({ inherited: [simpson], added: [] }, { ...simpson, text: "Bart Simpson" });
    set = pinEntity(set, reyes);
    expect(set.added.map((p) => p.id)).toEqual([1203, 1204]);
    expect(set.inherited).toEqual([]);
  });
  it("the same entity pinned twice in one run is one pin", () => {
    const set = pinEntity(pinEntity({ inherited: [], added: [] }, reyes), reyes);
    expect(set.added).toHaveLength(1);
  });
});
