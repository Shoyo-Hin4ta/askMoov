import type { Persona, Pin } from "@ask-moov/shared";
import { getAppPool } from "./pools";

/** Every read and write of the ops schema. One file, plain SQL, app pool. Used by the runtime, the routes and the eval runner. */

/** USD per million tokens. Source: claude-api skill model table (2026-10). Cache reads bill at 0.05x input. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export function costUsd(model: string, t: { prompt_tokens: number; completion_tokens: number; cache_read_tokens: number }): number {
  const p = PRICES[model];
  if (!p) return 0;
  const uncached = Math.max(0, t.prompt_tokens - t.cache_read_tokens);
  return (uncached * p.input + t.cache_read_tokens * p.cacheRead + t.completion_tokens * p.output) / 1_000_000;
}

/** One row of ops.llm_calls, as the agent's LLM wrapper reports it. Declared here so db does not depend on agent. */
export type LlmCallRecord = {
  node: string; model: string; prompt_tokens: number; completion_tokens: number; cache_read_tokens: number;
  latency_ms: number; response_excerpt: string; error: string | null;
};

export type RunRow = {
  id: string; thread_id: string; persona: Persona; question: string;
  status: "queued" | "running" | "succeeded" | "failed"; current_node: string | null; attempt: number;
  error: string | null; created_at: string; episode_id: number | null;
  /** Entities the user chose by clicking a clarification chip, by id. */
  pins: Pin[];
};

const pool = () => getAppPool();

export async function enqueueRun(r: { id: string; thread_id: string; persona: Persona; question: string; git_sha: string; pins?: Pin[] }): Promise<"inserted" | "duplicate"> {
  const res = await pool().query(
    "INSERT INTO ops.runs (id, thread_id, persona, question, status, git_sha, pins) VALUES ($1, $2, $3, $4, 'queued', $5, $6) ON CONFLICT (id) DO NOTHING",
    [r.id, r.thread_id, JSON.stringify(r.persona), r.question, r.git_sha, JSON.stringify(r.pins ?? [])],
  );
  return res.rowCount ? "inserted" : "duplicate";
}

/**
 * Tokens used this calendar month (UTC), as the monthly budget counts them: every model call the wrapper recorded,
 * prompt (input, cache reads and cache writes) plus completion, including runs still in flight and runs that died
 * before finishRun. runs.total_tokens is written only at the end of a run and would miss both.
 */
export async function monthTokens(): Promise<number> {
  const r = await pool().query("SELECT coalesce(sum(prompt_tokens + completion_tokens), 0)::bigint AS n FROM ops.llm_calls WHERE created_at >= date_trunc('month', now())");
  return Number(r.rows[0]?.["n"] ?? 0);
}

/** Runs of one thread, oldest first, for reopening it in the UI. Scoped to the persona so a guessed thread id shows nothing. */
export async function listThreadRuns(threadId: string, persona: Persona): Promise<{ id: string; question: string; status: RunRow["status"]; pins: Pin[] }[]> {
  const r = await pool().query(
    "SELECT id, question, status, pins FROM ops.runs WHERE thread_id = $1 AND (persona->>'user_id')::int = $2 ORDER BY created_at",
    [threadId, persona.user_id],
  );
  return r.rows as { id: string; question: string; status: RunRow["status"]; pins: Pin[] }[];
}

/** The concurrency lock. No row back means another invocation has it. */
export async function claimRun(id: string): Promise<RunRow | null> {
  const r = await pool().query(
    "UPDATE ops.runs SET status = 'running', claimed_at = now(), heartbeat_at = now(), started_at = coalesce(started_at, now()), attempt = attempt + 1 WHERE id = $1 AND status = 'queued' RETURNING *",
    [id],
  );
  return (r.rows[0] as RunRow | undefined) ?? null;
}

/**
 * Lease renewal. Only the worker that holds the claim (the run still running, on the attempt it claimed) can renew it.
 * A worker whose run the cron requeued and another invocation re-claimed learns the lease is lost instead of writing over the new owner's beats.
 */
