-- Keep the chat history (Ritik, 2026-10-26). A conversation stays reopenable for good: its answers, result rows, tool
-- calls and thread memory (pins and turns) never expire. Two things still expire. The full text of every model round
-- (llm_calls.request/response and the prompt blocks nothing references) goes after 7 days; the metrics stay. Eval
-- threads lose their thread memory a day after their run: they are single-question runs nobody reopens, and their
-- checkpoints held 48 MB of a 500 MB free-plan quota. A thread with checkpoints but no run row at all (a test leftover;
-- the app inserts the run before the graph writes a checkpoint) goes too. Before this, rows that could hold names or
-- result rows expired after 30 days, and so did the thread memory of any thread idle for 30 days.

create or replace function ops.retention() returns void
language sql security definer set search_path = ''
as $$
  update ops.llm_calls set request = null, response = null where created_at < now() - interval '7 days' and (request is not null or response is not null);
  delete from ops.prompt_blocks b where not exists (
    select 1 from ops.llm_calls l where l.created_at >= now() - interval '7 days' and b.hash = any (l.block_hashes));
  with stale as (
    select c.thread_id
    from langgraph.checkpoints c
    group by c.thread_id
    having (c.thread_id like 'eval-%' and coalesce((select max(r.created_at) from ops.runs r where r.thread_id = c.thread_id), '-infinity'::timestamptz) < now() - interval '1 day')
        or not exists (select 1 from ops.runs r where r.thread_id = c.thread_id)
  ),
  writes as (delete from langgraph.checkpoint_writes x using stale s where x.thread_id = s.thread_id),
  blobs as (delete from langgraph.checkpoint_blobs x using stale s where x.thread_id = s.thread_id)
  delete from langgraph.checkpoints x using stale s where x.thread_id = s.thread_id;
$$;
comment on function ops.retention() is 'Nightly (cron 03:17 UTC). Chats are kept: answers, result rows, tool calls and thread memory never expire. Model-call transcripts (llm_calls.request/response, unreferenced prompt_blocks) expire after 7 days. Eval threads lose their thread memory a day after their run; a thread with no run row at all loses it too.';
