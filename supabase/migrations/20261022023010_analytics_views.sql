-- Ask MOOV analytics views (design doc 6.2, 002_analytics_views). Every query the agent runs reads these and nothing else.
-- All views are security_invoker: the base tables' RLS applies to whoever runs the query. That flag is the authorization story.

create schema analytics;

-- "Now" for the whole system. security definer so the query role can read ops.schema_meta through it without a grant.
create function analytics.frozen_now() returns timestamptz
language sql stable security definer set search_path = ''
as $$ select frozen_now from ops.schema_meta where id $$;

-- Scope helpers for RLS policies (design doc 8.2). security definer so policies do not recurse through RLS.
create function analytics.my_section_ids() returns setof int
language sql stable security definer set search_path = ''
as $$
  select id from public.sections
  where teacher_id = nullif(current_setting('app.user_id', true), '')::int
$$;

create function analytics.my_student_ids() returns setof int
language sql stable security definer set search_path = ''
as $$
  select r.student_id from public.rosters r
  join public.sections s on s.id = r.section_id
  where s.teacher_id = nullif(current_setting('app.user_id', true), '')::int
$$;

create view analytics.v_school_days with (security_invoker = true) as
select school_id, date, ab_day
from public.school_calendar
where is_school_day;
comment on view analytics.v_school_days is 'One row per school day. Used by resolve_dates to clip ranges to days with classes.';

create view analytics.v_section_roster with (security_invoker = true) as
select r.school_id, r.student_id, r.section_id, s.teacher_id, s.period, s.room_id, s.course
from public.rosters r
join public.sections s on s.id = r.section_id;
comment on view analytics.v_section_roster is 'student x section with the section''s teacher, period, room and course.';

create view analytics.v_attendance_daily with (security_invoker = true) as
select a.school_id, a.student_id, a.section_id, s.teacher_id, s.room_id, r.wing, s.period, a.date, c.ab_day, a.status, a.source
from public.attendance a
join public.sections s on s.id = a.section_id
join public.rooms r on r.id = s.room_id
left join public.school_calendar c on c.school_id = a.school_id and c.date = a.date;
comment on view analytics.v_attendance_daily is 'One row per student x section x school day (a scheduled meeting). status present/absent/tardy; attended = present or tardy.';
comment on column analytics.v_attendance_daily.source is 'tap = marked present by reader tap. manual = teacher changed the status when saving attendance. A manual absent after a tap means the teacher did not see the student in the room.';

create view analytics.v_entry with (security_invoker = true) as
select t.school_id, t.student_id, t.ts, t.result, t.device_id, t.location_id,
       round(extract(epoch from ((t.ts at time zone 'UTC')::time - b.starts_at)) / 60)::int as minutes_after_bell,
       ((t.ts at time zone 'UTC')::time > b.starts_at + interval '5 minutes') as tardy
from public.taps t
join public.devices d on d.id = t.device_id
join public.rooms r on r.id = t.location_id
join public.bell_schedule b on b.school_id = t.school_id and b.period = 1
where d.type = 'kiosk' and r.kind = 'entrance' and t.kind = 'arrival';
comment on view analytics.v_entry is 'One row per entrance kiosk tap. tardy = more than 5 minutes after first bell. result no_card means the student arrived without a working card.';

create view analytics.v_tardies with (security_invoker = true) as
select school_id, student_id, null::int as section_id, null::int as period, (ts at time zone 'UTC')::date as date, 'entry' as kind, minutes_after_bell as minutes_late, ts
from analytics.v_entry
where tardy and student_id is not null
union all
select a.school_id, a.student_id, a.section_id, s.period, a.date, 'period', null::int, null::timestamptz
from public.attendance a
join public.sections s on s.id = a.section_id
where a.status = 'tardy';
comment on view analytics.v_tardies is 'One row per tardy. kind entry = late to the building (kiosk after first bell + 5 min). kind period = marked tardy in a class.';

create view analytics.v_passes with (security_invoker = true) as
select p.school_id, p.student_id, p.section_id, p.origin_room_id, r.wing, p.destination, p.issuer, p.started_at, p.ended_at,
       round(extract(epoch from (coalesce(p.ended_at, analytics.frozen_now()) - p.started_at)) / 60.0, 1) as minutes,
       (extract(epoch from (coalesce(p.ended_at, analytics.frozen_now()) - p.started_at)) / 60.0) > 20 as over_limit,
       (select b.period from public.bell_schedule b where b.school_id = p.school_id and (p.started_at at time zone 'UTC')::time >= b.starts_at and (p.started_at at time zone 'UTC')::time < b.ends_at limit 1) as period,
       extract(isodow from p.started_at)::int as day_of_week,
       c.ab_day
from public.passes p
left join public.rooms r on r.id = p.origin_room_id
left join public.school_calendar c on c.school_id = p.school_id and c.date = (p.started_at at time zone 'UTC')::date;
comment on view analytics.v_passes is 'One row per hall pass. minutes runs to frozen now for a pass that has not ended (still out). over_limit = more than 20 minutes. Bathroom destination is assumed, not verified by a tap.';

