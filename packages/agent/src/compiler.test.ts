import { describe, expect, it } from "vitest";
import { METRICS } from "@ask-moov/shared";
import { compile } from "./compiler";
import { PlanValidationError } from "./errors";
import { PERSONAS, REPRESENTATIVE_SPECS } from "./fixtures";

const teacher = PERSONAS[0]!, admin = PERSONAS[1]!, superAdmin = PERSONAS[2]!;

describe("compiler", () => {
  it("covers every metric in the registry", () => {
    const covered = new Set(Object.values(REPRESENTATIVE_SPECS).map((s) => s.metric));
    for (const m of METRICS) expect(covered.has(m), m).toBe(true);
  });

  for (const [name, spec] of Object.entries(REPRESENTATIVE_SPECS)) {
    it(`snapshot: ${name}`, () => {
      const out = compile(spec, superAdmin);
      expect(out).toMatchSnapshot();
    });
  }

  it("is deterministic", () => {
    for (const spec of Object.values(REPRESENTATIVE_SPECS)) {
      const a = compile(spec, teacher), b = compile(spec, teacher);
      expect(a.sql).toBe(b.sql);
      expect(a.params).toEqual(b.params);
    }
  });

  it("adds a teacher scope predicate and none for super_admin", () => {
    const spec = REPRESENTATIVE_SPECS["pass_count_by_period_wing"]!;
    const t = compile(spec, teacher), s = compile(spec, superAdmin), a = compile(spec, admin);
    expect(t.sql).toContain("teacher_id = $");
    expect(t.params).toContain(teacher.user_id);
    expect(t.caveats).toContain("scope_limited");
    expect(s.sql).not.toContain("teacher_id");
    expect(s.sql).not.toContain("school_id = $");
    expect(a.sql).toContain("school_id = $");
    expect(a.params).toContain(admin.school_id);
  });

  it("teacher scope on v_tardies is by student: entry tardies have no section_id", () => {
    const { sql } = compile(REPRESENTATIVE_SPECS["tardy_count_by_week"]!, teacher);
    expect(sql).toContain("student_id IN (SELECT student_id FROM analytics.v_section_roster WHERE teacher_id = $");
    expect(sql).not.toContain("section_id IN");
  });

  it("teachers get nothing from device views even before RLS", () => {
    const out = compile(REPRESENTATIVE_SPECS["device_uptime"]!, teacher);
    expect(out.sql).toContain("false");
  });

  it("casts range bounds to the time column's own type, so the comparison is leakproof and can use an index under RLS", () => {
    expect(compile(REPRESENTATIVE_SPECS["pass_count_ab"]!, admin).sql).toContain("started_at >= $1::timestamptz AND started_at < ($2::date + 1)::timestamptz");
    expect(compile(REPRESENTATIVE_SPECS["students_at_location"]!, admin).sql).toContain("arrived_at >= $1::timestamptz AND arrived_at < ($2::date + 1)::timestamptz");
    expect(compile(REPRESENTATIVE_SPECS["entry_count_minute"]!, admin).sql).toContain("ts >= $1::timestamptz");
    expect(compile(REPRESENTATIVE_SPECS["absent_count"]!, admin).sql).toContain("date >= $1::date AND date < ($2::date + 1)");
    expect(compile(REPRESENTATIVE_SPECS["tardy_count_by_week"]!, admin).sql).toContain("date >= $1::date");
    for (const spec of Object.values(REPRESENTATIVE_SPECS)) expect(compile(spec, admin).sql).not.toMatch(/_at >= \$\d+::date|\bts >= \$\d+::date|\bhour >= \$\d+::date/);
  });

  it("never interpolates ids or dates", () => {
    for (const spec of Object.values(REPRESENTATIVE_SPECS)) {
      const { sql } = compile(spec, admin);
      expect(sql).not.toMatch(/2026-\d\d-\d\d/);
      expect(sql).not.toMatch(/\b1203\b/);
    }
  });

  it("my_history only touches v_my_history and carries no scope predicate", () => {
    const { sql } = compile(REPRESENTATIVE_SPECS["my_history"]!, teacher);
    expect(sql).toContain("analytics.v_my_history");
    expect(sql).not.toContain("v_section_roster");
    expect(sql).not.toContain("school_id");
  });

  it("shapes follow the group_by", () => {
    expect(compile(REPRESENTATIVE_SPECS["attendance_rate_section"]!, admin).shape).toBe("scalar");
    expect(compile(REPRESENTATIVE_SPECS["attendance_rate_by_week"]!, admin).shape).toBe("series");
    expect(compile(REPRESENTATIVE_SPECS["present_count_calendar"]!, admin).shape).toBe("entity_by_day");
    expect(compile(REPRESENTATIVE_SPECS["out_minutes_top"]!, admin).shape).toBe("categories");
    expect(compile(REPRESENTATIVE_SPECS["pass_count_by_period_wing"]!, admin).shape).toBe("grouped");
    expect(compile(REPRESENTATIVE_SPECS["who_was_where"]!, admin).shape).toBe("rows");
    const range = { start: "2026-10-01", end: "2026-10-13" };
    expect(compile({ metric: "pass_count", time_range: range, group_by: ["week", "wing"] }, admin).shape).toBe("rows"); // a category over time has no chart yet
    expect(compile({ metric: "absent_count", time_range: range, group_by: ["period", "wing"] }, admin).shape).toBe("grouped");
  });

  it("a filtered count grouped by an entity drops zero groups; scalars, time series and plain counts keep theirs", () => {
    const range = { start: "2026-09-28", end: "2026-10-09" };
    const byStudent = compile(REPRESENTATIVE_SPECS["override_count"]!, admin).sql;
    expect(byStudent).toContain("HAVING (count(*) filter (where source = 'manual'))::int > 0");
    expect(byStudent.indexOf("GROUP BY")).toBeLessThan(byStudent.indexOf("HAVING"));
    expect(byStudent.indexOf("HAVING")).toBeLessThan(byStudent.indexOf("ORDER BY"));
    expect(compile({ metric: "override_count", entity: { type: "teacher", id: 12 }, time_range: range, filters: { status: "absent" } }, admin).sql).not.toContain("HAVING"); // scalar
    expect(compile({ metric: "absent_count", entity: { type: "student", id: 1203 }, time_range: range, group_by: ["week"] }, admin).sql).not.toContain("HAVING"); // series keeps zero weeks
    expect(compile(REPRESENTATIVE_SPECS["present_count_calendar"]!, admin).sql).not.toContain("HAVING"); // a calendar needs its zero days
    expect(compile({ metric: "pass_count", time_range: range, group_by: ["student"] }, admin).sql).not.toContain("HAVING"); // a plain count has no zero groups
    expect(compile({ metric: "absent_count", time_range: range, group_by: ["period", "wing"] }, admin).sql).toContain("HAVING");
  });

  it("grouping by wing carries the caveat that rooms outside the wings form an empty group", () => {
    expect(compile(REPRESENTATIVE_SPECS["pass_count_by_period_wing"]!, admin).caveats).toContain("no_wing_group");
    expect(compile(REPRESENTATIVE_SPECS["out_minutes_top"]!, admin).caveats).not.toContain("no_wing_group");
  });

  it("flags inferred metrics", () => {
    expect(compile(REPRESENTATIVE_SPECS["dwell_minutes"]!, admin).caveats).toContain("inferred_from_next_tap");
    expect(compile(REPRESENTATIVE_SPECS["who_was_where"]!, admin).caveats).toContain("inferred_from_next_tap");
  });

  it.each([
    ["group_by not allowed", { metric: "tardy_count", time_range: { start: "2026-09-01", end: "2026-09-30" }, group_by: ["wing"] }],
    ["filter not allowed", { metric: "entry_count", time_range: { start: "2026-09-01", end: "2026-09-30" }, filters: { destination: "nurse" } }],
    ["missing required filter", { metric: "who_was_where", time_range: { start: "2026-09-01", end: "2026-09-30" }, time_point: "2026-09-10T10:00:00Z" }],
    ["missing time_point", { metric: "last_known_location", time_range: { start: "2026-09-01", end: "2026-09-30" } }],
    ["bad date", { metric: "pass_count", time_range: { start: "Sept 1", end: "2026-09-30" } }],
    ["reversed range", { metric: "pass_count", time_range: { start: "2026-09-30", end: "2026-09-01" } }],
    ["entity type not allowed", { metric: "device_uptime", entity: { type: "student", id: 1 }, time_range: { start: "2026-09-01", end: "2026-09-30" } }],
    ["order by unknown column", { metric: "pass_count", time_range: { start: "2026-09-01", end: "2026-09-30" }, group_by: ["student"], order: { by: "wing", dir: "asc" } }],
  ])("rejects %s", (_name, spec) => {
    expect(() => compile(spec as never, admin)).toThrow(PlanValidationError);
  });

  it("a filter given as one value or as a one-element list compiles to the same SQL; several values become ANY", () => {
    const range = { start: "2026-10-01", end: "2026-10-13" };
    const one = compile({ metric: "pass_count", time_range: range, filters: { destination: "bathroom", period: 6 } }, admin);
    const list = compile({ metric: "pass_count", time_range: range, filters: { destination: ["bathroom"], period: [6] } }, admin);
    expect(list.sql).toBe(one.sql);
    expect(list.params).toEqual(one.params);
    expect(one.sql).toContain("destination = $3");
    expect(one.sql).toContain("period = $4");
    const many = compile({ metric: "pass_count", time_range: range, filters: { destination: ["bathroom", "nurse"], day_of_week: 2 } }, admin);
    expect(many.sql).toContain("destination = ANY($3)");
    expect(many.sql).toContain("extract(isodow from started_at)::int = ANY($4)");
    expect(many.params).toEqual(["2026-10-01", "2026-10-13", ["bathroom", "nurse"], [2], admin.school_id]);
    expect(() => compile({ metric: "pass_count", time_range: range, filters: { period: [] } }, admin)).toThrow(/empty list/);
  });

  it("caps limit at 500", () => {
    const { sql } = compile({ metric: "pass_count", time_range: { start: "2026-09-01", end: "2026-09-30" }, group_by: ["student"], limit: 9999 }, admin);
    expect(sql.endsWith("LIMIT 500")).toBe(true);
  });
});
