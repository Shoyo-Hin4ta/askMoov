-- v_passes: compute period with a join instead of a correlated subquery (per-row lookup timed out on school-wide counts).
-- Same columns, same order, same types, so CREATE OR REPLACE is allowed.

create or replace view analytics.v_passes with (security_invoker = true) as
select p.school_id, p.student_id, p.section_id, p.origin_room_id, r.wing, p.destination, p.issuer, p.started_at, p.ended_at,
       round(extract(epoch from (coalesce(p.ended_at, analytics.frozen_now()) - p.started_at)) / 60.0, 1) as minutes,
       (extract(epoch from (coalesce(p.ended_at, analytics.frozen_now()) - p.started_at)) / 60.0) > 20 as over_limit,
       b.period,
       extract(isodow from p.started_at)::int as day_of_week,
       c.ab_day
from public.passes p
left join public.rooms r on r.id = p.origin_room_id
left join public.bell_schedule b on b.school_id = p.school_id
  and (p.started_at at time zone 'UTC')::time >= b.starts_at and (p.started_at at time zone 'UTC')::time < b.ends_at
left join public.school_calendar c on c.school_id = p.school_id and c.date = (p.started_at at time zone 'UTC')::date;
comment on view analytics.v_passes is 'One row per hall pass. minutes runs to frozen now for a pass that has not ended (still out). over_limit = more than 20 minutes. Bathroom destination is assumed, not verified by a tap.';