create view analytics.v_presence with (security_invoker = true) as
with t as (
  select t.school_id, t.student_id, t.location_id, r.name as location, r.kind as location_kind, d.type as device_type, t.ts, t.kind,
         lead(t.ts) over w as next_ts, lead(t.kind) over w as next_kind, lead(r.name) over w as next_location
  from public.taps t
  join public.devices d on d.id = t.device_id
  join public.rooms r on r.id = t.location_id
  where t.student_id is not null and t.result = 'authorized'
  window w as (partition by t.student_id order by t.ts)
), bounds as (
  select school_id, max(ends_at) as day_end from public.bell_schedule group by school_id
)
select t.school_id, t.student_id, t.location_id, t.location, t.location_kind, t.device_type, t.ts as arrived_at,
       case
         when t.next_ts is not null and (t.next_ts at time zone 'UTC')::date = (t.ts at time zone 'UTC')::date then t.next_ts
         when (t.ts at time zone 'UTC')::date = (analytics.frozen_now() at time zone 'UTC')::date then null
         else ((t.ts at time zone 'UTC')::date + b.day_end) at time zone 'UTC'
       end as left_by,
       case
         when t.next_ts is null or (t.next_ts at time zone 'UTC')::date <> (t.ts at time zone 'UTC')::date then 'end_of_day'
         when t.next_kind = 'departure' then 'exit_tap'
         when t.next_kind = 'pass_start' then 'pass_tap_out'
         else 'next_arrival'
       end as left_by_kind,
       t.next_location
from t
join bounds b on b.school_id = t.school_id
where t.kind in ('arrival', 'pass_end', 'check');
comment on view analytics.v_presence is 'One row per arrival. left_by is when the student is next seen somewhere else. left_by_kind says how: exit_tap and pass_tap_out are measured departures; next_arrival and end_of_day are inferred, so left_by is an upper bound on time at this location, not a measurement. left_by is null when the student has not been seen elsewhere yet today.';

create view analytics.v_cards with (security_invoker = true) as
select c.school_id, c.student_id, c.id as card_id, c.type, c.status, c.issued_at,
       (select c2.type from public.cards c2 where c2.student_id = c.student_id and c2.status = 'active' order by c2.issued_at desc limit 1) as active_card_type,
       (select count(*) from public.cards c3 where c3.student_id = c.student_id and c3.type = 'temp' and c3.issued_at >= analytics.frozen_now() - interval '30 days')::int as temp_ids_issued_30d
from public.cards c;
comment on view analytics.v_cards is 'One row per card. active_card_type is the type of the student''s currently active card (only one card is active at a time; a temp ID deactivates the permanent one).';

create view analytics.v_device_uptime with (security_invoker = true) as
with hb as (
  select d.school_id, d.id as device_id, d.type as device_type, d.location_id as room_id, date_trunc('hour', h.ts) as hour,
         avg(case when h.online then 1.0 else 0.0 end) as online_ratio,
         (count(*) filter (where not h.online)) * 2 as offline_minutes
  from public.device_heartbeats h
  join public.devices d on d.id = h.device_id
  group by 1, 2, 3, 4, 5
), hours as (
  select school_id, min(starts_at) as day_start, max(ends_at) as day_end from public.bell_schedule group by school_id
)
select hb.school_id, hb.device_id, hb.device_type, hb.room_id, hb.hour, hb.online_ratio, hb.offline_minutes::int
from hb
join public.school_calendar c on c.school_id = hb.school_id and c.date = (hb.hour at time zone 'UTC')::date and c.is_school_day
join hours x on x.school_id = hb.school_id
where (hb.hour at time zone 'UTC')::time + interval '59 minutes' >= x.day_start and (hb.hour at time zone 'UTC')::time < x.day_end;
comment on view analytics.v_device_uptime is 'One row per device x school hour. online_ratio = heartbeats received / expected (one every 2 minutes). offline_minutes within that hour. A reader offline means taps in that window are missing, not absent.';

create view analytics.v_entities with (security_invoker = true) as
select school_id, 'student' as type, id::text as id, name as label, 'grade ' || grade as detail, grade, null::int as period, name as search from public.students
union all
select school_id, 'teacher', id::text, name, 'teacher', null::int, null::int, name from public.teachers
union all
select s.school_id, 'section', s.id::text, s.course || ', period ' || s.period || ' (' || t.name || ')', 'period ' || s.period || ', ' || t.name, null::int, s.period, s.course || ' ' || t.name
from public.sections s join public.teachers t on t.id = s.teacher_id
union all
select school_id, 'room', id::text, name, kind || coalesce(', ' || wing || ' wing', ''), null::int, null::int, name from public.rooms
union all
select distinct school_id, 'wing', wing, wing || ' wing', 'wing', null::int, null::int, wing from public.rooms where wing is not null;
comment on view analytics.v_entities is 'Everything lookup_entity can resolve a name to. Scope comes from RLS on the base tables: a teacher only sees students on their rosters.';

create view analytics.v_my_history with (security_invoker = true) as
select r.id as run_id, r.thread_id, r.created_at as asked_at, r.question, e.entity_type, e.entity_id, ent.label as entity_label, r.metrics, r.answer_excerpt,
       (r.persona ->> 'user_id')::int as user_id
from ops.runs r
left join ops.run_entities e on e.run_id = r.id
left join analytics.v_entities ent on ent.type = e.entity_type and ent.id = e.entity_id and ent.school_id = (r.persona ->> 'school_id')::int
where r.status = 'succeeded';
comment on view analytics.v_my_history is 'Questions the current user asked before, across threads, one row per (run, resolved entity). Recall of what was asked, never evidence about a student.';
