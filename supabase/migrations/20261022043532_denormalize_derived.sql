-- 1. The app role runs the episode trigram fill (memory.episodes) and never had usage on the schema pg_trgm lives in.
grant usage on schema extensions to ask_moov_app;

-- 2. Views over big derived tables must not join tiny RLS-protected lookup tables: the planner estimates them at one row,
--    picks a nested loop with a join filter, and a school-wide presence count took 62 s. Carry the few lookup columns
--    in the derived rows instead; the views become plain selects with the same columns as before.
alter table public.presence_events
  add column location text,
  add column location_kind text,
  add column device_type text,
  add column next_location text;

create table public.entry_events (
  id bigint generated always as identity primary key,
  school_id int not null references public.schools (id),
  student_id int not null references public.students (id),
  ts timestamptz not null,
  result text not null check (result in ('authorized', 'blocked', 'no_card')),
  device_id int not null references public.devices (id),
  location_id int not null references public.rooms (id),
  minutes_after_bell int not null,
  tardy boolean not null
);
create index entry_student_ts on public.entry_events (student_id, ts);
create index entry_school_ts on public.entry_events (school_id, ts);
comment on table public.entry_events is 'One row per entrance kiosk tap, derived from taps with the first bell applied. tardy = more than 5 minutes after first bell.';

alter table public.entry_events enable row level security;
create policy entry_teacher on public.entry_events for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'teacher' and student_id in (select analytics.my_student_ids()));
create policy entry_admin on public.entry_events for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'admin' and school_id = (select nullif(current_setting('app.school_id', true), '')::int));
create policy entry_super on public.entry_events for select to ask_moov_query using ((select current_setting('app.role', true)) = 'super_admin');
grant select on public.entry_events to ask_moov_query;

create or replace view analytics.v_presence with (security_invoker = true) as
select school_id, student_id, location_id, location, location_kind, device_type, arrived_at, left_by, left_by_kind, next_location
from public.presence_events;
comment on view analytics.v_presence is 'One row per arrival. left_by is when the student is next seen somewhere else. left_by_kind says how: exit_tap and pass_tap_out are measured departures; next_arrival and end_of_day are inferred, so left_by is an upper bound on time at this location, not a measurement. left_by is null when the student has not been seen elsewhere yet today. Hallway handheld checks are not arrivals.';

create or replace view analytics.v_entry with (security_invoker = true) as
select school_id, student_id, ts, result, device_id, location_id, minutes_after_bell, tardy
from public.entry_events;
comment on view analytics.v_entry is 'One row per entrance kiosk tap. tardy = more than 5 minutes after first bell. result no_card means the student arrived without a working card.';
