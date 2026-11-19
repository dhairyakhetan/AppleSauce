-- checker_next_question(): English rescue rows the AI doubted come LAST.
--
-- Owner, 2026-09-28: English rescue rows (hidden on the site) that the two
-- computer checks doubted must ALSO reach the paper checkers, but only after
-- every other kid-bucket question. UnlimitedOCR's english_verify.py now
-- routes them to review_bucket 'kid' and marks them with
-- source.rescue_decision = 'ai_doubt' (plus flag 'rescue_ai_doubt'). This
-- function sorts on that marker FIRST, so they are served only when nothing
-- else is waiting for this checker.
--
-- Everything else is exactly the live definition (pulled with
-- pg_get_functiondef on 2026-09-28, same as 20260928140000): live_copy
-- papers first, then the paper with the fewest questions still unpassed,
-- then newest year, then paper created_at, then ord. Same return type, so
-- CREATE OR REPLACE is enough (no DROP).
--
-- These rows can still never be published without a checker: the publish
-- path requires question_passed, and only checker_pass_question /
-- checker_fix_question (or an admin) set it. Nothing here writes it.
--
-- Picture honesty (same change set) needs NO SQL: both checker RPCs already
-- return `source`, which carries snippet_object and align_score for the
-- question and, on the parent row that checker_question_context returns,
-- whole_snippet_object and whole_snippet_members. The client decides from
-- those (src/lib/checker-pictures.ts).
--
-- Grants follow CLAUDE.md's trap: revoke from public AND anon AND
-- authenticated by role name, then grant execute to authenticated only.

begin;

create or replace function public.checker_next_question()
returns table (
  id uuid, paper_id uuid, ord int, display_number text, number_path text,
  body text, options jsonb, marks numeric, instructions text,
  flag_reasons text[], flag_detail text, source jsonb,
  subject text, school text, cls text, exam text, year text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_q public.audit_questions;
  v_subjects text[];
  v_classes text[];
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select subjects, classes into v_subjects, v_classes
  from public.paper_checkers where user_id = v_uid;

  select aq.* into v_q
  from public.audit_questions aq
  join public.audit_papers ap on ap.id = aq.paper_id
  where aq.kind = 'question'
    and aq.review_bucket = 'kid'
    and aq.question_passed = false
    and ap.source in ('live_copy', 'new_ocr')
    and (aq.locked_until is null or aq.locked_until < now())
    and (v_subjects is null or array_length(v_subjects, 1) is null or ap.subject = any(v_subjects))
    and (v_classes is null or array_length(v_classes, 1) is null or ap.class = any(v_classes))
    and not exists (
      select 1 from public.audit_question_skips s
      where s.question_id = aq.id and s.user_id = v_uid and s.skipped_at > now() - interval '24 hours'
    )
  -- Owner 2026-09-28: English rescue rows the AI doubted go after
  -- everything else. Then D68: live papers first. Then the paper with the
  -- fewest questions still unpassed, so it clears soonest; then newest
  -- year, then paper order.
  order by
    case when aq.source->>'rescue_decision' = 'ai_doubt' then 1 else 0 end,
    case when ap.source = 'live_copy' then 0 else 1 end,
    (select count(*) from public.audit_questions r
      where r.paper_id = aq.paper_id and r.kind = 'question' and not r.question_passed),
    case when ap.year ~ '^\d+$' then ap.year::int else 0 end desc,
    ap.created_at, aq.ord
  limit 1
  for update of aq skip locked;

  if v_q.id is null then
    return;
  end if;

  update public.audit_questions
  set locked_by = v_uid, locked_until = now() + interval '10 minutes'
  where public.audit_questions.id = v_q.id;

  return query
    select aq.id, aq.paper_id, aq.ord, aq.display_number, aq.number_path,
           aq.body, aq.options, aq.marks, aq.instructions,
           aq.flag_reasons, aq.flag_detail, aq.source,
           ap.subject, ap.school, ap.class, ap.exam_type, ap.year
    from public.audit_questions aq
    join public.audit_papers ap on ap.id = aq.paper_id
    where aq.id = v_q.id;
end;
$function$;

revoke all on function public.checker_next_question() from public, anon, authenticated;
grant execute on function public.checker_next_question() to authenticated;

commit;

-- Verify after applying (CLAUDE.md: audit with has_function_privilege):
--   select has_function_privilege('anon', 'public.checker_next_question()', 'EXECUTE');          -- false
--   select has_function_privilege('authenticated', 'public.checker_next_question()', 'EXECUTE'); -- true
--
-- One-off re-route of rows doubted BEFORE english_verify.py changed (7 rows
-- on 2026-09-28). Deliberately NOT part of this migration: it is data, run
-- by hand after this function is live, audit_questions only.
--
--   update public.audit_questions
--   set review_bucket = 'kid'
--   where source->>'pipeline' = 'english_w14'
--     and source->>'role' = 'rescue'
--     and source->>'rescue_decision' = 'ai_doubt'
--     and 'rescue_ai_doubt' = any(flag_reasons)
--     and review_bucket = 'none'
--     and question_passed = false
--     and coalesce(flag_detail, '') not ilike '%underlining or bold that was lost%';
