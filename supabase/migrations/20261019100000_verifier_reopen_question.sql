-- 20261019100000: verifier_reopen_question -- let a verifier open a question they already marked Done and edit it again.
--
-- Owner, 19 Oct 2026: "when i am on a paper that is assigned to me as a checker give me option edit old questions
-- i marked as correct as well".
--
-- What this adds, and nothing else: ONE new function and one history word. No existing function is changed.
--
--   verifier_reopen_question(p_question_id uuid) returns the SAME row shape as verifier_next_in_paper
--   It puts a Done question back to "to verify", leased to the caller for 10 minutes, and returns it so the verify
--   screen can show it. From there the caller saves it through the ordinary verdict functions (Looks right =
--   checker_pass_locked, Fix it = checker_fix_locked, through verifier_verdict_and_next). Those are the versioned fix
--   path: a changed wording is a new version, the old words stay in content_versions, so nothing here bypasses it.
--   This function never touches body, display_number or marks.
--
-- Who may reopen (each refusal is a sentence a verifier can read):
--   * a paper checker (42501 otherwise), who holds the question's paper through a checker_assignments row in status
--     queued, assigned or done (42501 otherwise, the same gate as verifier_paper_questions);
--   * the question is a real question that is Done (question_passed) and still routed to verifiers (bucket 'kid'),
--     not set aside, not with the HOD (22023);
--   * it was passed by the caller or by no person (the AI / pipeline); a question another person passed is theirs (22023);
--   * nobody else has it open right now (22023);
--   * the paper has not gone for approval or been published, and is not a frozen live_copy paper (22023). This is the
--     same rule verifier_undo_last applies, for the same reason.
--
-- What it does to the row: question_passed = false, status = 'flagged' (so a later Undo of the new Pass restores a
-- sensible state, not 'passed'), checked_by_user = null, locked_by = caller, locked_until = now() + 10 minutes,
-- leased_at = now(). If the caller's assignment was 'done' it opens again, exactly as verifier_undo_last does; if the
-- paper was already given to someone else (unique_violation) the reopen is refused.
--
-- History: one audit_review_log row, action 'verifier_reopen', before/after with the old and new state. The row is
-- written with undone_at set. That is deliberate: it is not a verdict and must not count in any trust meter or total
-- (every counter reads audit_review_log_counted, which leaves undone rows out), and verifier_undo_last picks "the
-- caller's latest action that is not undone", so an open reopen row would otherwise be the thing Undo trips over and
-- refuse with "that step cannot be undone". The row stays in the history pages, which read the real table.
--
-- Known and accepted: if the verifier reopens a question and leaves without saving, it stays "to verify" with its
-- unchanged words and will be served again in order, like any other question. Nothing is lost.
--
-- Grants follow CLAUDE.md: revoke from public, anon AND authenticated by name, then grant to authenticated only.

create or replace function public.verifier_reopen_question(p_question_id uuid)
returns table(id uuid, paper_id uuid, ord integer, display_number text, number_path text, body text,
              options jsonb, marks numeric, instructions text, flag_reasons text[], flag_detail text,
              source jsonb, subject text, school text, cls text, exam text, year text, version integer,
              page integer, page_path text, snippet_path text, raw_ocr text)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_q public.audit_questions;
  v_paper public.audit_papers;
  v_a public.checker_assignments;
