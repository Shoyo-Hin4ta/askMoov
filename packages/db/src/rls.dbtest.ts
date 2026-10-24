import { afterAll, describe, expect, it } from "vitest";
import type { Persona } from "@ask-moov/shared";
import { closePools, getAdminPool, getQueryPool, withScope } from "./index";

/**
 * Phase 5: authorization proven against the real database (design doc 8.4).
 * Runs on the seeded project. Every number comes from Postgres; nothing here goes through the model.
 */
const KRABAPPEL = 12, HOOVER = 17, BART = 1203, NELSON = 1207, LISA = 1205;
const teacher = (user_id: number): Persona => ({ role: "teacher", user_id, school_id: 1, scope_summary: `teacher ${user_id}` });
const admin: Persona = { role: "admin", user_id: 1001, school_id: 1, scope_summary: "principal" };
const admin2: Persona = { role: "admin", user_id: 1002, school_id: 2, scope_summary: "principal 2" };
const superAdmin: Persona = { role: "super_admin", user_id: 9001, school_id: 1, scope_summary: "superintendent" };

const q = getQueryPool();
const count = (p: Persona, sql: string, params: unknown[] = []) =>
  withScope(q, p, async (c) => Number((await c.query(sql, params)).rows[0]?.["n"] ?? 0));
const truth = async (sql: string, params: unknown[] = []) => Number((await getAdminPool().query(sql, params)).rows[0]?.["n"] ?? 0);

afterAll(closePools);

