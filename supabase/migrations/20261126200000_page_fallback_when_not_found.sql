-- 20261126200000: when the question cannot be found on the paper, show the pages (owner, 26 Nov 2026:
-- "If you can't find the question on the paper, just fall back to showing the pages").
--
-- Before: a question with no crop of its own (or its parent's) and no located page had no picture, so the
-- pipeline (enforce_picture_rule.py) parked it with an admin as "page not found", even when EVERY printed page
-- of its paper was stored. Checkers can already open the whole paper and flip its pages, so that question can
-- be checked against the pages.
--
-- After: a question also "has a picture" when
--   1. its page was looked for and not found (locate_pages.py wrote source.page_verified = false), AND
--   2. every printed page of its paper is stored: audit_papers.page_count is known (> 0) and every page
--      1..page_count has a row in audit_paper_pages (the same "stored" test paper_picture_gaps uses).
-- The checker screen then opens the whole paper at page 1 with the line "We could not find this question on
-- the page; look through the pages below."
--
-- Two new helpers, both closed to every client role (only other database functions call them):
--   paper_all_pages_stored(paper id)  reads audit_papers and audit_paper_pages ONLY. It deliberately does not
--                                     call paper_pictures_complete or paper_picture_gaps: those call
--                                     checker_has_picture, so calling them from here would loop.
--   checker_page_fallback_ok(question) the two conditions above.
-- Two existing functions gain exactly one "or" each, bodies otherwise copied unchanged from their latest
-- definitions (checked on 26 Nov 2026, no later redefinition in supabase/migrations):
--   checker_has_picture   from 20261003160000_checker_lanes_pictures_lost_text.sql
--   checker_reference_ok  from 20261103000000_reference_pages_before_serving.sql (a question that leans on a
--                         table or figure is also covered when every page of its paper is stored)
-- checker_question_servable, paper_picture_gaps, paper_pictures_complete and every hand-out function call these
-- two, so they pick the rule up without being changed. A question that was never looked for
-- (page_verified missing) is NOT covered: the pipeline still locates it first.
--
-- Rollback: create or replace checker_has_picture and checker_reference_ok again with the bodies in the two
-- files named above, then drop function public.checker_page_fallback_ok(public.audit_questions) and
-- drop function public.paper_all_pages_stored(uuid).

-- 1. Every printed page of the paper is stored.
create or replace function public.paper_all_pages_stored(p_paper_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce((
    select coalesce(ap.page_count, 0) > 0
       and (select count(distinct pg.page)
              from public.audit_paper_pages pg
             where pg.audit_paper_id = ap.id
               and coalesce(pg.object_path, '') <> ''
               and pg.page between 1 and ap.page_count) = ap.page_count
    from public.audit_papers ap
    where ap.id = p_paper_id), false);
$function$;

-- 2. The page was looked for and not found, and every page is stored: show the pages.
create or replace function public.checker_page_fallback_ok(p_q public.audit_questions)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(p_q.source ->> 'page_verified', '') = 'false'
     and public.paper_all_pages_stored(p_q.paper_id);
$function$;

revoke all on function public.paper_all_pages_stored(uuid) from public, anon, authenticated;
revoke all on function public.checker_page_fallback_ok(public.audit_questions) from public, anon, authenticated;

-- 3. checker_has_picture: the 20261003160000 body, plus the page fallback as the last "or".
create or replace function public.checker_has_picture(p_q public.audit_questions)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select
    coalesce(p_q.source ->> 'whole_snippet_object', '') <> ''
    or (coalesce(p_q.source ->> 'snippet_object', '') <> ''
        and (case when coalesce(p_q.source ->> 'align_score', '') = '' then true
                  when (p_q.source ->> 'align_score') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p_q.source ->> 'align_score')::numeric >= 0.9
                  else false end))
    or exists (
         select 1 from public.audit_questions par
         where par.id = p_q.parent_id
           and (coalesce(par.source ->> 'whole_snippet_object', '') <> ''
                or (coalesce(par.source ->> 'snippet_object', '') <> ''
                    and (case when coalesce(par.source ->> 'align_score', '') = '' then true
                  when (par.source ->> 'align_score') ~ '^-?[0-9]+(\.[0-9]+)?$' then (par.source ->> 'align_score')::numeric >= 0.9
                  else false end))))
    or (p_q.source ->> 'page_verified' = 'true'
        and (p_q.source ->> 'page') ~ '^[0-9]{1,3}$'
        and exists (
              select 1 from public.audit_paper_pages pg
              where pg.audit_paper_id = p_q.paper_id
                and pg.page = case when (p_q.source ->> 'page') ~ '^[0-9]{1,3}$' then (p_q.source ->> 'page')::int end))
    or public.checker_page_fallback_ok(p_q);
$function$;

revoke all on function public.checker_has_picture(public.audit_questions) from public, anon, authenticated;

-- 4. checker_reference_ok: the 20261103000000 body, plus the page fallback as the last "or".
create or replace function public.checker_reference_ok(p_q audit_questions)
 returns boolean
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  with par as (
    select * from public.audit_questions where id = p_q.parent_id
  ),
  need as (
    select ('figure_missing' = any (coalesce(p_q.flag_reasons, '{}'::text[])))
        or coalesce(p_q.figure::text, 'null') not in ('null', '{}', '[]', '""')
        or exists (
             select 1 from par
             where 'figure_missing' = any (coalesce(par.flag_reasons, '{}'::text[]))
                or coalesce(par.figure::text, 'null') not in ('null', '{}', '[]', '""')
                or coalesce(par.body, '') ~* '\mtable\M'
                or position('|' in coalesce(par.body, '')) > 0
                or length(coalesce(par.body, '')) > 300
                or coalesce(par.source -> 'swarm' ->> 'kind', '') = 'passage'
           ) as needed
  ),
  leaned as (
    select p_q.paper_id as paper_id,
           case when (p_q.source ->> 'page') ~ '^[0-9]{1,3}$' then (p_q.source ->> 'page')::int end as pg
    union all
    select par.paper_id,
           case when (par.source ->> 'page') ~ '^[0-9]{1,3}$' then (par.source ->> 'page')::int end
    from par
  )
  select not (select needed from need)
      or coalesce(p_q.source ->> 'whole_snippet_object', '') <> ''
      or exists (select 1 from par where coalesce(par.source ->> 'whole_snippet_object', '') <> '')
      or (
        exists (select 1 from leaned where pg is not null)
        and not exists (
              select 1 from leaned l
              where l.pg is not null
                and not exists (select 1 from public.audit_paper_pages a
                                where a.audit_paper_id = l.paper_id and a.page = l.pg))
      )
      or public.checker_page_fallback_ok(p_q);
$function$;

revoke all on function public.checker_reference_ok(public.audit_questions) from public, anon, authenticated;
