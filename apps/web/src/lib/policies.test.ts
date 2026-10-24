import { describe, expect, it } from "vitest";
import { appliesTo } from "./policies";

/** Quals as pg_policies prints them today, one per rule. */
const ROLE = "( SELECT current_setting('app.role'::text, true) AS current_setting)";
const SCHOOL = "(school_id = ( SELECT (NULLIF(current_setting('app.school_id'::text, true), ''::text))::integer AS int4))";

describe("appliesTo", () => {
  it("names the reader each policy admits, in the brief's order", () => {
    expect(appliesTo(`((${ROLE} = 'teacher'::text) AND (section_id IN ( SELECT analytics.my_section_ids() AS my_section_ids)))`)).toBe("Teacher");
    expect(appliesTo(`((${ROLE} = 'admin'::text) AND ${SCHOOL})`)).toBe("Admin");
    expect(appliesTo(`((${ROLE} = 'super_admin'::text) OR ${SCHOOL})`)).toBe("Every role within its school, Super admin everywhere");
    expect(appliesTo(`(${ROLE} = 'super_admin'::text)`)).toBe("Super admin");
    expect(appliesTo("(((persona ->> 'user_id'::text))::integer = ( SELECT (NULLIF(current_setting('app.user_id'::text, true), ''::text))::integer AS int4))")).toBe("The user who asked (history)");
    expect(appliesTo("true")).toBe("App role, no row filter");
    expect(appliesTo("(run_id IN ( SELECT runs.id FROM runs))")).toBe("Through the user's own runs (history)");
    expect(appliesTo(null)).toBe("No role condition");
  });
});
