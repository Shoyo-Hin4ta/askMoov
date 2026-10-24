import { describe, expect, it } from "vitest";
import { validateSql } from "./validator";
import { compile } from "./compiler";
import { REPRESENTATIVE_SPECS, PERSONAS } from "./fixtures";

const ok = (sql: string, injectLimit = false) => validateSql(sql, { injectLimit });

describe("validator", () => {
  it.each([
    ["DELETE", "DELETE FROM analytics.v_passes"],
    ["UPDATE", "UPDATE analytics.v_passes SET minutes = 0"],
    ["SELECT INTO", "SELECT * INTO t FROM analytics.v_passes LIMIT 1"],
    ["two statements", "SELECT 1 FROM analytics.v_passes LIMIT 1; SELECT 2 FROM analytics.v_passes LIMIT 1"],
    ["public schema", "SELECT * FROM public.students LIMIT 1"],
    ["ops schema", "SELECT * FROM ops.runs LIMIT 1"],
    ["unqualified relation", "SELECT * FROM students LIMIT 1"],
    ["pg_sleep", "SELECT pg_sleep(10) FROM analytics.v_passes LIMIT 1"],
    ["FOR UPDATE", "SELECT * FROM analytics.v_passes LIMIT 1 FOR UPDATE"],
    ["comment", "SELECT * FROM analytics.v_passes -- hi\nLIMIT 1"],
    ["current_date", "SELECT current_date FROM analytics.v_passes LIMIT 1"],
    ["unparseable", "SELEC * FROM analytics.v_passes"],
  ])("rejects %s", async (_name, sql) => {
    const v = await ok(sql);
    expect(v.ok).toBe(false);
  });

  it("rejects missing LIMIT when not injecting (compiled path)", async () => {
    const v = await ok("SELECT count(*) FROM analytics.v_passes");
    expect(v).toEqual({ ok: false, reason: "missing LIMIT" });
  });

  it("injects LIMIT 500 on tier 3 SQL without one", async () => {
    const v = await ok("SELECT count(*) FROM analytics.v_passes", true);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.sql.endsWith("LIMIT 500")).toBe(true);
  });

  it("accepts WITH ... SELECT over analytics views and a CTE reference", async () => {
    const v = await ok(
      "WITH t AS (SELECT student_id, count(*) n FROM analytics.v_passes GROUP BY 1) SELECT t.student_id, n FROM t JOIN analytics.v_section_roster r ON r.student_id = t.student_id ORDER BY n DESC LIMIT 10",
    );
    expect(v.ok).toBe(true);
  });

  it("accepts every compiler output", async () => {
    for (const persona of PERSONAS) {
      for (const [name, spec] of Object.entries(REPRESENTATIVE_SPECS)) {
        const { sql } = compile(spec, persona);
        const v = await ok(sql);
        expect(v.ok, `${name} for ${persona.role}: ${!v.ok ? v.reason : ""}`).toBe(true);
      }
    }
  });
});
