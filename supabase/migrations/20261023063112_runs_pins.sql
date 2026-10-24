-- Clarification chips carry the chosen entity by id (design 13.5: "clicking one sends the chosen entity ... so it gets pinned").
-- Until now the click sent only the chip's text and the planner re-ran the lookup to rediscover the id the user had just chosen.
-- The pin travels with the run and is seeded into the thread's pinned entities before the planner runs.
alter table ops.runs add column pins jsonb not null default '[]'::jsonb;
comment on column ops.runs.pins is 'Entities the user chose by clicking a clarification chip: [{type, id, label, detail}]. Pinned before the planner runs, so no lookup re-decides them.';
