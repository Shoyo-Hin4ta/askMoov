-- Full transcripts per model round (design 9.1 made the excerpt a v1 privacy choice; a production trace needs the whole thing).
-- 1. ops.prompt_blocks: the large system blocks (rules, schema document, registry) are identical across thousands of rounds and
--    are stored once by content hash; a round references them by hash and inlines only its small dynamic blocks.
-- 2. ops.llm_calls gains the request as sent (system blocks by hash or text, the messages, model parameters), the full response
--    content, the stop reason, and the list of block hashes the round used (for pruning).
-- 3. Retention: request and response text expire after 7 days (the metrics stay); a prompt block nobody referenced in 7 days is dropped.

create table ops.prompt_blocks (
  hash text primary key,
  text text not null,
  bytes int not null,
  first_seen timestamptz not null default now()
);
comment on table ops.prompt_blocks is 'Large prompt blocks stored once by sha256 of their text. ops.llm_calls.request references them by hash.';
grant select, insert on ops.prompt_blocks to ask_moov_app;
grant delete on ops.prompt_blocks to ask_moov_app;

alter table ops.llm_calls
  add column request jsonb,
  add column response jsonb,
  add column stop_reason text,
  add column block_hashes text[] not null default '{}';
comment on column ops.llm_calls.request is 'What was sent: {model, max_tokens, effort, format, tools, system: [{hash, bytes} | {text}], messages}. Null after 7 days.';
comment on column ops.llm_calls.response is 'The full content array the model returned (text and tool_use blocks). Null after 7 days.';
comment on column ops.llm_calls.block_hashes is 'Hashes of the ops.prompt_blocks rows this round referenced; retention prunes blocks nobody referenced in 7 days.';
create index llm_calls_block_hashes on ops.llm_calls using gin (block_hashes);

create or replace function ops.retention() returns void
language sql security definer set search_path = ''
as $$
  delete from ops.run_results where created_at < now() - interval '30 days';
  delete from ops.run_output where created_at < now() - interval '30 days';
  delete from ops.tool_calls where created_at < now() - interval '30 days';
  update ops.llm_calls set response_excerpt = null where created_at < now() - interval '30 days' and response_excerpt is not null;
  update ops.llm_calls set request = null, response = null where created_at < now() - interval '7 days' and (request is not null or response is not null);
  delete from ops.prompt_blocks b where not exists (
    select 1 from ops.llm_calls l where l.created_at >= now() - interval '7 days' and b.hash = any (l.block_hashes));
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
comment on function ops.retention() is 'Nightly (cron 03:17 UTC). Transcripts (llm_calls.request/response, unreferenced prompt_blocks) expire after 7 days; rows that can hold names or result rows (run_results, run_output, tool_calls, llm_calls excerpts) after 30; so does the thread memory of a thread with no question in 30 days.';
