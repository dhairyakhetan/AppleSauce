-- NOT APPLIED. Written 2026-09-30 for review, then apply.
--
-- WHY: the checker showed the WRONG whole PDF page for a third of the
-- questions routed to it. source.page is the aligner's best guess even when
-- its score is low, and nothing checked that the page holds the question.
-- Measured against the local PDFs: of 277 open questions with a registered
-- page and no trusted crop, 95 had under 50% token overlap with the stored
-- page (39 right PDF but wrong page, 50 no matching page at all: wrong PDF).
--
-- The pipeline half (auditor/pipeline/locate_pages.py) now checks each
-- question's text against the PDF page text and records
--   audit_questions.source.page_verified (true/false), page_match_score,
--   page_method, and adds 'pdf_mismatch' to audit_papers.flag_reasons when
--   most of a paper's questions are not on its PDF at all.
-- The site (src/lib/checker-page.ts) shows a whole page only when
-- source.page_verified is true. This migration is the routing half:
--
--   1. route_maths_admin_to_checkers() moves a question to the students only
--      when source->>'page_verified' = 'true' AND its paper is not flagged
--      pdf_mismatch (plus everything it already required).
--   2. One-time: questions that route function already moved to the kid
--      bucket, that a checker has not passed, that have no trusted crop
--      (a crop is trusted when snippet_object is set and align_score is
--      absent or at least 0.9, as in src/lib/checker-pictures.ts) and whose
--      page is not verified go BACK to admin, one audit_review_log row each
--      (action 'route_back_unverified_page'). Questions that were in the kid
--      bucket for other reasons are untouched: only rows the routing function
--      logged are candidates.
--
-- checker_next_question / checker_question_context already return `options`
-- and `source` (explicit columns; answer_key is not on audit_questions and is
-- not returned), so no RPC change is needed for MCQ options.
--
-- ORDER OF OPERATIONS: run locate_pages.py --apply FIRST so page_verified
-- exists, then apply this migration. Applied earlier, the one-time step
-- would move back every routed question (none is verified yet). Safe, noisy.
--
-- UNDO of the one-time step:
--   update public.audit_questions aq set review_bucket = 'kid'
--   from public.audit_review_log l
--   where l.question_id = aq.id and l.action = 'route_back_unverified_page'
--     and aq.review_bucket = 'admin' and aq.question_passed = false;

begin;

set local lock_timeout = '10s';

-- Guard: the one-time step below trusts page_verified; without it every routed
-- question would go back to admin (safe, but noisy).
do $$
begin
  if not exists (select 1 from public.audit_questions where source ? 'page_verified') then
    raise exception 'run pipeline.locate_pages --apply before this migration';
  end if;
end
$$;