describe("rls.noconfig", () => {
  it("the query role with no session variables gets zero rows from every view", async () => {
    const c = await q.connect();
    try {
      // With no persona nothing can use an index: the policy rejects every row of a full scan (presence: 672k rows, 1 to 6 s
      // on this instance) against the role's 5 s statement timeout. Only this test runs without a persona; the app always sets
      // one. SET LOCAL is transaction-scoped, so the pooled connection goes back with the role default.
      await c.query("BEGIN");
      await c.query("SET LOCAL statement_timeout = '30s'");
      for (const v of ["v_passes", "v_attendance_daily", "v_tardies", "v_entry", "v_presence", "v_cards", "v_device_uptime", "v_entities", "v_section_roster"]) {
        const r = await c.query(`select count(*) as n from analytics.${v}`);
        expect(Number(r.rows[0]!["n"]), v).toBe(0);
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally { c.release(); }
  });
});

describe("rls.teacher", () => {
  it("sees passes for exactly their own sections", async () => {
    const mine = await count(teacher(KRABAPPEL), "select count(*) as n from analytics.v_passes");
    const expected = await truth("select count(*) as n from public.passes where section_id in (select id from public.sections where teacher_id = $1)", [KRABAPPEL]);
    expect(mine).toBe(expected);
    expect(mine).toBeGreaterThan(0);
  });
  it("gets zero rows when naming another teacher's section id", async () => {
    const other = await getAdminPool().query("select id from public.sections where teacher_id = $1 limit 1", [HOOVER]);
    const n = await count(teacher(KRABAPPEL), "select count(*) as n from analytics.v_passes where section_id = $1", [other.rows[0]!["id"]]);
    expect(n).toBe(0);
  });
  it("resolves only students on their rosters: Bart yes, Nelson no", async () => {
    const bart = await count(teacher(KRABAPPEL), "select count(*) as n from analytics.v_entities where type='student' and id = $1", [String(BART)]);
    const nelson = await count(teacher(KRABAPPEL), "select count(*) as n from analytics.v_entities where type='student' and id = $1", [String(NELSON)]);
    expect(bart).toBe(1);
    expect(nelson).toBe(0);
  });
  it("sees no device data at all", async () => {
    expect(await count(teacher(KRABAPPEL), "select count(*) as n from analytics.v_device_uptime")).toBe(0);
  });
  it("sees entry tardies (no section) for students on their rosters: Bart", async () => {
    const sql = "select count(*) as n from analytics.v_tardies where kind = 'entry' and student_id = $1 and student_id in (select student_id from analytics.v_section_roster where teacher_id = $2)";
    const mine = await count(teacher(KRABAPPEL), sql, [BART, KRABAPPEL]);
    const expected = await truth("select count(*) as n from public.entry_events where tardy and student_id = $1", [BART]);
    expect(mine).toBe(expected);
    expect(mine).toBeGreaterThan(0);
  });
});

describe("rls.teacher_vs_teacher", () => {
  it("A cannot see B's attendance, overrides, or students only in B's classes", async () => {
    const hooverOnly = await getAdminPool().query(
      `select r.student_id from public.rosters r join public.sections s on s.id = r.section_id where s.teacher_id = $1
       and r.student_id not in (select r2.student_id from public.rosters r2 join public.sections s2 on s2.id = r2.section_id where s2.teacher_id = $2) limit 1`, [HOOVER, KRABAPPEL]);
    const studentOnlyInB = hooverOnly.rows[0]!["student_id"];
    expect(await count(teacher(KRABAPPEL), "select count(*) as n from analytics.v_attendance_daily where teacher_id = $1", [HOOVER])).toBe(0);
    expect(await count(teacher(KRABAPPEL), "select count(*) as n from analytics.v_attendance_daily where source='manual' and teacher_id = $1", [HOOVER])).toBe(0);
    expect(await count(teacher(KRABAPPEL), "select count(*) as n from analytics.v_entities where type='student' and id = $1", [String(studentOnlyInB)])).toBe(0);
    expect(await count(teacher(KRABAPPEL), "select count(*) as n from analytics.v_passes where student_id = $1", [studentOnlyInB])).toBe(0);
  });
  it("B's email is unreadable at the column level, for any role", async () => {
    await expect(withScope(q, superAdmin, (c) => c.query("select email from public.teachers limit 1"))).rejects.toThrow(/permission denied/);
  });
  it("A still sees B's name, so lookups can say 'not available' instead of 'no such teacher'", async () => {
    expect(await count(teacher(KRABAPPEL), "select count(*) as n from analytics.v_entities where type='teacher' and id = $1", [String(HOOVER)])).toBe(1);
  });
});

describe("rls.admin", () => {
  it("sees everything in their school and nothing from the other", async () => {
    const mine = await count(admin, "select count(*) as n from analytics.v_passes");
    const all1 = await truth("select count(*) as n from public.passes where school_id = 1");
    expect(mine).toBe(all1);
    expect(await count(admin, "select count(*) as n from analytics.v_passes where school_id = 2")).toBe(0);
    expect(await count(admin2, "select count(*) as n from analytics.v_passes where school_id = 1")).toBe(0);
    expect(await count(admin, "select count(*) as n from analytics.v_device_uptime")).toBeGreaterThan(0);
  });
});

describe("rls.super", () => {
  it("sees both schools", async () => {
    expect(await count(superAdmin, "select count(distinct school_id) as n from analytics.v_attendance_daily")).toBe(2);
    const all = await truth("select count(*) as n from public.passes");
    expect(await count(superAdmin, "select count(*) as n from analytics.v_passes")).toBe(all);
  });
});

describe("rls.bypass", () => {
  it("reading the base table directly returns the same scoped rows as the view, never more", async () => {
    const viaView = await count(teacher(KRABAPPEL), "select count(*) as n from analytics.v_passes");
    const direct = await count(teacher(KRABAPPEL), "select count(*) as n from public.passes");
    expect(direct).toBe(viaView);
  });
  it("cannot write, even inside its transaction", async () => {
    await expect(withScope(q, superAdmin, (c) => c.query("insert into public.schools values (99,'x')"))).rejects.toThrow(/read-only/);
  });
});

describe("rls.history", () => {
  it("a user sees only their own runs in v_my_history", async () => {
    const a = getAdminPool();
    const mk = async (userId: number, role: string) => {
      const id = (await a.query("select gen_random_uuid() as id")).rows[0]!["id"];
      await a.query("insert into ops.runs (id, thread_id, persona, question, status) values ($1, $2, $3, $4, 'succeeded')",
        [id, `t-${userId}`, JSON.stringify({ role, user_id: userId, school_id: 1 }), `rls history test ${userId}`]);
      await a.query("insert into ops.run_entities (run_id, entity_type, entity_id) values ($1, 'student', $2)", [id, String(LISA)]);
      return id;
    };
    const r12 = await mk(KRABAPPEL, "teacher"), r17 = await mk(HOOVER, "teacher");
    try {
      expect(await count(teacher(KRABAPPEL), "select count(*) as n from analytics.v_my_history where question like 'rls history test%'")).toBe(1);
      expect(await count(teacher(HOOVER), "select count(*) as n from analytics.v_my_history where question like 'rls history test%'")).toBe(1);
      expect(await count(superAdmin, "select count(*) as n from analytics.v_my_history where question like 'rls history test%'")).toBe(0);
    } finally {
      await a.query("delete from ops.runs where id = any($1::uuid[])", [[r12, r17]]);
    }
  });
});
