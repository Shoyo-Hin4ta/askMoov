import { parse, scan } from "libpg-query";
import { SqlRejectedError } from "./errors";

/**
 * Gate for every statement that reaches the query pool, compiled or model-written.
 * Real parser, not regex. Rules (design doc 4.7):
 *  1. must parse; 2. exactly one statement, a SELECT (WITH ... SELECT allowed);
 *  3. only analytics.* relations and an allowlisted function set; 4. has a LIMIT (injected for tier 3);
 *  5. no INTO, no FOR UPDATE, no comments. EXPLAIN happens in execute, outside unit tests.
 */
export const ALLOWED_SCHEMA = "analytics";
export const ALLOWED_FUNCTIONS = new Set([
  "count", "sum", "avg", "min", "max",
  "date_trunc", "extract", "date_part", "coalesce", "nullif", "round", "greatest", "least",
  "lead", "lag", "row_number", "rank", "dense_rank", "percentile_cont",
  "lower", "upper", "to_char", "make_interval", "make_time", "frozen_now", "string_agg",
]);
export const INJECTED_LIMIT = 500;

export type Validation = { ok: true; sql: string } | { ok: false; reason: string };

type Node = Record<string, unknown>;

export async function validateSql(sql: string, opts: { injectLimit: boolean }): Promise<Validation> {
  const clean = sql.trim().replace(/;\s*$/, "");
  if (clean.includes(";")) return reject("multiple statements are not allowed");

  let tree: { stmts?: { stmt?: Node }[] };
  try {
    tree = (await parse(clean)) as typeof tree;
  } catch (e) {
    return reject(`parse error: ${(e as Error).message}`);
  }

  const tokens = (await scan(clean)).tokens;
  if (tokens.some((t) => /COMMENT/i.test(t.tokenName))) return reject("comments are not allowed");

  const stmts = tree.stmts ?? [];
  if (stmts.length !== 1) return reject(`expected exactly one statement, got ${stmts.length}`);
  const stmt = stmts[0]!.stmt ?? {};
  const kinds = Object.keys(stmt);
  if (kinds.length !== 1 || kinds[0] !== "SelectStmt") return reject(`only SELECT is allowed, got ${kinds.join(",") || "unknown"}`);
  const select = stmt["SelectStmt"] as Node;

  if (select["intoClause"]) return reject("SELECT INTO is not allowed");
  if (Array.isArray(select["lockingClause"]) && select["lockingClause"].length) return reject("FOR UPDATE/SHARE is not allowed");

  const cteNames = new Set<string>();
  const problems: string[] = [];
  walk(stmt, (key, node) => {
    if (key === "CommonTableExpr" && typeof node["ctename"] === "string") cteNames.add(node["ctename"]);
  });
  walk(stmt, (key, node) => {
    if (key === "RangeVar") {
      const schema = node["schemaname"] as string | undefined;
      const rel = node["relname"] as string;
      if (!schema && cteNames.has(rel)) return;
      if (schema !== ALLOWED_SCHEMA) problems.push(`relation ${schema ? schema + "." : ""}${rel} is not in ${ALLOWED_SCHEMA}`);
    }
    if (key === "FuncCall") {
      const name = funcName(node);
      if (!ALLOWED_FUNCTIONS.has(name)) problems.push(`function ${name}() is not allowed`);
    }
    if (key === "SQLValueFunction") problems.push("current_date / current_time style functions are not allowed; use the frozen now from the prompt");
  });
  if (problems.length) return reject([...new Set(problems)].join("; "));

  const hasLimit = Boolean(select["limitCount"]);
  if (!hasLimit) {
    if (!opts.injectLimit) return reject("missing LIMIT");
    return { ok: true, sql: `${clean}\nLIMIT ${INJECTED_LIMIT}` };
  }
  return { ok: true, sql: clean };
}

/** Throwing form for callers that treat rejection as an error. */
export async function assertValidSql(sql: string, opts: { injectLimit: boolean }): Promise<string> {
  const v = await validateSql(sql, opts);
  if (!v.ok) throw new SqlRejectedError(v.reason, sql);
  return v.sql;
}

function reject(reason: string): Validation {
  return { ok: false, reason };
}

function funcName(node: Node): string {
  const parts = (node["funcname"] as Node[] | undefined) ?? [];
  const names = parts.map((p) => {
    const s = p["String"] as Node | undefined;
    return String(s?.["sval"] ?? s?.["str"] ?? "");
  });
  return (names[names.length - 1] ?? "").toLowerCase();
}

function walk(node: unknown, visit: (key: string, node: Node) => void): void {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return; }
  if (!node || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node as Node)) {
    if (v && typeof v === "object" && !Array.isArray(v)) visit(k, v as Node);
    walk(v, visit);
  }
}
