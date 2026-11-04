-- 20261102110000: a paper whose PDF is the wrong file is never served to a verifier (tracker, 2 November 2026).
--
-- locate_pages.py adds 'pdf_mismatch' to audit_papers.flag_reasons when under half of a paper's substantial questions
-- are found on its PDF. Until now only the routing of admin questions to students looked at that flag. A paper already
-- in the verifier pool (bcab2434, 51 open questions, 0 of 49 found on its PDF) stayed servable, was held by a verifier
-- and would have been handed out again after any un-assign, so people checked typed words against pictures of a
-- different paper.
--
-- checker_question_servable() is the one rule both the verifier screens and the automatic hand-out count through
-- (distribute_unassigned_papers counts servable questions per paper; verifier_next_in_paper serves them). Adding the
-- flag test here holds every flagged paper in both places at once, with no other function touched. It is a plain
-- create or replace, so the signature, STABLE, search path and the existing grants stay as they are.
--
-- To release a paper: clear 'pdf_mismatch' from its flag_reasons (locate_pages.py does this by itself once the right PDF
-- is in place and at least half of the questions are found). Nothing is deleted or moved: questions stay in the 'kid'
-- bucket, assignments are left to the existing 7 day idle return.
--
-- Rollback: create or replace the function again without the `not ('pdf_mismatch' = any (...))` line (the body kept in
-- the comment at the foot of this file).

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
     and coalesce(p_q.source ->> 'pipeline', '') <> 'english_w14'
     and exists (
       select 1 from public.audit_papers ap
       where ap.id = p_q.paper_id
         and ap.source in ('live_copy', 'new_ocr')
         and not ('pdf_mismatch' = any (coalesce(ap.flag_reasons, '{}'::text[])))
     );
$function$;

-- Rollback body (the live function as read on 2 November 2026): the same text as above without the line
--   and not ('pdf_mismatch' = any (coalesce(ap.flag_reasons, '{}'::text[])))
