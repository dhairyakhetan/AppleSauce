-- Admin paper edit page -- W12.
--
-- Owner: "paper edit button should open a paper edit page where the paper is
-- loaded and text can be edited and saved automatically and then verify
-- button verifies it all". Decisions: edits autosave into the DRAFT (the
-- live_copy working copy in audit_papers/audit_questions); readers see
-- nothing until Verify; Verify is admin-only.
--
-- Three admin RPCs:
--   admin_paper_draft(p_paper_id text)          read the whole draft
--   admin_save_draft_question(...)              autosave one question
--   admin_verify_paper(p_paper_id text)         pass every question, publish
--
-- WHY EDITS NEVER TOUCH bank_questions HERE. The chokepoint
-- apply_live_copy_paper_to_live() copies audit_questions onto bank_questions
-- whenever audit_papers.paper_passed flips true. An edit written straight to
-- bank_questions would be overwritten by the older draft text on the next
-- flip. So every edit lands in audit_questions, and Verify is what carries
-- it to readers, through the same chokepoint every checker/AI decision uses
-- (byte-exact: it only writes a field that differs, and logs each write in
-- bank_question_revisions so it can be undone from the History dialog).
--
-- WHICH DRAFT. A live paper's working copy is the most recently created
-- audit_papers row with source = 'live_copy' and live_bank_paper_id = the
-- bank_papers id. All three functions pick it the same way.
--
-- Lockdown per CLAUDE.md's trap: SECURITY DEFINER, search_path pinned,
-- is_admin() checked in the body (raises 42501), EXECUTE revoked from
-- public, anon AND authenticated by name, then granted to authenticated only.
--
-- Idempotent: CREATE OR REPLACE throughout.

begin;

-- ============================================================
-- 1. admin_paper_draft: the whole paper, in reading order.
--    Always returns at least one row when the bank paper exists: the paper
--    columns are repeated on every row, and the question columns are null
--    when there is no working copy yet (or it has no rows), so the page can
--    still name the paper and say why there is nothing to edit.
--    Zero rows = no such bank paper.
-- ============================================================
create or replace function public.admin_paper_draft(p_paper_id text)
returns table (
  paper_id text, school text, subject text, cls text, board text, year text, exam text,
  needs_review boolean, is_published boolean, incomplete_note text,
  general_instructions text, allowed_time_minutes integer,
  audit_paper_id uuid, paper_passed boolean, is_red boolean, red_reason text,
  question_id uuid, ord int, kind text, parent_id uuid, number_path text,
  display_number text, body text, options jsonb, marks numeric, instructions text,
  question_passed boolean, status text, review_bucket text,
  flag_reasons text[], flag_detail text, source jsonb,
  live_bank_question_id text, updated_at timestamptz
)
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select bp.id, bp.school, bp.subject, bp.cls, bp.board, bp.year, bp.exam,
           bp.needs_review, bp.is_published, bp.incomplete_note,
           bp.general_instructions, bp.allowed_time_minutes,
           ap.id, ap.paper_passed, ap.is_red, ap.red_reason,
           aq.id, aq.ord, aq.kind, aq.parent_id, aq.number_path,
           aq.display_number, aq.body, aq.options, aq.marks, aq.instructions,
           aq.question_passed, aq.status, aq.review_bucket,
           aq.flag_reasons, aq.flag_detail, aq.source,
           aq.live_bank_question_id, aq.updated_at
    from public.bank_papers bp
    left join lateral (
      select a.id, a.paper_passed, a.is_red, a.red_reason
      from public.audit_papers a
      where a.source = 'live_copy' and a.live_bank_paper_id = bp.id
      order by a.created_at desc
      limit 1
    ) ap on true
    left join public.audit_questions aq on aq.paper_id = ap.id
    where bp.id = p_paper_id
    order by aq.ord nulls last;
end;
$function$;

revoke all on function public.admin_paper_draft(text) from public, anon, authenticated;
grant execute on function public.admin_paper_draft(text) to authenticated;

