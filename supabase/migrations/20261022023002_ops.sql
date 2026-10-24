-- Ask MOOV ops schema (design doc 6.2, 004_ops): the queue and the trace.

create schema ops;

create type ops.run_status as enum ('queued', 'running', 'succeeded', 'failed');
create type ops.run_path as enum ('compiled', 'composed', 'generated');

create table ops.runs (
  id uuid primary key,
  thread_id text not null,
  persona jsonb not null,
  question text not null,
  status ops.run_status not null default 'queued',
  current_node text,
  attempt int not null default 0,
  path ops.run_path,
  queued_at timestamptz not null default now(),
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  latency_ms int,
  total_tokens int not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  schema_version text,
  git_sha text,
  uncertain boolean not null default false,
  error text,
  metrics text[] not null default '{}',
  answer_excerpt text,
  episode_id bigint,
  created_at timestamptz not null default now()
);
create index runs_status_queued_at on ops.runs (status, queued_at);
create index runs_thread_created on ops.runs (thread_id, created_at);
create index runs_user_created on ops.runs (((persona ->> 'user_id')::int), created_at);

comment on table ops.runs is 'One row per question. The idempotency key is the client-generated id. status drives the queue: queued -> running -> succeeded | failed.';
comment on column ops.runs.path is 'compiled: one registry metric. composed: several metrics and/or calc. generated: at least one model-written SQL step.';

create table ops.run_steps (
  id bigint generated always as identity primary key,
  run_id uuid not null references ops.runs (id) on delete cascade,
  node text not null,
  step_id text,
  attempt int not null,
  started_at timestamptz not null,
  duration_ms int not null,
  input_summary jsonb,
  output_summary jsonb,
  error text
);
create index run_steps_run on ops.run_steps (run_id, started_at);

create table ops.run_results (
  run_id uuid not null references ops.runs (id) on delete cascade,
  step_id text not null,
  columns jsonb not null,
  row_count int not null,
  rows jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, step_id)
);

create table ops.run_entities (
  run_id uuid not null references ops.runs (id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  primary key (run_id, entity_type, entity_id)
);
create index run_entities_entity on ops.run_entities (entity_type, entity_id);

create table ops.llm_calls (
  id bigint generated always as identity primary key,
  run_id uuid not null references ops.runs (id) on delete cascade,
  node text not null,
  model text not null,
  prompt_tokens int not null,
  completion_tokens int not null,
  cache_read_tokens int not null,
  latency_ms int not null,
  git_sha text,
  response_excerpt text,
  error text,
  created_at timestamptz not null default now()
);
create index llm_calls_run on ops.llm_calls (run_id);

create table ops.tool_calls (
  id bigint generated always as identity primary key,
  run_id uuid not null references ops.runs (id) on delete cascade,
  node text not null,
  tool text not null,
  args jsonb,
  result jsonb,
  duration_ms int not null,
  created_at timestamptz not null default now()
);
create index tool_calls_run on ops.tool_calls (run_id);

create table ops.schema_meta (
  id boolean primary key default true check (id),
  schema_version text not null default '',
  loaded_at timestamptz not null default now(),
  frozen_now timestamptz not null
);
insert into ops.schema_meta (schema_version, frozen_now) values ('', '2026-10-13 10:40:00+00');
comment on column ops.schema_meta.frozen_now is '"Now" for the whole system. The seed is generated around it. Replace with now() when the data is live.';
