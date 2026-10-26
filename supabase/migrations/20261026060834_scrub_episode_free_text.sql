-- Episodic memory keeps no names and no results (design 11.2; session log 2026-10-26). Free text broke that: the critic's
-- reason, stored with every episode and read by nothing, quoted student names and results, and a tier-3 step's reason or
-- sql could name the students the question was about (63 of 303 episodes held a student's full name). The worker now keeps
-- the verdict only and replaces the people a run named (episodes.forMemory). This cleans the rows written before that.

-- 1. The critique keeps its verdict only.
update memory.episodes
set critique = jsonb_build_object('pass', critique -> 'pass')
where critique is not null and critique - 'pass' <> '{}'::jsonb;

-- 2. The full name of any student or teacher left in a plan or a templated question becomes the worker's placeholder.
--    Names come from the people tables, matched as whole words regardless of case.
do $$
declare
  p record;
  pattern text;
begin
  for p in
    select name, '{student}' as token from public.students
    union all
    select name, '{teacher}' from public.teachers
  loop
    pattern := '\m' || regexp_replace(p.name, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M';
    update memory.episodes set plan = regexp_replace(plan::text, pattern, p.token, 'gi')::jsonb where plan::text ~* pattern;
    update memory.episodes set question_templated = regexp_replace(question_templated, pattern, p.token, 'gi') where question_templated ~* pattern;
  end loop;
end
$$;
