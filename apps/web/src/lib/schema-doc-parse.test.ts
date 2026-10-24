import { describe, expect, it } from "vitest";
import { parseSchemaDoc } from "./schema-doc-parse";

const TEXT = [
  "## Views (schema analytics; every query reads these and nothing else)",
  "",
  "### analytics.v_passes",
  "One row per pass. Bathroom passes have no destination tap: the destination is assumed.",
  "- student_id (integer)",
  "- minutes (numeric(5,2)): minutes out, inferred from the next tap: an upper bound",
  "- started_at (timestamp with time zone): when the pass began",
  "- tags (text[])",
  "- a line that is not a column",
  "",
  "## Domain notes (what the data means; these are facts, not suggestions)",
  "- bells: first bell 07:52, clock = history for asked_at",
  "- broken note without a separator",
  "",
  "## Worked examples",
  '- v_passes: "How many \\"long\\" passes?" -> spec {"metric":"pass_count"}',
  "- v_passes: malformed example",
].join("\n");

describe("parseSchemaDoc", () => {
  it("parses views, columns with parenthesised types and colons in comments, notes and examples; keeps the rest verbatim", () => {
    const doc = parseSchemaDoc(TEXT);
    expect(doc.views).toHaveLength(1);
    const v = doc.views[0]!;
    expect(v.name).toBe("analytics.v_passes");
    expect(v.comment).toBe("One row per pass. Bathroom passes have no destination tap: the destination is assumed.");
    expect(v.columns).toEqual([
      { column: "student_id", type: "integer", comment: "" },
      { column: "minutes", type: "numeric(5,2)", comment: "minutes out, inferred from the next tap: an upper bound" },
      { column: "started_at", type: "timestamp with time zone", comment: "when the pass began" },
      { column: "tags", type: "text[]", comment: "" },
    ]);
    expect(v.other).toEqual(["a line that is not a column"]);
    expect(doc.notes).toEqual([{ topic: "bells", text: "first bell 07:52, clock = history for asked_at" }]);
    expect(doc.examples).toEqual([{ view: "v_passes", question: 'How many \\"long\\" passes?', spec: '{"metric":"pass_count"}' }]);
    expect(doc.unparsed).toEqual(["- broken note without a separator", "- v_passes: malformed example"]);
  });
  it("a document without the examples section parses with no examples", () => {
    const doc = parseSchemaDoc("## Views\n### analytics.v_x\n- id (integer)\n## Domain notes\n- t: x");
    expect(doc.examples).toEqual([]);
    expect(doc.views[0]!.columns).toEqual([{ column: "id", type: "integer", comment: "" }]);
    expect(doc.notes).toEqual([{ topic: "t", text: "x" }]);
  });
});
