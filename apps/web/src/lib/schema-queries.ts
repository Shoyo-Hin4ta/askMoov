import { loadSchemaDoc, type SchemaDoc } from "@ask-moov/agent";
import { getAppPool } from "@ask-moov/db";

/** The /schema page's facts, every one read from the database at request time. Read-only on the app pool. */
export type PolicyRow = { schemaname: string; tablename: string; policyname: string; cmd: string; qual: string | null };
export type ColumnPrivilege = { table: string; column: string; readable: boolean };
export type RoleSetting = { role: string; setting: string };
export type SchemaPageData = { doc: SchemaDoc; policies: PolicyRow[]; columns: ColumnPrivilege[]; roles: RoleSetting[] };

/** Row-level security policies on the data and trace tables, readable by the app role. */
const POLICIES_SQL = "select schemaname, tablename, policyname, cmd, qual from pg_policies where schemaname in ('public','ops') order by 1,2,3";

/** Every public table column and whether the query role may read it. pg_attribute, because information_schema hides columns from a role with no privilege on them. */
const COLUMNS_SQL = `
  select format('%I.%I', n.nspname, c.relname) as "table", a.attname as "column",
         has_column_privilege('ask_moov_query', format('%I.%I', n.nspname, c.relname), a.attname, 'SELECT') as readable
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
  order by readable, c.relname, a.attnum`;

/** The two application roles' settings, one row per setting. */
const ROLES_SQL = "select rolname as role, unnest(rolconfig) as setting from pg_roles where rolname like 'ask_moov%' order by 1, 2";

export async function schemaPageData(): Promise<SchemaPageData> {
  const pool = getAppPool();
  const query = (sql: string, params: unknown[]) => pool.query(sql, params).then((r) => r.rows as Record<string, unknown>[]);
  const [doc, policies, columns, roles] = await Promise.all([loadSchemaDoc(query), query(POLICIES_SQL, []), query(COLUMNS_SQL, []), query(ROLES_SQL, [])]);
  return { doc, policies: policies as PolicyRow[], columns: columns as ColumnPrivilege[], roles: roles as RoleSetting[] };
}
