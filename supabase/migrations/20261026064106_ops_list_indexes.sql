-- The run and model-call lists on /ops (/ops/runs and /ops/calls): newest first, paged by (created_at, id).
-- Both tables grow without bound: ops.retention clears transcript text after 7 days but keeps every row for the metrics
-- (2026-10-26: 830 runs, 3,815 model calls, about 5 calls per question; database 404 MB of the 500 MB quota, these add
-- well under 1 MB).
create index if not exists runs_created on ops.runs (created_at desc, id desc);
create index if not exists llm_calls_created on ops.llm_calls (created_at desc, id desc);
