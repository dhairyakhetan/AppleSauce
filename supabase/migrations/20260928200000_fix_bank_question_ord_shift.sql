-- Fix: every split / insert on a LIVE paper failed with 23505.
--
-- public.bank_questions carries UNIQUE (paper_id, ord)
-- (bank_questions_paper_id_ord_key), and it is NOT DEFERRABLE (confirmed
-- read-only against pg_constraint on 2026-09-28: condeferrable = false).
-- A non-deferrable unique is checked row by row as the UPDATE walks the
-- heap, so
--     update bank_questions set ord = ord + 1 where paper_id = x and ord > y
-- moves row y+1 onto y+2 while row y+2 still sits there, and aborts with
-- 23505 whenever the heap order is not the reverse of ord (i.e. almost
-- always). Three functions from 20260928000000 did exactly that:
--   * apply_live_copy_paper_to_live  (chokepoint, pass 1: placing a
--                                      checker split half on the live paper)
--   * admin_split_bank_question
--   * admin_add_bank_question
--
-- The fix is a two-step shift inside the same statement pair:
--   1. set ord = -(ord + 1) for the tail (ord > y)  -> all land below zero
--   2. set ord = -ord       for ord < 0             -> back up, one higher
-- Neither step can collide: ord is never negative on live (min 0, checked
-- 2026-09-28), so step 1 writes into an empty range, and step 2's targets
-- (>= y+2) are above every untouched row (<= y) and never negative.
-- Both steps sit under the paper-scoped advisory lock each function already
-- takes, in one transaction, so no reader ever sees a negative ord.
--
-- Not affected, checked:
--   * checker_split_question shifts audit_questions.ord, and audit_questions
--     has no unique on (paper_id, ord) (only its primary key).
--   * admin_reorder_bank_questions already parks each row at ord + 100000
--     one row at a time before renumbering.
--   * No other migration shifts bank_questions.ord.
--
-- Every other line of each function is byte-identical to the live
-- definition (prosrc md5 compared on 2026-09-28 before writing this).
-- CREATE OR REPLACE keeps owner and the existing COMMENT; grants are
-- restated exactly as 20260928000000 set them. Re-running is harmless.

