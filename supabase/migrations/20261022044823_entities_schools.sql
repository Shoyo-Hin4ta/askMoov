-- lookup_entity could not resolve a school by name ("Compare Springfield High and Shelbyville High"): add school rows to v_entities.
-- Same columns as before, so CREATE OR REPLACE is allowed. RLS on public.schools decides who sees which school.

create or replace view analytics.v_entities with (security_invoker = true) as
select school_id, 'student' as type, id::text as id, name as label, 'grade ' || grade as detail, grade, null::int as period, name as search from public.students
union all
select school_id, 'teacher', id::text, name, 'teacher', null::int, null::int, name from public.teachers
union all
select s.school_id, 'section', s.id::text, s.course || ', period ' || s.period || ' (' || t.name || ')', 'period ' || s.period || ', ' || t.name, null::int, s.period, s.course || ' ' || t.name
from public.sections s join public.teachers t on t.id = s.teacher_id
union all
select school_id, 'room', id::text, name, kind || coalesce(', ' || wing || ' wing', ''), null::int, null::int, name from public.rooms
union all
select distinct school_id, 'wing', wing, wing || ' wing', 'wing', null::int, null::int, wing from public.rooms where wing is not null
union all
select id, 'school', id::text, name, 'school', null::int, null::int, name from public.schools;
comment on view analytics.v_entities is 'Everything lookup_entity can resolve a name to: students, teachers, sections, rooms, wings, schools. Scope comes from RLS on the base tables: a teacher only sees students on their rosters.';
