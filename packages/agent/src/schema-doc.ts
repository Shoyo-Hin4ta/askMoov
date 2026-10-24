/**
 * Schema knowledge comes from migrations (principle 5): view and column comments, domain notes, worked examples.
 * Introspected once per worker process and hashed into schema_version. No hand-maintained schema doc.
 */
export type SchemaDoc = { text: string; version: string };
export type AdminQuery = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

/**
 * One cheap query the worker runs per invocation. The database hashes the current view definitions, comments,
 * domain notes and examples; if the result differs from the cached version, loadSchemaDoc runs again.
 * No migration has to "bump" anything: the catalog is the source of truth.
 */
export const SCHEMA_VERSION_SQL = `
  SELECT md5(
    (SELECT coalesce(string_agg(c.relname || ':' || coalesce(obj_description(c.oid, 'pg_class'), '') || ':' ||
             (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || coalesce(col_description(c.oid, a.attnum), ''), ',' ORDER BY a.attnum)
              FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped), '|' ORDER BY c.relname), '')
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'analytics' AND c.relkind = 'v')
    || (SELECT coalesce(string_agg(topic || '=' || text, '|' ORDER BY topic), '') FROM memory.domain_notes)
    || (SELECT coalesce(string_agg(view_name || '=' || question || '=' || spec::text, '|' ORDER BY view_name, question), '') FROM memory.schema_examples)
  ) AS version`;

export async function currentSchemaVersion(query: AdminQuery): Promise<string> {
  const rows = await query(SCHEMA_VERSION_SQL, []);
  return String(rows[0]?.["version"] ?? "").slice(0, 12);
}

export async function loadSchemaDoc(query: AdminQuery): Promise<SchemaDoc> {
  const version = await currentSchemaVersion(query);
  const views = await query(
    `SELECT c.relname AS view, obj_description(c.oid, 'pg_class') AS comment
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'analytics' AND c.relkind = 'v' ORDER BY c.relname`, []);
  const columns = await query(
    `SELECT c.relname AS view, a.attname AS column, format_type(a.atttypid, a.atttypmod) AS type,
            col_description(c.oid, a.attnum) AS comment
     FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'analytics' AND c.relkind = 'v' AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY c.relname, a.attnum`, []);
  const notes = await query("SELECT topic, text FROM memory.domain_notes ORDER BY topic", []);
  const examples = await query("SELECT view_name, question, spec, sql FROM memory.schema_examples ORDER BY view_name, question", []);

  const lines: string[] = ["## Views (schema analytics; every query reads these and nothing else)"];
  for (const v of views) {
    lines.push(`\n### analytics.${v["view"]}`);
    if (v["comment"]) lines.push(String(v["comment"]));
    for (const c of columns.filter((c) => c["view"] === v["view"])) {
      lines.push(`- ${c["column"]} (${c["type"]})${c["comment"] ? `: ${c["comment"]}` : ""}`);
    }
  }
  lines.push("\n## Domain notes (what the data means; these are facts, not suggestions)");
  for (const n of notes) lines.push(`- ${n["topic"]}: ${n["text"]}`);
  if (examples.length) {
    lines.push("\n## Worked examples");
    for (const e of examples) {
      lines.push(`- ${e["view_name"]}: "${e["question"]}" -> spec ${JSON.stringify(e["spec"])}`);
    }
  }
  return { text: lines.join("\n"), version };
}
