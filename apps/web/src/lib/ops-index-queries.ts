import { getAppPool } from "@ask-moov/db";
import { escapeLike, utcBounds, type CallFilters, type RunFilters } from "./ops-filters";

/** The /ops index queries: every run, every model call. Read-only on the app pool; every filter value is a bound parameter. */
export const PAGE_SIZE = 50;

export type RunIndexRow = {
  id: string; created_at: Date; question: string; role: string | null; name: string | null; source: "chat" | "eval"; status: string; path: string | null;
  attempt: number; latency_ms: number | null; total_tokens: number | null; cost_usd: number | null; rounds: number; prompt_kept: boolean; git_sha: string | null; error: string | null;
};
export type CallIndexRow = {
  id: number; created_at: Date; node: string; model: string; prompt_tokens: number; completion_tokens: number; cache_read_tokens: number; latency_ms: number;
  stop_reason: string | null; error: string | null; run_id: string; question: string;
};
export type Page<T> = { rows: T[]; next: string | null };

/** A WHERE clause from a fixed list of fragments; values only ever travel as $n parameters. */
class Where {
  readonly clauses: string[] = [];
  readonly params: unknown[] = [];
  add(fragment: (n: number) => string, value: unknown): void { this.params.push(value); this.clauses.push(fragment(this.params.length)); }
  raw(fragment: string): void { this.clauses.push(fragment); }
  get sql(): string { return this.clauses.length ? `WHERE ${this.clauses.join("\n  AND ")}` : ""; }
}

function page<T>(rows: T[], key: (r: T) => string): Page<T> {
  const more = rows.length > PAGE_SIZE;
  const shown = more ? rows.slice(0, PAGE_SIZE) : rows;
  return { rows: shown, next: more ? key(shown[shown.length - 1]!) : null };
}

function dateClauses(w: Where, column: string, from?: string, to?: string): void {
  const b = utcBounds(from, to);
  if (b.from) w.add((n) => `${column} >= $${n}::timestamptz`, b.from);
  if (b.to) w.add((n) => `${column} < $${n}::timestamptz`, b.to);
}

export async function listRuns(f: RunFilters, cursor?: string): Promise<Page<RunIndexRow>> {
  const w = new Where();
  if (f.status) w.add((n) => `r.status = $${n}::ops.run_status`, f.status);
  if (f.role) w.add((n) => `r.persona->>'role' = $${n}`, f.role);
  if (f.source === "chat") w.raw("r.thread_id NOT LIKE 'eval-%'");
  if (f.source === "eval") w.raw("r.thread_id LIKE 'eval-%'");
  if (f.path) w.add((n) => `r.path = $${n}::ops.run_path`, f.path);
  if (f.sha) w.add((n) => `r.git_sha LIKE $${n} || '%'`, f.sha);
  dateClauses(w, "r.created_at", f.from, f.to);
  if (f.q) w.add((n) => `r.question ILIKE $${n}`, `%${escapeLike(f.q)}%`);
  if (f.error) w.raw("r.error IS NOT NULL");
  // Keyset: the cursor row's own timestamp and id, looked up in SQL so a JS Date never truncates the microseconds.
  if (cursor) w.add((n) => `(r.created_at, r.id) < (SELECT k.created_at, k.id FROM ops.runs k WHERE k.id = $${n}::uuid)`, cursor);
  const sql = `
    SELECT r.id, r.created_at, r.question, r.persona->>'role' AS role, split_part(r.persona->>'scope_summary', ',', 1) AS name,
           CASE WHEN r.thread_id LIKE 'eval-%' THEN 'eval' ELSE 'chat' END AS source, r.status::text AS status, r.path::text AS path,
           r.attempt, r.latency_ms, r.total_tokens, r.cost_usd, x.rounds, x.prompt_kept, r.git_sha, r.error
    FROM ops.runs r
    LEFT JOIN LATERAL (SELECT count(*)::int AS rounds, coalesce(bool_or(l.request IS NOT NULL), false) AS prompt_kept FROM ops.llm_calls l WHERE l.run_id = r.id) x ON true
    ${w.sql}
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${PAGE_SIZE + 1}`;
  const rows = (await getAppPool().query(sql, w.params)).rows as RunIndexRow[];
  return page(rows, (r) => r.id);
}

export async function listCalls(f: CallFilters, cursor?: string): Promise<Page<CallIndexRow>> {
  const w = new Where();
  if (f.node) w.add((n) => `c.node = $${n}`, f.node);
  if (f.model) w.add((n) => `c.model = $${n}`, f.model);
  if (f.error) w.raw("c.error IS NOT NULL");
  dateClauses(w, "c.created_at", f.from, f.to);
  if (f.sha) w.add((n) => `c.git_sha LIKE $${n} || '%'`, f.sha);
  if (f.run) w.add((n) => `c.run_id = $${n}::uuid`, f.run);
  if (cursor) w.add((n) => `(c.created_at, c.id) < (SELECT k.created_at, k.id FROM ops.llm_calls k WHERE k.id = $${n}::bigint)`, cursor);
  const sql = `
    SELECT c.id, c.created_at, c.node, c.model, c.prompt_tokens, c.completion_tokens, c.cache_read_tokens, c.latency_ms, c.stop_reason, c.error, c.run_id, r.question
    FROM ops.llm_calls c
    JOIN ops.runs r ON r.id = c.run_id
    ${w.sql}
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ${PAGE_SIZE + 1}`;
  const rows = (await getAppPool().query(sql, w.params)).rows as CallIndexRow[];
  return page(rows, (r) => String(r.id));
}

/** The node and model values that exist, for the selects. */
export async function callOptions(): Promise<{ nodes: string[]; models: string[] }> {
  const pool = getAppPool();
  const [nodes, models] = await Promise.all([
    pool.query("SELECT DISTINCT node FROM ops.llm_calls ORDER BY 1"),
    pool.query("SELECT DISTINCT model FROM ops.llm_calls ORDER BY 1"),
  ]);
  return { nodes: nodes.rows.map((r) => String(r["node"])), models: models.rows.map((r) => String(r["model"])) };
}
