import { describe, expect, it } from "vitest";
import { plannerSystem } from "./prompts";

const system = plannerSystem({ schemaDoc: { text: "", version: "v" }, frozenNow: "2026-10-13T10:40:00Z", episodesText: "", entities: [], dates: [], recentHistory: "", replanContext: null })
  .map((b) => b.text)
  .join("\n");
const rule3 = system.slice(system.indexOf("\n3. "), system.indexOf("\n4. "));

describe("planner rule 3", () => {
  // run 9a207dea: the planner put section_id in a spec's filters, the strict schema rejected it, and the corrective looped
  it("names grade, section_id and teacher_id as lookup-only filters", () => {
    expect(rule3).toContain("grade, section_id and teacher_id exist only there and are never keys of a spec's filters");
  });
  // a first wording also called period lookup-only, which would send "during 4th period" to a lookup that returns none
  it("keeps period a spec filter for periods that do not name a section", () => {
    expect(rule3).not.toMatch(/\(grade, period, section_id, teacher_id\)/);
    expect(rule3).toContain("is the spec's filters.period");
    expect(rule3).toContain("entity student plus filters.period");
  });
});