export async function heartbeat(id: string, attempt: number): Promise<"renewed" | "lost"> {
  const r = await pool().query("UPDATE ops.runs SET heartbeat_at = now() WHERE id = $1 AND status = 'running' AND attempt = $2", [id, attempt]);
  return r.rowCount ? "renewed" : "lost";
}

/** Tokens the run has spent so far, every attempt included. Seeds the per-run cap when a later attempt resumes the run. */
export async function runTokensUsed(id: string): Promise<number> {
  const r = await pool().query("SELECT coalesce(sum(prompt_tokens + completion_tokens), 0)::bigint AS n FROM ops.llm_calls WHERE run_id = $1", [id]);
  return Number(r.rows[0]?.["n"] ?? 0);
}

/** Progress for the UI: the node that just finished. Liveness is heartbeat(), on its own timer. */
export async function setCurrentNode(id: string, node: string): Promise<void> {
  await pool().query("UPDATE ops.runs SET current_node = $2 WHERE id = $1", [id, node]);
}

export async function requeueRun(id: string, error: string): Promise<void> {
  await pool().query("UPDATE ops.runs SET status = 'queued', queued_at = now(), error = $2 WHERE id = $1", [id, error]);
}

export async function finishRun(id: string, f: {
  status: "succeeded" | "failed"; error: string | null; latency_ms: number; path: string | null; uncertain: boolean;
  metrics: string[]; answer_excerpt: string | null; episode_id: number | null; schema_version: string;
}): Promise<void> {
  const usage = await pool().query("SELECT model, sum(prompt_tokens) p, sum(completion_tokens) c, sum(cache_read_tokens) r FROM ops.llm_calls WHERE run_id = $1 GROUP BY model", [id]);
  let tokens = 0, cost = 0;
  for (const u of usage.rows) {
    const t = { prompt_tokens: Number(u["p"]), completion_tokens: Number(u["c"]), cache_read_tokens: Number(u["r"]) };
    tokens += t.prompt_tokens + t.completion_tokens;
    cost += costUsd(String(u["model"]), t);
  }
  await pool().query(
    `UPDATE ops.runs SET status = $2, error = $3, finished_at = now(), latency_ms = $4, total_tokens = $5, cost_usd = $6, path = $7, uncertain = $8,
       metrics = $9, answer_excerpt = $10, episode_id = $11, schema_version = $12, current_node = NULL WHERE id = $1`,
    [id, f.status, f.error, f.latency_ms, tokens, cost.toFixed(6), f.path, f.uncertain, f.metrics, f.answer_excerpt, f.episode_id, f.schema_version],
  );
}

export async function insertStep(r: { run_id: string; node: string; attempt: number; started_at: Date; duration_ms: number; input_summary: unknown; output_summary: unknown; error: string | null }): Promise<void> {
  await pool().query(
    "INSERT INTO ops.run_steps (run_id, node, attempt, started_at, duration_ms, input_summary, output_summary, error) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [r.run_id, r.node, r.attempt, r.started_at, r.duration_ms, JSON.stringify(r.input_summary ?? null), JSON.stringify(r.output_summary ?? null), r.error],
  );
}

export async function insertLlmCall(runId: string, r: LlmCallRecord, gitSha: string): Promise<void> {
  await pool().query(
    "INSERT INTO ops.llm_calls (run_id, node, model, prompt_tokens, completion_tokens, cache_read_tokens, latency_ms, git_sha, response_excerpt, error) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [runId, r.node, r.model, r.prompt_tokens, r.completion_tokens, r.cache_read_tokens, r.latency_ms, gitSha, r.response_excerpt, r.error],
  );
}

export async function insertToolCall(r: { run_id: string; node: string; tool: string; args: unknown; result: unknown; duration_ms: number }): Promise<void> {
  await pool().query(
    "INSERT INTO ops.tool_calls (run_id, node, tool, args, result, duration_ms) VALUES ($1, $2, $3, $4, $5, $6)",
    [r.run_id, r.node, r.tool, JSON.stringify(r.args ?? null), JSON.stringify(r.result ?? null), r.duration_ms],
  );
}

