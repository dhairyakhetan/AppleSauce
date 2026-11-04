-- 20261012400000: blank swarm questions flagged incomplete_text are served to student checkers, with the page picture.
-- Owner decision 2026-10-12. The swarm exporter sends a question whose printed words did not come through as an empty
-- body flagged incomplete_text; the student reads the whole page and types the words (Fix it).
-- Until now checker_body_ok refused every blank body (unless flag_detail carried a suggested body), so these rows never
-- reached a student and a paper could not reach "M of M done".
--
-- Rule: a blank body is servable ONLY when ALL hold
--   * flag_reasons contains 'incomplete_text'
--   * the WHOLE PAGE can be shown: source.page_verified = 'true' and an audit_paper_pages row exists for that page
--     (the same page test as the last branch of checker_has_picture; a crop or a parent's crop is not enough, because a
--     crop of a question whose words were lost may not show them)
--   * every other servable condition holds (kind, kid bucket, not passed, not set aside, picture, paper source, not
--     english_w14)
-- Every other blank row stays unserved. Nothing here touches a row, a body, or a grant.
--
-- The front end needs no new key: verifier_next_in_paper already returns flag_reasons, page and page_path, so a blank body
-- whose flag_reasons contains 'incomplete_text' is the signal. checker_body_ok is left exactly as it was (it is also the
-- test for "has words"). Passing a blank body stays refused (checker_pass_locked, 22023); only Fix it with typed words saves.
--
-- CREATE OR REPLACE keeps the function's existing grants (anon, authenticated: no EXECUTE).

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
     );
$function$;
