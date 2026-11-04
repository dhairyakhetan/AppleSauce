-- Owner decision, 12 October 2026 (follows 20261012980000): the same principle
-- as the paper total. A school counts only if it has at least one READABLE
-- paper, that is a paper that is published, has questions and is not under
-- review (Coming soon). A school whose only papers are Coming soon keeps its
-- page and its row in the schools directory but is not part of the figure the
-- site advertises. 115 schools with a listed paper -> 110 with a readable one.
--
-- The rule is written once in the app, src/lib/readable-papers.ts, and here;
-- readable-papers.test.ts reads this file and checks the predicate.
--
-- Only the schools line changes. The teachers line and the papers line (from
-- 20261012980000) are exactly as they were. Signature, return shape, SECURITY
-- DEFINER, search_path and grants are unchanged: anon and authenticated keep
-- EXECUTE, public stays closed.
create or replace function public.site_counts()
returns table(teachers bigint, papers bigint, schools bigint)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    (select count(*) from public.teachers_list),
    (select count(*) from public.bank_papers
      where is_published and question_count > 0 and not needs_review),
    (select count(distinct school) from public.bank_papers
      where is_published and question_count > 0 and not needs_review
        and has_school and school is not null and btrim(school) <> '');
$function$;

revoke all on function public.site_counts() from public;
grant execute on function public.site_counts() to anon, authenticated;
