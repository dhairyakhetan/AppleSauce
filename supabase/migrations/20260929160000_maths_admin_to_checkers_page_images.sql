-- NOT APPLIED. Written 2026-09-29 for the owner to review, dry-run and apply.
--
-- Owner decision 2026-09-29 (note 19, round 9): the Maths admin pile goes to
-- STUDENT checkers, and where no trusted crop exists the checker is shown the
-- WHOLE PDF PAGE of the question, as scanned. The checker screen for that is
-- in src/pages/Checker.tsx + src/lib/checker-page.ts. This migration is the
-- database half: a registry of which page images exist, and the routing.
--
-- WHY A RECLASSIFY AND NOT A PATCH OF checker_next_question
-- ---------------------------------------------------------
-- checker_next_question() only serves review_bucket = 'kid'. Widening ITS
-- filter to also serve 'admin' would not be enough, and would be wrong:
--   * checker_authorize_question() (the gate behind pass / fix / split /
--     skip / ask for help) refuses any row whose bucket is not 'kid'
--     ("This question is not routed to the paper checker"), so a served
--     admin row could never be saved. checker_split_question,
--     checker_queue_facets, admin_paper_progress, admin_verify_paper and
--     admin_resolve_escalation also name 'kid'. Six functions to patch, each
--     a chance to break the lease/skip rules.
--   * "Ask for help" moves a row to 'escalated'. With a widened filter the
--     admin pile and the checker pile would be one pile and there would be
--     no way to tell an untouched admin row from one a checker gave up on.
-- Moving the ROW (admin -> kid) keeps every one of those functions, the
-- lease (10 minutes), the 24 h skip, the English exclusion and the
-- ordering exactly as they are today, and every move is logged in
-- audit_review_log in the same shape as the 2026-09-29 blank-marks
-- reclassify, so it is undone the same way (see UNDO below).
-- checker_next_question is therefore deliberately NOT touched here.
--
-- WHAT THIS MIGRATION DOES (nothing moves until the function is CALLED)
-- ---------------------------------------------------------------------
-- 1. public.audit_paper_pages: one row per page image that exists in the
--    private audit-figures bucket at pages/<audit_paper_id>/<page>.jpg
--    (page 1-based, as in audit_questions.source.page). RLS on, no grant to
--    anon or authenticated: only the uploader (service role) writes it and
--    only the routing function below reads it. The checker screen does not
--    read it; it builds the path from question.paper_id + source.page and
--    asks Storage for a signed URL, and a missing file simply falls back to
--    today's "no picture, check the words only" note.
-- 2. public.route_maths_admin_to_checkers(p_apply boolean default false,
--    p_skip_reasons text[] default ...): moves OPEN Maths questions from
--    'admin' to 'kid' when (a) the paper is live_copy or new_ocr, (b) the
--    question has words, is not red, and is not English, (c) a page image is
--    registered for the page the question says it is on, and (d) it does not
--    carry a reason that stays with admins: possible_duplicate (owner
--    2026-09-30), ocr_dropout, script_unsupported (GUARDRAILS #34),
--    board_class_mismatch (a mis-filed paper). These four are hard-coded; p_skip_reasons can only ADD to them. p_apply=false only counts. Callable by the
--    database owner / service role only (revoked from public, anon,
--    authenticated, by role name, per CLAUDE.md).
--
-- STORAGE, NO NEW BUCKET
-- ----------------------
-- Verified live 2026-09-29: audit-figures is private, 5 MB per object,
-- image/png|jpeg|webp allowed, and its only read policy is "paper checkers
-- and admins can read audit figures" (bucket_id = 'audit-figures' and
-- (is_admin() or is_paper_checker())). That policy covers pages/... as it
-- is, so no storage policy changes and nothing is made public.
--
-- MEASURED LIVE 2026-09-29 (read-only), why the numbers are small at first
-- ------------------------------------------------------------------------
-- Open Maths admin-pile questions on live_copy / new_ocr papers with words:
-- 1,185 across 374 papers. Only 151 of them record source.page (43 papers),
-- and only 73 of the 374 papers have a pdf_path at all. A page image needs
-- both a PDF and a page number, so until the pipeline's content match fills
-- source.page and pdf_path (design note 20, section 5) the routable set is
-- at most 151 questions. The migration never guesses a page.
--
-- UNDO (same shape as reclassify_missing_marks_2026-09-29_undo.sql)
-- -----------------------------------------------------------------
--   update public.audit_questions aq set review_bucket = 'admin'
--   from public.audit_review_log l
--   where l.question_id = aq.id and l.action = 'reclassify'
--     and l.note like '%route_maths_admin_to_checkers%'
--     and aq.review_bucket = 'kid' and aq.question_passed = false;
--   (only rows a checker has not yet passed; a passed row stays passed.)
--
-- UPLOADER (described, not written here; runs on the UnlimitedOCR side)
-- ---------------------------------------------------------------------
-- For each audit paper that has pdf_path and at least one open Maths admin
-- question with source.page: render each needed page with
-- paper_worker.render_page at 110 dpi (a whole A4 page is about 900 x 1300
-- px; JPEG quality 80 keeps it near 200 KB, far under the 5 MB limit and
-- readable when zoomed), save unaltered otherwise ("as scanned": no
-- cropping, no cleanup), upload to audit-figures at
-- pages/<audit_paper_id>/<page>.jpg with Content-Type image/jpeg using the
-- same Storage class, private-bucket assert and storage cap as
-- pipeline/upload_snippets.py, and only then upsert
-- (audit_paper_id, page, object_path) into audit_paper_pages, so a row
-- never names a file that is not there. Then run
--   select * from public.route_maths_admin_to_checkers(false);  -- look
--   select * from public.route_maths_admin_to_checkers(true);   -- move

