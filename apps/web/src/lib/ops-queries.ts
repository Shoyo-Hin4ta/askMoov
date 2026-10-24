import { getAppPool } from "@ask-moov/db";

/** The /ops queries from design doc 9.2, one SQL string each. Read-only on the app pool. */
export type Layout = "stats" | "table";
export type Table = { title: string; layout: Layout; rows: Record<string, unknown>[] };

const Q: Record<string, { layout: Layout; sql: string }> = {
  "Latency, last 7 days, by path (ms)": { layout: "table", sql: `
    select coalesce(path::text, 'none') as path, count(*)::int as runs,
           percentile_cont(0.5) within group (order by latency_ms)::int as p50,
           percentile_cont(0.95) within group (order by latency_ms)::int as p95
    from ops.runs where finished_at >= now() - interval '7 days' and status = 'succeeded' group by 1 order by 1` },
  "Rates, last 7 days": { layout: "stats", sql: `
    with r as (select id, path, uncertain, status from ops.runs where created_at >= now() - interval '7 days')
    select count(*)::int as runs,
           round(100.0 * count(*) filter (where status = 'failed') / nullif(count(*), 0), 1) as fail_pct,
           round(100.0 * count(*) filter (where path = 'generated') / nullif(count(*), 0), 1) as tier3_pct,
           round(100.0 * count(*) filter (where uncertain) / nullif(count(*), 0), 1) as uncertain_pct,
           round(100.0 * count(*) filter (where (select count(*) from ops.run_steps s where s.run_id = r.id and s.node = 'plan' and s.error is null) > 1) / nullif(count(*), 0), 1) as replan_pct
    from r` },
  "Cost and tokens": { layout: "table", sql: `
    select date_trunc('day', created_at)::date as day, count(*)::int as runs,
           round(avg(total_tokens))::int as tokens_per_run, round(avg(cost_usd)::numeric, 4) as usd_per_run, round(sum(cost_usd)::numeric, 2) as usd_total
    from ops.runs where created_at >= now() - interval '7 days' group by 1 order by 1 desc` },
  "Cache hit ratio and month-to-date tokens": { layout: "stats", sql: `
    select round(100.0 * sum(cache_read_tokens) / nullif(sum(prompt_tokens), 0), 1) as cache_hit_pct,
           (select coalesce(sum(prompt_tokens + completion_tokens), 0) from ops.llm_calls where created_at >= date_trunc('month', now()))::bigint as month_tokens,
           (select count(*) from ops.runs where status = 'queued' and queued_at < now() - interval '1 minute')::int as stale_queued
    from ops.llm_calls where created_at >= now() - interval '7 days'` },
  "Failures by node, last 7 days": { layout: "table", sql: `
    select node, count(*)::int as failures from ops.run_steps where error is not null and started_at >= now() - interval '7 days' group by 1 order by 2 desc` },
  "Last 20 failed runs": { layout: "table", sql: `
    select created_at, left(question, 60) as question, attempt, left(error, 120) as error from ops.runs where status = 'failed' order by created_at desc limit 20` },
  "Top questions": { layout: "table", sql: `
    select lower(question) as question, count(*)::int as n from ops.runs group by 1 order by 2 desc, 1 limit 20` },
  "Running now": { layout: "table", sql: `
    select id, current_node, attempt, extract(epoch from (now() - heartbeat_at))::int as heartbeat_age_s from ops.runs where status = 'running' order by heartbeat_at` },
  "Episodes": { layout: "stats", sql: `
    select (select count(*) from memory.episodes)::int as stored,
           (select count(*) from memory.episodes where score >= 0)::int as retrievable,
           (select round(100.0 * count(*) filter (where (output_summary->>'episodes')::int > 0) / nullif(count(*), 0), 1)
              from ops.run_steps where node = 'plan' and started_at >= now() - interval '7 days') as retrieval_hit_pct,
           (select count(*) from memory.episode_feedback where created_at >= now() - interval '7 days')::int as votes_7d` },
  "Episode score distribution": { layout: "table", sql: `
    select score, count(*)::int as n from memory.episodes group by 1 order by 1` },
  "Runs by git sha": { layout: "table", sql: `
    select left(git_sha, 8) as sha, count(*)::int as runs, round(100.0 * count(*) filter (where status = 'failed') / nullif(count(*), 0), 1) as fail_pct,
           percentile_cont(0.5) within group (order by latency_ms)::int as p50_ms
    from ops.runs group by 1 order by max(created_at) desc limit 10` },
};

export async function opsTables(): Promise<Table[]> {
  const pool = getAppPool();
  const out: Table[] = [];
  for (const [title, { layout, sql }] of Object.entries(Q)) {
    const r = await pool.query(sql);
    out.push({ title, layout, rows: r.rows });
  }
  return out;
}
