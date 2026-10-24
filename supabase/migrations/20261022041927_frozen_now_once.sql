-- analytics.frozen_now() is security definer, so Postgres cannot inline it and called it once per row
-- (254k calls for a school-wide pass count, 1.6M for presence). Evaluate it once per statement via a lateral subquery.

create or replace view analytics.v_passes with (security_invoker = true) as
select p.school_id, p.student_id, p.section_id, p.origin_room_id, r.wing, p.destination, p.issuer, p.started_at, p.ended_at,
       round(extract(epoch from (coalesce(p.ended_at, fn.now) - p.started_at)) / 60.0, 1) as minutes,
       (extract(epoch from (coalesce(p.ended_at, fn.now) - p.started_at)) / 60.0) > 20 as over_limit,
       b.period,
       extract(isodow from p.started_at)::int as day_of_week,
       c.ab_day
from public.passes p
cross join (select analytics.frozen_now() as now) fn
left join public.rooms r on r.id = p.origin_room_id
left join public.bell_schedule b on b.school_id = p.school_id
  and (p.started_at at time zone 'UTC')::time >= b.starts_at and (p.started_at at time zone 'UTC')::time < b.ends_at
left join public.school_calendar c on c.school_id = p.school_id and c.date = (p.started_at at time zone 'UTC')::date;
comment on view analytics.v_passes is 'One row per hall pass. minutes runs to frozen now for a pass that has not ended (still out). over_limit = more than 20 minutes. Bathroom destination is assumed, not verified by a tap.';

create or replace view analytics.v_presence with (security_invoker = true) as
with fn as (select analytics.frozen_now() as now), t as (
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
         when (t.ts at time zone 'UTC')::date = (fn.now at time zone 'UTC')::date then null
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
cross join fn
join bounds b on b.school_id = t.school_id
where t.kind in ('arrival', 'pass_end', 'check');
comment on view analytics.v_presence is 'One row per arrival. left_by is when the student is next seen somewhere else. left_by_kind says how: exit_tap and pass_tap_out are measured departures; next_arrival and end_of_day are inferred, so left_by is an upper bound on time at this location, not a measurement. left_by is null when the student has not been seen elsewhere yet today.';

create or replace view analytics.v_cards with (security_invoker = true) as
select c.school_id, c.student_id, c.id as card_id, c.type, c.status, c.issued_at,
       (select c2.type from public.cards c2 where c2.student_id = c.student_id and c2.status = 'active' order by c2.issued_at desc limit 1) as active_card_type,
       (select count(*) from public.cards c3 where c3.student_id = c.student_id and c3.type = 'temp' and c3.issued_at >= fn.now - interval '30 days')::int as temp_ids_issued_30d
from public.cards c
cross join (select analytics.frozen_now() as now) fn;
comment on view analytics.v_cards is 'One row per card. active_card_type is the type of the student''s currently active card (only one card is active at a time; a temp ID deactivates the permanent one).';
