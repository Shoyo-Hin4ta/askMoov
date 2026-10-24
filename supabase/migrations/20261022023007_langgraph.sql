-- LangGraph PostgresSaver tables (design doc 6.2, 006_langgraph), schema "langgraph".
-- Final state of @langchain/langgraph-checkpoint-postgres migrations v0..v5, committed here so migrations are the source of truth.
-- PostgresSaver.setup() sees every version recorded and does nothing.

create schema langgraph;

create table langgraph.checkpoint_migrations (
  v integer primary key
);

create table langgraph.checkpoints (
  thread_id text not null,
  checkpoint_ns text not null default '',
  checkpoint_id text not null,
  parent_checkpoint_id text,
  type text,
  checkpoint jsonb not null,
  metadata jsonb not null default '{}',
  primary key (thread_id, checkpoint_ns, checkpoint_id)
);

create table langgraph.checkpoint_blobs (
  thread_id text not null,
  checkpoint_ns text not null default '',
  channel text not null,
  version text not null,
  type text not null,
  blob bytea,
  primary key (thread_id, checkpoint_ns, channel, version)
);

create table langgraph.checkpoint_writes (
  thread_id text not null,
  checkpoint_ns text not null default '',
  checkpoint_id text not null,
  task_id text not null,
  idx integer not null,
  channel text not null,
  type text,
  blob bytea not null,
  task_path text not null default '',
  primary key (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

insert into langgraph.checkpoint_migrations (v) values (0), (1), (2), (3), (4), (5);
