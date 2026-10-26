-- The same cleanup as 20261026060834_scrub_episode_free_text, once more: between that migration and the deploy of the
-- worker that keeps only the verdict (f8d2daa), the previous worker wrote 9 more episodes with the critic's full reason
-- (the last at 2026-10-26 06:14:43 UTC). Episodes written since keep no free text, so this is the last time it is needed.

update memory.episodes
set critique = jsonb_build_object('pass', critique -> 'pass')
where critique is not null and critique - 'pass' <> '{}'::jsonb;

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
