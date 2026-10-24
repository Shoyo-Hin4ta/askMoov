-- Thread-memory retention (design 9.1 retention, 11.1 thread memory).
-- langgraph.* rows carry no timestamp of their own; a thread's age is the age of its latest run in ops.runs.
-- A thread with no question in 30 days loses its memory (pins and turns), and a thread that has checkpoints but no run at
-- all (a test that removed its own run row, an enqueue that never ran) goes with it. Until today nothing ever deleted a
-- checkpoint: 2313 of them across 304 threads, 26 MB, after two days.
-- One statement: data-modifying CTEs share a snapshot, so the stale set is computed once and all three tables are cleared from it.

create or replace function ops.retention() returns void
language sql security definer set search_path = ''
as $$
  delete from ops.run_results where created_at < now() - interval '30 days';
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
comment on function ops.retention() is 'Nightly (cron 03:17 UTC). Trace rows that can hold names or result rows expire after 30 days; so does the thread memory of a thread with no question in 30 days.';
