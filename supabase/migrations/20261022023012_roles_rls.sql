-- Ask MOOV roles and row level security (design doc 6.1, 8.2).
-- Roles are created nologin; `npm run db:roles` sets passwords and enables login (secrets never live in migrations).
-- Scope = (app.role, app.user_id, app.school_id) session variables, set by withScope() at the start of every query transaction.

create role ask_moov_app nologin;
create role ask_moov_query nologin;

-- app role: ops, memory, langgraph read/write. Nothing in analytics or public.
grant usage on schema ops, memory, langgraph to ask_moov_app;
grant all on all tables in schema ops, memory, langgraph to ask_moov_app;
grant all on all sequences in schema ops, memory, langgraph to ask_moov_app;
alter default privileges in schema ops, memory, langgraph grant all on tables to ask_moov_app;
alter default privileges in schema ops, memory, langgraph grant all on sequences to ask_moov_app;
grant execute on function analytics.frozen_now() to ask_moov_app;
grant usage on schema analytics to ask_moov_app;
alter role ask_moov_app set search_path = ops, memory, langgraph, extensions;

-- query role: SELECT only. Views are security_invoker, so the role also needs SELECT on the base tables; RLS below decides rows.
grant usage on schema analytics, public, extensions to ask_moov_query;
grant select on all tables in schema analytics to ask_moov_query;
grant select on all tables in schema public to ask_moov_query;
-- Column-level minimization: columns no view needs are unreadable by the query role even if the validator were bypassed.
revoke select on public.teachers from ask_moov_query;
grant select (id, school_id, name) on public.teachers to ask_moov_query;
grant usage on schema ops to ask_moov_query;
grant select on ops.runs, ops.run_entities to ask_moov_query;
alter default privileges in schema analytics grant select on tables to ask_moov_query;
alter default privileges in schema public grant select on tables to ask_moov_query;
alter role ask_moov_query set statement_timeout = '5s';
alter role ask_moov_query set default_transaction_read_only = on;
alter role ask_moov_query set search_path = analytics, public, extensions;

-- RLS on every domain table. Policies are per role on the query role; the owner (postgres, seeds and migrations) bypasses.
alter table public.schools enable row level security;
alter table public.school_calendar enable row level security;
alter table public.bell_schedule enable row level security;
alter table public.rooms enable row level security;
alter table public.teachers enable row level security;
alter table public.students enable row level security;
alter table public.cards enable row level security;
alter table public.sections enable row level security;
alter table public.rosters enable row level security;
alter table public.devices enable row level security;
alter table public.device_heartbeats enable row level security;
alter table public.taps enable row level security;
alter table public.passes enable row level security;
alter table public.attendance enable row level security;

-- Dimension tables: readable within the school by every role; super_admin everywhere.
create policy schools_all on public.schools for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'super_admin' or id = (select nullif(current_setting('app.school_id', true), '')::int));
create policy calendar_school on public.school_calendar for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'super_admin' or school_id = (select nullif(current_setting('app.school_id', true), '')::int));
create policy bells_school on public.bell_schedule for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'super_admin' or school_id = (select nullif(current_setting('app.school_id', true), '')::int));
create policy rooms_school on public.rooms for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'super_admin' or school_id = (select nullif(current_setting('app.school_id', true), '')::int));
create policy teachers_school on public.teachers for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'super_admin' or school_id = (select nullif(current_setting('app.school_id', true), '')::int));
create policy sections_school on public.sections for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'super_admin' or school_id = (select nullif(current_setting('app.school_id', true), '')::int));

-- Fact tables: teacher = own rosters/sections, admin = own school, super_admin = all.
create policy students_teacher on public.students for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'teacher' and id in (select analytics.my_student_ids()));
create policy students_admin on public.students for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'admin' and school_id = (select nullif(current_setting('app.school_id', true), '')::int));
create policy students_super on public.students for select to ask_moov_query using ((select current_setting('app.role', true)) = 'super_admin');

create policy rosters_teacher on public.rosters for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'teacher' and section_id in (select analytics.my_section_ids()));
create policy rosters_admin on public.rosters for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'admin' and school_id = (select nullif(current_setting('app.school_id', true), '')::int));
create policy rosters_super on public.rosters for select to ask_moov_query using ((select current_setting('app.role', true)) = 'super_admin');

create policy cards_teacher on public.cards for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'teacher' and student_id in (select analytics.my_student_ids()));
create policy cards_admin on public.cards for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'admin' and school_id = (select nullif(current_setting('app.school_id', true), '')::int));
create policy cards_super on public.cards for select to ask_moov_query using ((select current_setting('app.role', true)) = 'super_admin');

create policy taps_teacher on public.taps for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'teacher' and student_id in (select analytics.my_student_ids()));
create policy taps_admin on public.taps for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'admin' and school_id = (select nullif(current_setting('app.school_id', true), '')::int));
create policy taps_super on public.taps for select to ask_moov_query using ((select current_setting('app.role', true)) = 'super_admin');

create policy passes_teacher on public.passes for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'teacher' and section_id in (select analytics.my_section_ids()));
create policy passes_admin on public.passes for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'admin' and school_id = (select nullif(current_setting('app.school_id', true), '')::int));
create policy passes_super on public.passes for select to ask_moov_query using ((select current_setting('app.role', true)) = 'super_admin');

create policy attendance_teacher on public.attendance for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'teacher' and section_id in (select analytics.my_section_ids()));
create policy attendance_admin on public.attendance for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'admin' and school_id = (select nullif(current_setting('app.school_id', true), '')::int));
create policy attendance_super on public.attendance for select to ask_moov_query using ((select current_setting('app.role', true)) = 'super_admin');

-- Device data: admin and super_admin only. Teachers get no rows.
create policy devices_admin on public.devices for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'admin' and school_id = (select nullif(current_setting('app.school_id', true), '')::int));
create policy devices_super on public.devices for select to ask_moov_query using ((select current_setting('app.role', true)) = 'super_admin');
create policy heartbeats_admin on public.device_heartbeats for select to ask_moov_query using (
  (select current_setting('app.role', true)) = 'admin' and school_id = (select nullif(current_setting('app.school_id', true), '')::int));
create policy heartbeats_super on public.device_heartbeats for select to ask_moov_query using ((select current_setting('app.role', true)) = 'super_admin');

-- History: a user sees only their own runs, whatever their role. The app role sees everything.
alter table ops.runs enable row level security;
alter table ops.run_entities enable row level security;
create policy runs_app on ops.runs for all to ask_moov_app using (true) with check (true);
create policy run_entities_app on ops.run_entities for all to ask_moov_app using (true) with check (true);
create policy runs_own_history on ops.runs for select to ask_moov_query using (
  (persona ->> 'user_id')::int = (select nullif(current_setting('app.user_id', true), '')::int));
create policy run_entities_own_history on ops.run_entities for select to ask_moov_query using (
  run_id in (select id from ops.runs));
