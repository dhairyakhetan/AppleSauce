-- site_counts()'s "papers" figure is read everywhere paired with a literal
-- "free to read" claim (Navbar, ProductTour, papers-live-announcement,
-- src/hooks/useSiteCounts.ts's own client-side fallback). needs_review
-- (20260925120000_bank_papers_needs_review.sql) marks a paper as listed but
-- gated ("Coming soon", zero questions served even signed in) -- English's
-- 914 papers and the new non-Class-X Maths batch are all needs_review=true
-- as of this migration, so the old is_published-only count overstated "free
-- to read" by exactly that many. Schools stays as-is: a school still has
-- real, listed papers even while some of them are pending review.
create or replace function public.site_counts()
returns table (teachers bigint, papers bigint, schools bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    (select count(*) from public.teachers_list),
    (select count(*) from public.bank_papers where is_published and not needs_review),
    (select count(distinct school) from public.bank_papers
      where is_published and school is not null and btrim(school) <> '');
$function$;

revoke all on function public.site_counts() from public;
grant execute on function public.site_counts() to anon, authenticated;
