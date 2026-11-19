-- Admin paper edit must never open or verify an English RESCUE copy.
--
-- 20260928190000 (W14) added one extra live_copy audit paper per English
-- bank paper (meta_source.role = 'rescue') holding the questions hidden on
-- the site. It is newer than the paper's real working copy, and both
-- admin_paper_draft and admin_verify_paper picked "the newest live_copy", so
-- for all 736 English papers the edit page showed the hidden questions and
-- Verify would have force-passed every one of them -- which the rescue
-- trigger would then have published, unchecked. Found by the website/DB gap
-- audit, 2026-09-28; no admin had used either function yet (audit_review_log
-- has no admin_verify_paper / admin_draft_edit rows).
--
-- Fix: both skip role = 'rescue'. Rescue questions reach the site only
-- through a checker pass (checker_next_question serves them; unchanged).
-- Everything else in both functions is byte-identical to 20260928170000.

begin;

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
        and coalesce(a.meta_source ->> 'role', '') <> 'rescue'
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
    and coalesce(a.meta_source ->> 'role', '') <> 'rescue'
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
