-- 20261103000000: a question that leans on something outside its own crop is served only when the page that holds it is stored
-- (tracker, 3 November 2026; owner: "parent questions often have tables and stuff, all that also need to be accounted for").
--
-- A child question's crop shows the child. Its parent's table, figure or passage is not in that crop (measured on 2 November
-- 2026: 2,216 of 2,238 open child questions have their own crop only), so a checker saw the words and the child's box but not
-- the table the question is about. The "See the whole paper" button already opens the stored pages, so the fix is to make
-- sure those pages exist before the question is handed out.
--
-- checker_reference_ok(q) is true when the question stands alone, or a whole-question crop covers it, or EVERY page it leans on
-- (its own and its parent's) is in audit_paper_pages. "Leans on something" is: figure_missing flag or a figure on the question
-- or on its parent; a parent whose words contain the word table or a pipe, or run past 300 characters, or that the swarm
-- read as a passage. It mirrors auditor/pipeline/checker_readiness.py (reference_reasons, reference_covered), which reports
-- the same fault before this function holds anything back.
--
-- checker_question_servable keeps every rule it has (including the pdf_mismatch hold of 20261102110000, which must be applied
-- first) and gains exactly one: and public.checker_reference_ok(p_q). Plain create or replace: signature, STABLE, search path
-- and existing grants unchanged. checker_reference_ok is new and is not security definer.
--
-- Effect on 3 November 2026: papers bcab2434 and d51dec17 (no stored pages) would hold their reference questions. Both are
-- already on the readiness report. Nothing is deleted or moved; a held question returns by itself when its pages are stored
-- (picture_queue.py lists the pages it still needs).
--
-- Rollback: create or replace checker_question_servable again without the checker_reference_ok line (the body kept in the
-- comment at the foot of this file), then drop function public.checker_reference_ok(audit_questions).

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
      );
$function$;

create or replace function public.checker_question_servable(p_q audit_questions)
 returns boolean
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  select p_q.kind = 'question'
     and p_q.review_bucket = 'kid'
     and p_q.question_passed = false
     and p_q.set_aside_at is null
     and (
       coalesce(public.checker_body_ok(p_q), false)
       or (
         'incomplete_text' = any (coalesce(p_q.flag_reasons, '{}'::text[]))
         and coalesce(p_q.source ->> 'page_verified', '') = 'true'
         and (p_q.source ->> 'page') ~ '^[0-9]{1,3}$'
         and exists (
               select 1 from public.audit_paper_pages pg
               where pg.audit_paper_id = p_q.paper_id
                 and pg.page = case when (p_q.source ->> 'page') ~ '^[0-9]{1,3}$' then (p_q.source ->> 'page')::int end)
       )
     )
     and public.checker_has_picture(p_q)
     and public.checker_reference_ok(p_q)
     and coalesce(p_q.source ->> 'pipeline', '') <> 'english_w14'
     and exists (
       select 1 from public.audit_papers ap
       where ap.id = p_q.paper_id
         and ap.source in ('live_copy', 'new_ocr')
         and not ('pdf_mismatch' = any (coalesce(ap.flag_reasons, '{}'::text[])))
     );
$function$;

-- Rollback body of checker_question_servable (the function as left by 20261102110000): the same text as above without the line
--   and public.checker_reference_ok(p_q)