create or replace function public.apply_live_copy_paper_to_live(p_audit_paper_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_paper record;
  v_q record;
  v_parent record;
  v_actor text;
  v_actor_user_id uuid;
  v_source text;
  v_total int;
  v_passed int;
  v_before jsonb;
  v_live_paper_id text;
  v_parent_ord int;
  v_new_live_id text;
  v_new_row jsonb;
  v_any_mismatch boolean := false;
  v_any_unplaced boolean := false;
begin
  select * into v_paper from public.audit_papers where id = p_audit_paper_id;
  if v_paper is null or v_paper.source <> 'live_copy' or v_paper.live_bank_paper_id is null then
    return; -- nothing to apply for a new_ocr paper or an unmatched live paper
  end if;
  v_live_paper_id := v_paper.live_bank_paper_id;

  -- Paper-scoped advisory lock (second review, MEDIUM #3): serializes this
  -- chokepoint against admin_split_bank_question / admin_reorder_bank_questions
  -- / admin_merge_bank_questions / admin_add_bank_question /
  -- admin_delete_bank_question for the SAME live paper, all of which shift
  -- bank_questions.ord. Confirmed live (read-only select against pg_constraint,
  -- 2026-09-28): bank_questions has UNIQUE (paper_id, ord)
  -- (constraint bank_questions_paper_id_ord_key) -- two ord-shifting writers
  -- racing on one paper without this lock could violate it mid-transaction.
  perform pg_advisory_xact_lock(hashtext(v_live_paper_id));

  -- ---- Pass 1: split halves that have no live row yet (fix #3) --------
  -- A row created by checker_split_question has live_bank_question_id
  -- null and split_from_id pointing at its sibling. Insert it into
  -- bank_questions right after the sibling's live row, numbered as
  -- printed, and record its new id on the audit row so pass 2 below (and
  -- every future run) can apply further edits to it like any other row.
  for v_q in
    select * from public.audit_questions
    where paper_id = p_audit_paper_id
      and kind = 'question'
      and question_passed = true
      and live_bank_question_id is null
      and split_from_id is not null
  loop
    v_actor := coalesce(v_q.checked_by, v_q.checked_by_user::text, 'unknown-checker');
    v_actor_user_id := case when v_q.checked_by is null then v_q.checked_by_user else null end;
    v_source := case when v_q.checked_by is null then 'checker' else 'ai' end;

    select * into v_parent from public.audit_questions where id = v_q.split_from_id;
    if v_parent is null or v_parent.live_bank_question_id is null then
      -- The sibling itself has no live row yet either (not applied yet, or
      -- was never a live_copy row) -- try again on a future run.
      v_any_unplaced := true;
      continue;
    end if;

    select ord into v_parent_ord from public.bank_questions
      where id = v_parent.live_bank_question_id and paper_id = v_live_paper_id;
    if v_parent_ord is null then
      -- Scoping guard (fix #4): the sibling's live_bank_question_id does not
      -- belong to this paper. Record and move on without touching anything.
      insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
      values (null, v_actor_user_id, p_audit_paper_id, v_q.id, 'live_apply',
              'skipped: split sibling''s live row is not in paper ' || v_live_paper_id);
      v_any_mismatch := true;
      continue;
    end if;

    -- Fix (HIGH #1, second review): extract(epoch from now()) is constant
    -- within one transaction, so two splits of the SAME parent applied in the
    -- same chokepoint call generated the identical id and the second insert
    -- hit the live primary key (23505), aborting the whole chokepoint and
    -- leaving the paper stuck. Derive the id from the split audit row's own
    -- uuid instead, which is unique per split by construction.
    v_new_live_id := v_parent.live_bank_question_id || '-s-' || left(replace(v_q.id::text, '-', ''), 12);

    if exists (select 1 from public.bank_questions where id = v_new_live_id and paper_id = v_live_paper_id) then
      -- Idempotency: a previous run already created this live row (e.g. it
      -- crashed after the insert below but before recording it on the audit
      -- row). Point the audit row at it and move on without re-shifting ord
      -- or re-inserting.
      update public.audit_questions set live_bank_question_id = v_new_live_id where id = v_q.id;
      continue;
    end if;

    -- Two-step shift (20260928200000): see the header of that migration.
    update public.bank_questions set ord = -(ord + 1)
      where paper_id = v_live_paper_id and ord > v_parent_ord;
    update public.bank_questions set ord = -ord
      where paper_id = v_live_paper_id and ord < 0;

    insert into public.bank_questions (id, paper_id, ord, number, display_number, body, marks, chapter, qtype, page, figure, options)
    values (v_new_live_id, v_live_paper_id, v_parent_ord + 1, v_q.display_number, v_q.display_number,
            v_q.body, v_q.marks, v_parent.chapter, null, null, null, null);

    update public.audit_questions set live_bank_question_id = v_new_live_id where id = v_q.id;

    select to_jsonb(bq.*) into v_new_row from public.bank_questions bq where bq.id = v_new_live_id;
    insert into public.bank_question_revisions
      (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
    values ('bank_questions', v_new_live_id, 'live_apply', null, null, v_new_row, v_actor, v_actor_user_id, v_source,
            p_audit_paper_id, v_q.id);
  end loop;

  -- ---- Pass 2: field-level diffs on every question that now has a live
  --      target, scoped to this paper (fix #4) ---------------------------
  for v_q in
    select * from public.audit_questions
    where paper_id = p_audit_paper_id
      and kind = 'question'
      and question_passed = true
      and live_bank_question_id is not null
  loop
    v_actor := coalesce(v_q.checked_by, v_q.checked_by_user::text, 'unknown-checker');
    v_actor_user_id := case when v_q.checked_by is null then v_q.checked_by_user else null end;
    v_source := case when v_q.checked_by is null then 'checker' else 'ai' end;

    select to_jsonb(bq.*) into v_before from public.bank_questions bq
      where bq.id = v_q.live_bank_question_id and bq.paper_id = v_live_paper_id;
    if v_before is null then
      -- Either the live row no longer exists, or (scoping guard, fix #4) it
      -- belongs to a different paper than this audit row claims. Either
      -- way: never write, log it, and don't let this paper's needs_review
      -- clear below.
      insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
      values (null, v_actor_user_id, p_audit_paper_id, v_q.id, 'live_apply',
              'skipped: live_bank_question_id ' || coalesce(v_q.live_bank_question_id, 'null') ||
              ' not found in paper ' || v_live_paper_id);
      v_any_mismatch := true;
      continue;
    end if;

    -- body: only write when it actually differs (byte-exact rule).
    if v_q.body is distinct from (v_before->>'body') then
      update public.bank_questions set body = v_q.body
        where id = v_q.live_bank_question_id and paper_id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
      values ('bank_questions', v_q.live_bank_question_id, 'live_apply', 'body',
              to_jsonb(v_before->>'body'), to_jsonb(v_q.body), v_actor, v_actor_user_id, v_source,
              p_audit_paper_id, v_q.id);
    end if;

    if v_q.display_number is distinct from (v_before->>'display_number') then
      update public.bank_questions set display_number = v_q.display_number
        where id = v_q.live_bank_question_id and paper_id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
      values ('bank_questions', v_q.live_bank_question_id, 'live_apply', 'display_number',
              to_jsonb(v_before->>'display_number'), to_jsonb(v_q.display_number), v_actor, v_actor_user_id, v_source,
              p_audit_paper_id, v_q.id);
    end if;

    if v_q.marks is distinct from ((v_before->>'marks')::numeric) then
      update public.bank_questions set marks = v_q.marks
        where id = v_q.live_bank_question_id and paper_id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
      values ('bank_questions', v_q.live_bank_question_id, 'live_apply', 'marks',
              to_jsonb((v_before->>'marks')::numeric), to_jsonb(v_q.marks), v_actor, v_actor_user_id, v_source,
              p_audit_paper_id, v_q.id);
    end if;

    if v_q.answer_key is distinct from (v_before->>'answer_key') then
      update public.bank_questions set answer_key = v_q.answer_key
        where id = v_q.live_bank_question_id and paper_id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
      values ('bank_questions', v_q.live_bank_question_id, 'live_apply', 'answer_key',
              to_jsonb(v_before->>'answer_key'), to_jsonb(v_q.answer_key), v_actor, v_actor_user_id, v_source,
              p_audit_paper_id, v_q.id);
    end if;
  end loop;

  -- ---- Clear needs_review only when every question is passed AND every
  --      passed question has a live target AND nothing was skipped for a
  --      scope mismatch (fix #3 + fix #4) -------------------------------
  select count(*) filter (where kind = 'question'),
         count(*) filter (where kind = 'question' and question_passed)
    into v_total, v_passed
  from public.audit_questions
  where paper_id = p_audit_paper_id;

  if v_total > 0 and v_total = v_passed and not v_any_mismatch and not v_any_unplaced then
    select to_jsonb(bp.*) into v_before from public.bank_papers bp where bp.id = v_live_paper_id;
    if v_before is not null and (v_before->>'needs_review')::boolean is distinct from false then
      update public.bank_papers set needs_review = false where id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, source, audit_paper_id)
      values ('bank_papers', v_live_paper_id, 'live_clear', 'needs_review',
              to_jsonb(true), to_jsonb(false), 'system:chokepoint', 'system', p_audit_paper_id);
    end if;
  end if;
end;
$function$;

revoke all on function public.apply_live_copy_paper_to_live(uuid) from public, anon, authenticated;

create or replace function public.admin_split_bank_question(p_question_id text, p_split_at int)
returns table (first_id text, second_id text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_q public.bank_questions;
  v_first text;
  v_second text;
  v_new_id text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_q from public.bank_questions where id = p_question_id;
  if v_q.id is null then
    raise exception 'Question not found';
  end if;
  -- Second review, MEDIUM #3: paper-scoped advisory lock.
  perform pg_advisory_xact_lock(hashtext(v_q.paper_id));

  if p_split_at is null or p_split_at <= 0 or p_split_at >= length(v_q.body) then
    raise exception 'Split point out of range';
  end if;

  v_first := left(v_q.body, p_split_at);
  v_second := substring(v_q.body from p_split_at + 1);
  v_new_id := v_q.id || '-split-' || replace(gen_random_uuid()::text, '-', '');

  -- Two-step shift (20260928200000): see the header of that migration.
  update public.bank_questions set ord = -(ord + 1) where paper_id = v_q.paper_id and ord > v_q.ord;
  update public.bank_questions set ord = -ord where paper_id = v_q.paper_id and ord < 0;
  update public.bank_questions set body = v_first where id = p_question_id;
  insert into public.bank_questions (id, paper_id, ord, number, body, marks, chapter, qtype, page, figure, options)
  values (v_new_id, v_q.paper_id, v_q.ord + 1, null, v_second, null, v_q.chapter, v_q.qtype, v_q.page, null, null);

  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source)
  values ('bank_questions', p_question_id, 'admin_split', 'body', to_jsonb(v_q.body),
          jsonb_build_object('first_id', p_question_id, 'second_id', v_new_id), auth.uid()::text, auth.uid(), 'admin');

  return query select p_question_id, v_new_id;
end;
$function$;

revoke all on function public.admin_split_bank_question(text, int) from public, anon, authenticated;
grant execute on function public.admin_split_bank_question(text, int) to authenticated;

create or replace function public.admin_add_bank_question(
  p_paper_id text, p_after_ord int, p_body text, p_marks numeric, p_display_number text
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new_id text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- Second review, MEDIUM #3: paper-scoped advisory lock.
  perform pg_advisory_xact_lock(hashtext(p_paper_id));

  v_new_id := p_paper_id || '-add-' || replace(gen_random_uuid()::text, '-', '');
  -- Two-step shift (20260928200000): see the header of that migration.
  update public.bank_questions set ord = -(ord + 1) where paper_id = p_paper_id and ord > p_after_ord;
  update public.bank_questions set ord = -ord where paper_id = p_paper_id and ord < 0;
  insert into public.bank_questions (id, paper_id, ord, body, marks, display_number)
  values (v_new_id, p_paper_id, p_after_ord + 1, coalesce(p_body, ''), p_marks, p_display_number);

  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source)
  values ('bank_questions', v_new_id, 'admin_add', null, null,
          jsonb_build_object('paper_id', p_paper_id, 'body', p_body, 'marks', p_marks), auth.uid()::text, auth.uid(), 'admin');

  return v_new_id;
end;
$function$;

revoke all on function public.admin_add_bank_question(text, int, text, numeric, text) from public, anon, authenticated;
grant execute on function public.admin_add_bank_question(text, int, text, numeric, text) to authenticated;
