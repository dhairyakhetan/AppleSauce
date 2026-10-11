-- Reverts 20260926020000's needs_review exclusion, by product-owner decision
-- on 2026-09-26: the papers figure sitewide should count every listed paper,
-- flagged for review or not, rather than only the ones currently openable.
-- A needs_review paper is still a real, listed paper (school, board, class,
-- year all real) -- it just renders "Coming soon" instead of its questions.
-- The owner judged undercounting it a worse look than the "free to read"
-- copy being slightly ahead of what a reader can open right now; several
-- surfaces (About.tsx, Navbar, ProductTour, papers-live-announcement, the
-- past-papers headline) already pair this figure with "free to read" or
-- "yours to read free" wording, which is now the mismatch to be aware of --
-- see the accompanying report's flagged-visibility note, not something this
-- migration can fix from SQL alone.
--
-- Second, unrelated fix bundled into the same function body since it is the
-- one place the schools figure is computed in SQL: the distinct-school count
-- had no `has_school` filter, so a board-level row (is_board_paper) -- whose
-- `school` column holds a board name like "ICSE Board", not an actual school
-- -- was counted as one more "Kolkata school". That is almost certainly why
-- the footer's "190 Kolkata schools" looked wrong to the product owner.
-- `has_school` (20260829180437_bank_papers_has_school.sql) is exactly the
-- column the import tooling itself already uses for this: see
-- scripts/generate-bank-sql.ts's own `distinct_schools` report, which filters
-- `where has_school`. This migration matches it. Client-side callers
-- (useSiteCounts, About.tsx) now pass fetchBankSchoolValues(true) for the
-- same reason -- see those files' 2026-09-26 comments.
--
-- Signature, security, search_path and grants are unchanged from
-- 20260926020000 / 20260918100000: only the two subquery predicates change
-- (papers drops "and not needs_review"; schools adds "and has_school").
create or replace function public.site_counts()
returns table (teachers bigint, papers bigint, schools bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    (select count(*) from public.teachers_list),
    (select count(*) from public.bank_papers where is_published),
    (select count(distinct school) from public.bank_papers
      where is_published and has_school and school is not null and btrim(school) <> '');
$function$;

revoke all on function public.site_counts() from public;
grant execute on function public.site_counts() to anon, authenticated;
