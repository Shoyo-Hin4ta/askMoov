-- 1. Names for the id columns of a run's result rows, resolved by code through analytics.v_entities as the asking persona when
--    the run completes (row-level security on that view scopes what a persona may name). The analytics views carry ids only.
alter table ops.run_output add column labels jsonb not null default '{}'::jsonb;
comment on column ops.run_output.labels is 'Names for the id columns of the result rows, {column: {id: label}}, resolved through analytics.v_entities as the asking persona when the run completed.';

-- 2. Retention: 20261024004030_checkpoint_retention rewrote ops.retention() from the first version of the function and dropped
--    the run_output expiry that 20261022044224_run_output_table had added. Answer text can hold names, so it expires with the
--    other trace rows. Everything else is unchanged from the previous definition.
create or replace function ops.retention() returns void
language sql security definer set search_path = ''
as $$
  delete from ops.run_results where created_at < now() - interval '30 days';
  delete from ops.run_output where created_at < now() - interval '30 days';
  delete from ops.tool_calls where created_at < now() - interval '30 days';
  update ops.llm_calls set response_excerpt = null where created_at < now() - interval '30 days' and response_excerpt is not null;
  with stale as (
    select c.thread_id
    from langgraph.checkpoints c
    group by c.thread_id
    having coalesce((select max(r.created_at) from ops.runs r where r.thread_id = c.thread_id), '-infinity'::timestamptz) < now() - interval '30 days'
  ),
  writes as (delete from langgraph.checkpoint_writes x using stale s where x.thread_id = s.thread_id),
  blobs as (delete from langgraph.checkpoint_blobs x using stale s where x.thread_id = s.thread_id)
  delete from langgraph.checkpoints x using stale s where x.thread_id = s.thread_id;
$$;
comment on function ops.retention() is 'Nightly (cron 03:17 UTC). Trace rows that can hold names or result rows expire after 30 days (run_results, run_output, tool_calls, llm_calls excerpts); so does the thread memory of a thread with no question in 30 days.';