begin;

-- ============================================================
-- 1. The registry of page images.
-- ============================================================

create table if not exists public.audit_paper_pages (
  audit_paper_id uuid not null references public.audit_papers(id) on delete cascade,
  page integer not null check (page >= 1 and page <= 999),
  object_path text not null,
  created_at timestamptz not null default now(),
  primary key (audit_paper_id, page),
  -- the site derives this exact path; a row that disagrees would be a lie
  constraint audit_paper_pages_path_shape
    check (object_path = 'pages/' || audit_paper_id::text || '/' || page::text || '.jpg')
);

alter table public.audit_paper_pages enable row level security;
-- No policy on purpose: with RLS on and no policy, anon and authenticated
-- read nothing. Revoke the table grants as well (Supabase default-grants
-- them by role name, the same trap as functions).
revoke all on table public.audit_paper_pages from public, anon, authenticated;

comment on table public.audit_paper_pages is
  'Page images in the private audit-figures bucket (pages/<audit_paper_id>/<page>.jpg, page 1-based). Written by the uploader with the service role; read only by route_maths_admin_to_checkers().';

-- ============================================================
-- 2. The routing. Counts unless p_apply is true.
-- ============================================================

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
    -- Hard exclusions a caller cannot override (owner 2026-09-30: duplicates
    -- stay with admin; GUARDRAILS #34: dropout and unsupported script too).
    -- board_class_mismatch too: a mis-filed paper is an admin call (review 2026-09-29).
    and not (coalesce(aq.flag_reasons, array[]::text[])
             && array['possible_duplicate', 'ocr_dropout', 'script_unsupported', 'board_class_mismatch'])
    and not (coalesce(aq.flag_reasons, array[]::text[]) && coalesce(p_skip_reasons, array[]::text[]))
    and (aq.source ->> 'page') ~ '^[0-9]{1,3}$'
    and exists (
      select 1 from public.audit_paper_pages pg
      where pg.audit_paper_id = aq.paper_id
        -- guarded cast: AND order is not guaranteed, so never cast a non-number
        and pg.page = case when (aq.source ->> 'page') ~ '^[0-9]{1,3}$'
                           then (aq.source ->> 'page')::integer end
    );

  if p_apply and coalesce(array_length(v_ids, 1), 0) > 0 then
    with moved_rows as (
      update public.audit_questions aq
      set review_bucket = 'kid'
      where aq.id = any(v_ids)
        and aq.review_bucket = 'admin'
        and aq.question_passed = false
        -- re-check the hard exclusions in case a flag was added since the snapshot
        and not (coalesce(aq.flag_reasons, array[]::text[])
                 && array['possible_duplicate', 'ocr_dropout', 'script_unsupported', 'board_class_mismatch'])
      returning aq.id, aq.paper_id
    ), logged as (
      insert into public.audit_review_log
        (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
      select null, null, m.paper_id, m.id, 'reclassify', 'review_bucket',
             jsonb_build_object('review_bucket', 'admin'),
             jsonb_build_object('review_bucket', 'kid'),
             'owner-decision-2026-09-29 route_maths_admin_to_checkers: page image registered; review_bucket admin -> kid'
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
-- anon and authenticated). Only the database owner / service role runs it.
revoke all on function public.route_maths_admin_to_checkers(boolean, text[]) from public, anon, authenticated;

commit;