export async function putResult(runId: string, stepId: string, columns: string[], rows: Record<string, unknown>[]): Promise<void> {
  const capped = rows.slice(0, 500);
  await pool().query(
    "INSERT INTO ops.run_results (run_id, step_id, columns, row_count, rows) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (run_id, step_id) DO UPDATE SET columns = EXCLUDED.columns, row_count = EXCLUDED.row_count, rows = EXCLUDED.rows",
    [runId, stepId, JSON.stringify(columns), rows.length, JSON.stringify(capped)],
  );
}

export async function getResult(runId: string, stepId: string): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
  const r = await pool().query("SELECT columns, rows FROM ops.run_results WHERE run_id = $1 AND step_id = $2", [runId, stepId]);
  const row = r.rows[0];
  return row ? { columns: row["columns"] as string[], rows: row["rows"] as Record<string, unknown>[] } : { columns: [], rows: [] };
}

export async function insertRunEntities(runId: string, entities: { type: string; id: number | string }[]): Promise<void> {
  for (const e of entities) {
    await pool().query("INSERT INTO ops.run_entities (run_id, entity_type, entity_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [runId, e.type, String(e.id)]);
  }
}

export async function saveOutput(runId: string, o: { answer_md: string; viz: unknown; caveats: unknown; steps: unknown; plan: unknown }): Promise<void> {
  await pool().query(
    "INSERT INTO ops.run_output (run_id, answer_md, viz, caveats, steps, plan) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (run_id) DO UPDATE SET answer_md = EXCLUDED.answer_md, viz = EXCLUDED.viz, caveats = EXCLUDED.caveats, steps = EXCLUDED.steps, plan = EXCLUDED.plan",
    [runId, o.answer_md, JSON.stringify(o.viz ?? null), JSON.stringify(o.caveats ?? []), JSON.stringify(o.steps ?? []), JSON.stringify(o.plan ?? null)],
  );
}

export async function getRun(id: string): Promise<RunRow | null> {
  const r = await pool().query("SELECT * FROM ops.runs WHERE id = $1", [id]);
  return (r.rows[0] as RunRow | undefined) ?? null;
}

/** What the UI polls: status, the node trail so far, and when done, the full output with rows per step. */
export async function getRunView(id: string): Promise<Record<string, unknown> | null> {
  const run = await getRun(id);
  if (!run) return null;
  const steps = await pool().query("SELECT node, attempt, started_at, duration_ms, error FROM ops.run_steps WHERE run_id = $1 ORDER BY started_at", [id]);
  const view: Record<string, unknown> = {
    id: run.id, thread_id: run.thread_id, status: run.status, current_node: run.current_node, attempt: run.attempt, error: run.error, question: run.question,
    trail: steps.rows,
  };
  if (run.status === "succeeded") {
    const out = await pool().query("SELECT answer_md, viz, caveats, steps, plan FROM ops.run_output WHERE run_id = $1", [id]);
    const o = out.rows[0];
    if (o) {
      const results = await pool().query("SELECT step_id, columns, row_count, rows FROM ops.run_results WHERE run_id = $1", [id]);
      view["output"] = { ...o, results: Object.fromEntries(results.rows.map((r) => [r["step_id"], { columns: r["columns"], row_count: r["row_count"], rows: r["rows"] }])) };
    }
  }
  return view;
}

export async function listThreads(persona: Persona): Promise<{ thread_id: string; first_question: string; last_asked_at: string; runs: number }[]> {
  const r = await pool().query(
    `SELECT thread_id, (array_agg(question ORDER BY created_at))[1] AS first_question, max(created_at) AS last_asked_at, count(*)::int AS runs
     FROM ops.runs WHERE (persona->>'user_id')::int = $1 AND thread_id NOT LIKE 'eval-%' GROUP BY thread_id ORDER BY max(created_at) DESC LIMIT 50`,
    [persona.user_id],
  );
  return r.rows as { thread_id: string; first_question: string; last_asked_at: string; runs: number }[];
}