create or replace function public.route_maths_admin_to_checkers(
  p_apply boolean default false,
  p_skip_reasons text[] default array['possible_duplicate', 'ocr_dropout', 'script_unsupported']
)
returns table (eligible_questions integer, eligible_papers integer, moved integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_ids uuid[];
  v_moved integer := 0;
begin
  select coalesce(array_agg(aq.id), array[]::uuid[]) into v_ids
  from public.audit_questions aq
  join public.audit_papers ap on ap.id = aq.paper_id
  where aq.kind = 'question'
    and aq.review_bucket = 'admin'
    and aq.question_passed = false
    and coalesce(aq.status, '') <> 'red'
    and btrim(coalesce(aq.body, '')) <> ''
    and ap.source in ('live_copy', 'new_ocr')
    and ap.subject ilike 'Math%'
    and not (coalesce(aq.source ->> 'pipeline', '') = 'english_w14')
    and not (coalesce(aq.flag_reasons, array[]::text[])
             && array['possible_duplicate', 'ocr_dropout', 'script_unsupported', 'board_class_mismatch'])
    and not (coalesce(aq.flag_reasons, array[]::text[]) && coalesce(p_skip_reasons, array[]::text[]))
    -- The page must have been CHECKED against the PDF text (locate_pages.py),
    -- and the paper's PDF must not be the wrong file for it.
    and (aq.source ->> 'page_verified') = 'true'
    and not ('pdf_mismatch' = any (coalesce(ap.flag_reasons, array[]::text[])))
    and (aq.source ->> 'page') ~ '^[0-9]{1,3}$'
    and exists (
      select 1 from public.audit_paper_pages pg
      where pg.audit_paper_id = aq.paper_id
        and pg.page = case when (aq.source ->> 'page') ~ '^[0-9]{1,3}$'
                           then (aq.source ->> 'page')::integer end
    );

  if p_apply and coalesce(array_length(v_ids, 1), 0) > 0 then
    with moved_rows as (
      update public.audit_questions aq
      set review_bucket = 'kid'
      from public.audit_papers ap
      where ap.id = aq.paper_id
        and aq.id = any(v_ids)
        and aq.review_bucket = 'admin'
        and aq.question_passed = false
        -- re-check the exclusions in case something changed since the snapshot
        and not (coalesce(aq.flag_reasons, array[]::text[])
                 && array['possible_duplicate', 'ocr_dropout', 'script_unsupported', 'board_class_mismatch'])
        and (aq.source ->> 'page_verified') = 'true'
        and not ('pdf_mismatch' = any (coalesce(ap.flag_reasons, array[]::text[])))
      returning aq.id, aq.paper_id
    ), logged as (
      insert into public.audit_review_log
        (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
      select null, null, m.paper_id, m.id, 'reclassify', 'review_bucket',
             jsonb_build_object('review_bucket', 'admin'),
             jsonb_build_object('review_bucket', 'kid'),
             'owner-decision-2026-09-29 route_maths_admin_to_checkers: verified page image registered; review_bucket admin -> kid'
      from moved_rows m
      returning 1
    )
    select count(*)::integer into v_moved from logged;
  end if;

  return query
    select coalesce(array_length(v_ids, 1), 0),
           (select count(distinct aq.paper_id)::integer from public.audit_questions aq where aq.id = any(v_ids)),
           v_moved;
end;
$function$;

-- Closed by ROLE NAME, not just public (Supabase default-grants EXECUTE to
-- anon and authenticated).
revoke all on function public.route_maths_admin_to_checkers(boolean, text[]) from public;
revoke all on function public.route_maths_admin_to_checkers(boolean, text[]) from anon;
revoke all on function public.route_maths_admin_to_checkers(boolean, text[]) from authenticated;

-- One-time: send back what the old (unverified) routing moved.
with back as (
  update public.audit_questions aq
  set review_bucket = 'admin', locked_by = null, locked_until = null
  from public.audit_papers ap
  where ap.id = aq.paper_id
    and aq.review_bucket = 'kid'
    and aq.question_passed = false
    and aq.kind = 'question'
    and ap.subject ilike 'Math%'
    and coalesce(aq.source ->> 'page_verified', 'false') <> 'true'
    -- no trusted crop (checker-pictures.ts: snippet_object set, score absent or >= 0.9)
    and not (
      coalesce(btrim(aq.source ->> 'snippet_object'), '') <> ''
      and (
        (aq.source ->> 'align_score') is null
        or ((aq.source ->> 'align_score') ~ '^[0-9]*\.?[0-9]+$'
            and (aq.source ->> 'align_score')::numeric >= 0.9)
      )
    )
    -- only rows the routing function itself moved
    and exists (
      select 1 from public.audit_review_log l
      where l.question_id = aq.id
        and l.action = 'reclassify'
        and l.note like '%route_maths_admin_to_checkers%'
    )
  returning aq.id, aq.paper_id
)
insert into public.audit_review_log
  (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
select null, null, b.paper_id, b.id, 'route_back_unverified_page', 'review_bucket',
       jsonb_build_object('review_bucket', 'kid'),
       jsonb_build_object('review_bucket', 'admin'),
       'page not verified against the PDF text (page_verified is not true) and no trusted crop; review_bucket kid -> admin'
from back b;

commit;
