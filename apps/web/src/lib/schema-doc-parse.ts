/**
 * Parses the planner's schema document (packages/agent/src/schema-doc.ts loadSchemaDoc) into sections for display.
 * The line formats are the ones that function emits; a line that fits none of them is kept verbatim, never dropped.
 */
export type DocColumn = { column: string; type: string; comment: string };
export type DocView = { name: string; comment: string; columns: DocColumn[]; other: string[] };
export type DocNote = { topic: string; text: string };
export type DocExample = { view: string; question: string; spec: string };
export type ParsedSchemaDoc = { views: DocView[]; notes: DocNote[]; examples: DocExample[]; unparsed: string[] };

/** "- column (type): comment". The type may hold parentheses and commas (numeric(5,2)); the comment may hold colons. */
const COLUMN = /^- (\S+) \((.+?)\)(?=: |$)(?:: (.*))?$/;
const EXAMPLE_SEP = " -> spec ";

type Section = "views" | "notes" | "examples" | null;

function sectionOf(heading: string): Section {
  const h = heading.toLowerCase();
  if (h.includes("view")) return "views";
  if (h.includes("note")) return "notes";
  if (h.includes("example")) return "examples";
  return null;
}

export function parseSchemaDoc(text: string): ParsedSchemaDoc {
  const out: ParsedSchemaDoc = { views: [], notes: [], examples: [], unparsed: [] };
  let section: Section = null;
  let view: DocView | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith("## ")) { section = sectionOf(line.slice(3)); view = null; continue; }
    if (section === "views") {
      if (line.startsWith("### ")) { view = { name: line.slice(4).trim(), comment: "", columns: [], other: [] }; out.views.push(view); continue; }
      if (!view) { out.unparsed.push(line); continue; }
      const m = COLUMN.exec(line);
      if (m) view.columns.push({ column: m[1]!, type: m[2]!, comment: m[3] ?? "" });
      else if (line.startsWith("- ")) view.other.push(line.slice(2));
      else view.comment = view.comment ? `${view.comment} ${line}` : line;
      continue;
    }
    if (section === "notes" && line.startsWith("- ")) {
      const body = line.slice(2);
      const i = body.indexOf(": ");
      if (i > 0) out.notes.push({ topic: body.slice(0, i), text: body.slice(i + 2) });
      else out.unparsed.push(line);
      continue;
    }
    if (section === "examples" && line.startsWith("- ")) {
      const body = line.slice(2);
      const sep = body.indexOf(EXAMPLE_SEP);
      const colon = body.indexOf(": ");
      if (sep > 0 && colon > 0 && colon < sep) {
        let question = body.slice(colon + 2, sep).trim();
        if (question.startsWith('"') && question.endsWith('"') && question.length >= 2) question = question.slice(1, -1);
        out.examples.push({ view: body.slice(0, colon), question, spec: body.slice(sep + EXAMPLE_SEP.length) });
      } else out.unparsed.push(line);
      continue;
    }
    out.unparsed.push(line);
  }
  return out;
}
