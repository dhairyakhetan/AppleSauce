-- 20261011160000: English questions may be served to student checkers.
-- Owner 2026-10-11 ("English goes to students too"). checker_question_servable excluded every paper whose subject
-- starts with English (the old AI-only English route). The old english_w14 pipeline rows stay excluded; nothing else changes.
-- CREATE OR REPLACE keeps the function's existing grants.

create or replace function public.checker_question_servable(p_q audit_questions)
 returns boolean
 language sql
 stable
as $function$
  select p_q.kind = 'question'
     and p_q.review_bucket = 'kid'
     and p_q.question_passed = false
     and p_q.set_aside_at is null
     and public.checker_body_ok(p_q)
     and public.checker_has_picture(p_q)
     and coalesce(p_q.source ->> 'pipeline', '') <> 'english_w14'
     and exists (
       select 1 from public.audit_papers ap
       where ap.id = p_q.paper_id
         and ap.source in ('live_copy', 'new_ocr')
     );
$function$;
