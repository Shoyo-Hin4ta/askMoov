import { describe, expect, it } from "vitest";
import { entityLabels, mergeLabels, withLabels, type LabelQuery } from "./labels";

/** The query is the scoped entity view: it answers only for ids the persona may see. */
const directory: Record<string, Record<string, string>> = {
  student: { "1082": "Ana Lopez", "1203": "Bart Simpson" },
  room: { "153": "214", "185": "Gym" },
};
const query: LabelQuery = async (_sql, params) => {
  const [type, ids] = params as [string, string[]];
  return ids.filter((id) => directory[type]?.[id]).map((id) => ({ id, label: directory[type]![id]! }));
};

describe("entityLabels", () => {
  it("resolves every id column it knows, one query per entity type, keyed by column", async () => {
    const calls: unknown[][] = [];
    const counting: LabelQuery = async (sql, params) => { calls.push(params); return query(sql, params); };
    const labels = await entityLabels(counting, ["student", "origin_room_id", "value"], [
      { student: 1082, origin_room_id: 153, value: 3 }, { student: 1203, origin_room_id: 185, value: 1 }, { student: 1203, origin_room_id: null, value: 0 },
    ]);
    expect(labels).toEqual({ student: { "1082": "Ana Lopez", "1203": "Bart Simpson" }, origin_room_id: { "153": "214", "185": "Gym" } });
    expect(calls).toHaveLength(2);
    expect(calls.map((p) => p[0]).sort()).toEqual(["room", "student"]);
  });

  it("an id outside the persona's scope simply has no label", async () => {
    const labels = await entityLabels(query, ["student_id", "value"], [{ student_id: 1207, value: 2 }, { student_id: 1203, value: 5 }]);
    expect(labels).toEqual({ student_id: { "1203": "Bart Simpson" } });
  });

  it("no id columns, no queries", async () => {
    let asked = false;
    const labels = await entityLabels(async () => { asked = true; return []; }, ["week", "value"], [{ week: "2026-10-05", value: 4 }]);
    expect(asked).toBe(false);
    expect(labels).toEqual({});
  });
});

describe("withLabels", () => {
  it("writes Name (id) for known ids and leaves the rest", () => {
    const rows = withLabels([{ student: 1082, value: 3 }, { student: 9999, value: 1 }, { student: null, value: 0 }], { student: { "1082": "Ana Lopez" } });
    expect(rows).toEqual([{ student: "Ana Lopez (1082)", value: 3 }, { student: 9999, value: 1 }, { student: null, value: 0 }]);
  });
  it("returns the same rows when there are no labels", () => {
    const rows = [{ value: 1 }];
    expect(withLabels(rows, {})).toBe(rows);
  });
});

describe("mergeLabels", () => {
  it("unions maps per column across steps", () => {
    const out = mergeLabels({ student: { "1": "A" } }, { student: { "2": "B" }, room: { "9": "Gym" } });
    expect(out).toEqual({ student: { "1": "A", "2": "B" }, room: { "9": "Gym" } });
  });
});