begin
  if v_uid is null or not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- One reopen at a time per person, so two clicks cannot race the assignment update.
  perform pg_advisory_xact_lock(hashtext('verifier_reopen_question'), hashtext(v_uid::text));

  select * into v_q from public.audit_questions q where q.id = p_question_id for update;
  if v_q.id is null then
    raise exception 'That question is not on a paper you hold' using errcode = '42501';
  end if;

  select * into v_a
  from public.checker_assignments a
  where a.audit_paper_id = v_q.paper_id and a.user_id = v_uid
    and a.status in ('queued', 'assigned', 'done')
  order by (a.status <> 'done') desc, a.id desc
  limit 1
  for update;
  if v_a.id is null then
    raise exception 'That question is not on a paper you hold' using errcode = '42501';
  end if;

  select * into v_paper from public.audit_papers p where p.id = v_q.paper_id for share;
  if v_paper.source is null or v_paper.source not in ('live_copy', 'new_ocr') then
    raise exception 'This paper is not eligible for checking' using errcode = '42501';
  end if;
  if v_paper.approval_state in ('awaiting', 'approved')
     or (coalesce(v_paper.paper_passed, false) and v_paper.source = 'live_copy') then
    raise exception 'This paper has already gone for approval, so its questions can no longer be edited here. Ask the HOD if something is wrong.'
      using errcode = '22023';
  end if;

  if v_q.kind <> 'question' or not v_q.question_passed then
    raise exception 'That question is not marked Done, so there is nothing to reopen.' using errcode = '22023';
  end if;
  if v_q.set_aside_at is not null or v_q.review_bucket <> 'kid' then
    raise exception 'That question is with the HOD or set aside, so it cannot be reopened here.' using errcode = '22023';
  end if;
  if v_q.checked_by_user is not null and v_q.checked_by_user <> v_uid then
    raise exception 'Someone else marked that question Done, so it cannot be reopened here. Ask the HOD.' using errcode = '22023';
  end if;
  if v_q.locked_by is not null and v_q.locked_by <> v_uid and v_q.locked_until > now() then
    raise exception 'Someone else has that question open now.' using errcode = '22023';
  end if;

  update public.audit_questions as aqu
  set status = 'flagged', question_passed = false, checked_by_user = null,
      locked_by = v_uid, locked_until = now() + interval '10 minutes', leased_at = now()
  where aqu.id = v_q.id;

  -- A finished paper opens again: there is a question to answer.
  if v_a.status = 'done' then
    begin
      update public.checker_assignments
      set status = 'assigned', closed_at = null, closed_reason = null
      where checker_assignments.id = v_a.id;
    exception when unique_violation then
      raise exception 'Someone else has been given this paper, so that question cannot be reopened.'
        using errcode = '22023';
    end;
  end if;

  insert into public.audit_review_log
    (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note, undone_at, undone_by)
  values (null, v_uid, v_q.paper_id, v_q.id, 'verifier_reopen', null,
          jsonb_build_object('status', v_q.status, 'question_passed', v_q.question_passed,
                             'version', v_q.version, 'checked_by_user', v_q.checked_by_user),
          jsonb_build_object('status', 'flagged', 'question_passed', false, 'version', v_q.version),
          'reopened a Done question to edit it', now(), v_uid);

  return query
    select aq.id, aq.paper_id, aq.ord, aq.display_number, aq.number_path,
           aq.body, aq.options, aq.marks, aq.instructions,
           aq.flag_reasons, aq.flag_detail, (aq.source - 'snippet_path'),
           ap.subject, ap.school, ap.class, ap.exam_type, ap.year, aq.version,
           case when (aq.source ->> 'page') ~ '^[0-9]{1,6}$' then (aq.source ->> 'page')::integer end,
           pg.object_path,
           coalesce(nullif(aq.source ->> 'snippet_object', ''), nullif(aq.source ->> 'whole_snippet_object', '')),
           aq.raw_ocr
    from public.audit_questions aq
    join public.audit_papers ap on ap.id = aq.paper_id
    left join public.audit_paper_pages pg
           on pg.audit_paper_id = aq.paper_id
          and (aq.source ->> 'page') ~ '^[0-9]{1,6}$'
          and pg.page = (aq.source ->> 'page')::integer
    where aq.id = v_q.id;
end;
$function$;

insert into public.log_action_catalog (action, kind, meaning) values
  ('verifier_reopen', 'checker', 'A verifier reopened a question they had marked Done, to edit it')
on conflict (action) do nothing;

revoke all on function public.verifier_reopen_question(uuid) from public, anon, authenticated;
grant execute on function public.verifier_reopen_question(uuid) to authenticated;
