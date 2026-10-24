-- Presence and device uptime are derived once (by the seed; in production by the backend job that derives tap direction),
-- not recomputed per query: a window over 800k taps or an aggregate over 1.3M heartbeats exceeded the 5s statement cap.
-- The views keep their columns so nothing above them changes.

create table public.presence_events (
  id bigint generated always as identity primary key,
  school_id int not null references public.schools (id),
  student_id int not null references public.students (id),
  location_id int not null references public.rooms (id),
  device_id int not null references public.devices (id),
  arrived_at timestamptz not null,
  left_by timestamptz,
  left_by_kind text not null check (left_by_kind in ('exit_tap', 'pass_tap_out', 'next_arrival', 'end_of_day')),
  next_location_id int references public.rooms (id)
);
create index presence_student_arrived on public.presence_events (student_id, arrived_at);
create index presence_location_arrived on public.presence_events (location_id, arrived_at);
create index presence_school_arrived on public.presence_events (school_id, arrived_at);
comment on table public.presence_events is 'One row per arrival (classroom, kiosk or destination reader), derived from taps. left_by is the next tap elsewhere the same day, the end of the school day, or null if the student has not been seen elsewhere yet today.';

create table public.device_hours (
  school_id int not null references public.schools (id),
  device_id int not null references public.devices (id),
  hour timestamptz not null,
  online_ratio numeric not null,
  offline_minutes int not null,
  primary key (device_id, hour)
);
create index device_hours_school_hour on public.device_hours (school_id, hour);

alter table public.presence_events enable row level security;
alter table public.device_hours enable row level security;
create policy presence_teacher on public.presence_events for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'teacher' and student_id in (select analytics.my_student_ids()));
create policy presence_admin on public.presence_events for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'admin' and school_id = (select nullif(current_setting('app.school_id', true), '')::int));
create policy presence_super on public.presence_events for select to ask_moov_query using ((select current_setting('app.role', true)) = 'super_admin');
create policy device_hours_admin on public.device_hours for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'admin' and school_id = (select nullif(current_setting('app.school_id', true), '')::int));
create policy device_hours_super on public.device_hours for select to ask_moov_query using ((select current_setting('app.role', true)) = 'super_admin');
grant select on public.presence_events, public.device_hours to ask_moov_query;

create or replace view analytics.v_presence with (security_invoker = true) as
select e.school_id, e.student_id, e.location_id, r.name as location, r.kind as location_kind, d.type as device_type,
       e.arrived_at, e.left_by, e.left_by_kind, nr.name as next_location
from public.presence_events e
join public.rooms r on r.id = e.location_id
join public.devices d on d.id = e.device_id
left join public.rooms nr on nr.id = e.next_location_id;
comment on view analytics.v_presence is 'One row per arrival. left_by is when the student is next seen somewhere else. left_by_kind says how: exit_tap and pass_tap_out are measured departures; next_arrival and end_of_day are inferred, so left_by is an upper bound on time at this location, not a measurement. left_by is null when the student has not been seen elsewhere yet today. Hallway handheld checks are not arrivals.';

create or replace view analytics.v_device_uptime with (security_invoker = true) as
select h.school_id, h.device_id, d.type as device_type, d.location_id as room_id, h.hour, h.online_ratio, h.offline_minutes
from public.device_hours h
join public.devices d on d.id = h.device_id
join public.school_calendar c on c.school_id = h.school_id and c.date = (h.hour at time zone 'UTC')::date and c.is_school_day
join (select school_id, min(starts_at) as day_start, max(ends_at) as day_end from public.bell_schedule group by school_id) x on x.school_id = h.school_id
where (h.hour at time zone 'UTC')::time + interval '59 minutes' >= x.day_start and (h.hour at time zone 'UTC')::time < x.day_end;
comment on view analytics.v_device_uptime is 'One row per device x school hour. online_ratio = heartbeats received / expected (one every 2 minutes). offline_minutes within that hour. A reader offline means taps in that window are missing, not absent.';
