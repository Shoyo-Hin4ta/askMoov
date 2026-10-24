-- The earlier run_output migration was recorded with an empty body (file created before its SQL was written). This is its content.
-- Full answer per run for the UI: answer text, viz spec, caveats, per-step SQL and shape. Rows stay in run_results.

create table if not exists ops.run_output (
  run_id uuid primary key references ops.runs (id) on delete cascade,
  answer_md text not null,
  viz jsonb,
  caveats jsonb not null default '[]',
  steps jsonb not null default '[]',
  plan jsonb,
  created_at timestamptz not null default now()
);
grant all on ops.run_output to ask_moov_app;

create or replace function ops.retention() returns void
language sql security definer set search_path = ''
as $$
  delete from ops.run_results where created_at < now() - interval '30 days';
  delete from ops.run_output where created_at < now() - interval '30 days';
  delete from ops.tool_calls where created_at < now() - interval '30 days';
  update ops.llm_calls set response_excerpt = null where created_at < now() - interval '30 days' and response_excerpt is not null;
$$;
