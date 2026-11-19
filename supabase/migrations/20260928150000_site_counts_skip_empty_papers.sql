-- Owner, 2026-09-28: papers with no questions should not be shown. 469
-- English bank_papers rows are published with question_count = 0 (checked:
-- question_count matches bank_questions exactly for every published paper).
-- The site already filters question_count > 0 on every public read; this
-- keeps the headline paper count in step. Only the papers line changes; the
-- teachers and schools lines are exactly as before.

create or replace function public.site_counts()
returns table(teachers bigint, papers bigint, schools bigint)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    (select count(*) from public.teachers_list),
    (select count(*) from public.bank_papers where is_published and question_count > 0),
    (select count(distinct school) from public.bank_papers
      where is_published and has_school and school is not null and btrim(school) <> '');
$function$;
