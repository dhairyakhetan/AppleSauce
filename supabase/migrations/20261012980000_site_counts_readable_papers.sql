-- Owner decision, 12 October 2026: the public paper count counts READABLE
-- papers only. A paper that is listed but under review (needs_review) stays in
-- the library as "Coming soon" but is not a "real question paper" the site can
-- claim, so it is no longer part of the total. 622 listed -> 616 readable (the
-- 6 difference are non-Maths needs_review papers).
--
-- This reverses 20260926030000_site_counts_include_needs_review, whose
-- product-owner decision (count every listed paper) is superseded today.
--
-- The rule is written once in the app, src/lib/readable-papers.ts
-- (isReadableRow), and once here; src/lib/readable-papers.test.ts reads this
-- file and checks the predicate matches.
--
-- Only the papers line changes. The teachers line (still returned, though the
-- app reads the listed-teacher count instead: lib/listed-teachers.ts) and the
-- schools line are exactly as in 20260928150000_site_counts_skip_empty_papers.
-- Signature, return shape, SECURITY DEFINER, search_path and grants are
-- unchanged: anon and authenticated keep EXECUTE, public stays closed.
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
      where is_published and has_school and school is not null and btrim(school) <> '');
$function$;

revoke all on function public.site_counts() from public;
grant execute on function public.site_counts() to anon, authenticated;