-- ============================================================
-- 2. admin_save_draft_question: one autosave.
--
--    The client sends the full state of the three editable fields (body,
--    display number, marks) plus the body it last loaded or saved. If the
--    stored body no longer matches p_body_before, someone else (a checker,
--    the AI, another admin tab) changed it in between: refuse with 40001 so
--    the page reloads that question instead of silently overwriting it.
--
--    Text is stored exactly as sent. Nothing here trims, re-cases or cleans
--    it (CLAUDE.md: question text is never altered by the system; the admin
--    typing a correction is the one sanctioned way it changes).
--
--    Deliberately left alone:
--      * status / question_passed. Verify is the one step that passes rows.
--        Un-passing on edit would hand the row back to the Kid Mode queue,
--        where a checker could pass it and publish the paper without the
--        admin's Verify.
--      * checked_by (the AI's record). checked_by_user is set to the admin,
--        which is that column's documented meaning ("most recently acted").
--    Only kind = 'question' rows are editable: the chokepoint copies nothing
--    else to the live paper, so an edit to an instruction row would look
--    saved and never reach readers.
-- ============================================================
create or replace function public.admin_save_draft_question(
  p_question_id uuid,
  p_body text,
  p_display_number text,
  p_marks numeric,
  p_body_before text
)
returns table (id uuid, body text, display_number text, marks numeric, updated_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_before public.audit_questions;
  v_source text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_before from public.audit_questions q where q.id = p_question_id for update;
  if v_before.id is null then
    raise exception 'Question not found' using errcode = 'P0002';
  end if;

  select ap.source into v_source from public.audit_papers ap where ap.id = v_before.paper_id;
  if v_source is distinct from 'live_copy' then
    raise exception 'This question is not part of a live paper draft' using errcode = '22023';
  end if;

  if v_before.kind <> 'question' then
    raise exception 'Only questions can be edited here' using errcode = '22023';
  end if;

  if p_body is null or btrim(p_body) = '' then
    raise exception 'Question text cannot be blank' using errcode = '22023';
  end if;

  if p_marks is not null and p_marks < 0 then
    raise exception 'Marks cannot be negative' using errcode = '22023';
  end if;

  if v_before.body is distinct from p_body_before then
    raise exception 'This question was changed by someone else' using errcode = '40001';
  end if;

  -- Nothing changed: no write, no log row, just echo the stored state.
  if v_before.body is not distinct from p_body
     and v_before.display_number is not distinct from p_display_number
     and v_before.marks is not distinct from p_marks then
    return query select v_before.id, v_before.body, v_before.display_number, v_before.marks, v_before.updated_at;
    return;
  end if;

  update public.audit_questions q
  set body = p_body,
      display_number = p_display_number,
      marks = p_marks,
      checked_by_user = auth.uid()
  where q.id = p_question_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after)
  values (null, auth.uid(), v_before.paper_id, p_question_id, 'admin_draft_edit', null,
          jsonb_build_object('body', v_before.body, 'display_number', v_before.display_number, 'marks', v_before.marks),
          jsonb_build_object('body', p_body, 'display_number', p_display_number, 'marks', p_marks));

  return query
    select q.id, q.body, q.display_number, q.marks, q.updated_at
    from public.audit_questions q where q.id = p_question_id;
end;
$function$;

revoke all on function public.admin_save_draft_question(uuid, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.admin_save_draft_question(uuid, text, text, numeric, text) to authenticated;

-- ============================================================
-- 3. admin_verify_paper: "verifies it all".
--
--    For the working copy of this live paper:
--      a. every kind = 'question' row -> status 'passed', question_passed
--         true, checked_by_user = the admin, lease cleared.
--         review_bucket: 'escalated' becomes 'kid', every other bucket is
--         left as it was. DECISION: an admin verifying the paper IS the
--         admin resolving any open "ask for help", and
--         admin_resolve_escalation() already moves a resolved row from
--         'escalated' to 'kid'; doing the same keeps one meaning for the
--         bucket. The other buckets ('admin', 'data', 'renderer', 'none')
--         record why the AI routed a row, which is history worth keeping,
--         and nothing reads them once a row is passed.
--      b. one 'admin_verify_paper' row in audit_review_log.
--      c. paper_passed ends true in a way that FIRES the chokepoint trigger
--         (it only fires on a false -> true flip): turned off first when it
--         was already on, then back on. Usually step (a) turns it back on by
--         itself through audit_sync_paper_status(); when the AI marked the
--         paper red (a non-question row still 'red'), that sync keeps it off,
--         so it is set explicitly. The admin was shown the red reason in the
--         confirmation before choosing to verify.
--    The chokepoint then copies the draft onto bank_questions (only fields
--    that differ, each logged and undoable) and clears needs_review.
--
--    Returns what happened, so the page can say "live" or exactly why not.
-- ============================================================
create or replace function public.admin_verify_paper(p_paper_id text)
returns table (
  audit_paper_id uuid, questions_total int, questions_newly_passed int,
  is_live boolean, needs_review boolean, is_published boolean,
  skipped_count int, unplaced_count int, not_on_live_count int, reason text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ap public.audit_papers;
  v_total int;
  v_unpassed int;
  v_unpassed_ids jsonb;
  v_now_passed boolean;
  v_bp record;
  v_skipped int;
  v_unplaced int;
  v_not_on_live int;
  v_reason text;
  v_live boolean;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select a.* into v_ap
  from public.audit_papers a
  where a.source = 'live_copy' and a.live_bank_paper_id = p_paper_id
  order by a.created_at desc
  limit 1
  for update;

  if v_ap.id is null then
    raise exception 'This paper has no working copy yet' using errcode = 'P0002';
  end if;

  select count(*) filter (where q.kind = 'question'),
         count(*) filter (where q.kind = 'question' and not q.question_passed),
         coalesce(jsonb_agg(q.id) filter (where q.kind = 'question' and not q.question_passed), '[]'::jsonb)
    into v_total, v_unpassed, v_unpassed_ids
  from public.audit_questions q
  where q.paper_id = v_ap.id;

  if v_total = 0 then
    raise exception 'This paper has no questions to verify' using errcode = '22023';
  end if;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
  values (null, auth.uid(), v_ap.id, null, 'admin_verify_paper', null,
          jsonb_build_object('paper_passed', v_ap.paper_passed, 'is_red', v_ap.is_red,
                             'unpassed_questions', v_unpassed, 'unpassed_ids', v_unpassed_ids),
          jsonb_build_object('paper_passed', true, 'questions', v_total),
          'live paper ' || p_paper_id);

  -- (c) part 1: arm the trigger.
  update public.audit_papers a set paper_passed = false
  where a.id = v_ap.id and a.paper_passed;

  -- (a)
  update public.audit_questions q
  set status = 'passed',
      question_passed = true,
      checked_by_user = auth.uid(),
      review_bucket = case when q.review_bucket = 'escalated' then 'kid' else q.review_bucket end,
      locked_by = null,
      locked_until = null
  where q.paper_id = v_ap.id and q.kind = 'question';

  -- (c) part 2: if the status sync did not turn it back on (red paper), do it.
  select a.paper_passed into v_now_passed from public.audit_papers a where a.id = v_ap.id;
  if v_now_passed is distinct from true then
    update public.audit_papers a set paper_passed = true where a.id = v_ap.id;
  end if;

  -- What the chokepoint did, read back inside this same transaction.
  -- audit_review_log.at defaults to now(), which is the transaction start,
  -- so `at = now()` is exactly the rows written by this call.
  select count(*) into v_skipped
  from public.audit_review_log l
  where l.paper_id = v_ap.id and l.action = 'live_apply' and l.at = now()
    and l.note like 'skipped:%';

  select count(*) filter (where q.live_bank_question_id is null and q.split_from_id is not null),
         count(*) filter (where q.live_bank_question_id is null and q.split_from_id is null)
    into v_unplaced, v_not_on_live
  from public.audit_questions q
  where q.paper_id = v_ap.id and q.kind = 'question';

  select b.needs_review, b.is_published into v_bp from public.bank_papers b where b.id = p_paper_id;

  if v_bp is null then
    v_live := false;
    v_reason := 'The live paper no longer exists.';
  elsif v_bp.needs_review then
    v_live := false;
    if v_skipped > 0 then
      v_reason := v_skipped || ' question(s) could not be matched to the live paper, so it still needs review.';
    elsif v_unplaced > 0 then
      v_reason := v_unplaced || ' split question(s) could not be placed on the live paper yet, so it still needs review.';
    else
      v_reason := 'The paper still needs review.';
    end if;
  elsif not v_bp.is_published then
    v_live := false;
    v_reason := 'Verified, but the paper is hidden. Restore it to show it to readers.';
  else
    v_live := true;
    v_reason := case when v_not_on_live > 0
      then v_not_on_live || ' question(s) in the draft have no live row and were not published.'
      else null end;
  end if;

  return query select v_ap.id, v_total, v_unpassed, v_live,
                      coalesce(v_bp.needs_review, true), coalesce(v_bp.is_published, false),
                      v_skipped, v_unplaced, v_not_on_live, v_reason;
end;
$function$;

revoke all on function public.admin_verify_paper(text) from public, anon, authenticated;
grant execute on function public.admin_verify_paper(text) to authenticated;

commit;

-- ============================================================
-- Audit after applying (CLAUDE.md's recipe, never a proacl string match):
--
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
--          p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('admin_paper_draft', 'admin_save_draft_question', 'admin_verify_paper');
--
-- Expected: anon_exec false, auth_exec true, prosecdef true for all three.
-- ============================================================
