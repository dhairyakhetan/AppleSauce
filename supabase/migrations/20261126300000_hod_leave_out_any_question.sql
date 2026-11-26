-- 20261126300000: an HOD can leave out ANY question of a paper waiting to go live (owner, 26 Nov 2026: "finish all
-- tasks fixes"; HOD audit: "Leave it out" was offered only on questions sent up to the HOD).
--
-- Before: hod_set_question_state refused 'set_aside' for a question still in a student bucket (review_bucket 'kid'
-- and the like): "This question is still with the student checkers." So on the go-live preview an HOD could not
-- leave out a question a student had passed, or one the AI alone had passed, even though the paper was waiting for
-- the HOD's yes.
--
-- After: when the question's paper is waiting to go live (audit_papers.approval_state = 'awaiting'), 'set_aside'
-- is accepted for ANY question, with a note (refused without one, 22023). Everything else is word for word as
-- before (20261119400000_hod_live_copy_requests.sql):
--   * 'pass' keeps the old rule (only a question that came to the HOD, or one already left out);
--   * 'set_aside' on a paper NOT waiting to go live keeps the old rule;
--   * 'reopen' (Put it back) is unchanged.
-- The write still goes through approval_set_question_state, so it is logged exactly as today: a content_checks row
-- (verdict 'flag', the note) and an audit_review_log row 'admin_set_aside' with the state before and after.
-- The paper still cannot be published with left-out questions unless the HOD ticks the confirmation
-- (hod_approve_paper p_confirm_left_out, unchanged).
--
-- Doors unchanged: SECURITY DEFINER, search_path public, pg_temp, is_hod() checked inside (42501), revoked from
-- public, anon AND authenticated by name, then granted to authenticated only.

create or replace function public.hod_set_question_state(p_question_id uuid, p_state text, p_note text default null)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q public.audit_questions;
  v_approval text;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  if p_state not in ('pass', 'set_aside', 'reopen') then
    raise exception 'Choose pass, set aside or reopen.' using errcode = '22023';
  end if;
  select * into v_q from public.audit_questions where id = p_question_id;
  if v_q.id is null then
    raise exception 'That question could not be found.' using errcode = 'P0002';
  end if;
  select ap.approval_state into v_approval from public.audit_papers ap where ap.id = v_q.paper_id;

  -- Leave out any question of a paper waiting to go live (20261126300000), with a note.
  if p_state = 'set_aside' and v_approval = 'awaiting' then
    if nullif(btrim(coalesce(p_note, '')), '') is null then
      raise exception 'Say why the question is left out.' using errcode = '22023';
    end if;
    return public.approval_set_question_state(p_question_id, p_state, p_note);
  end if;

  if p_state in ('pass', 'set_aside')
     and v_q.review_bucket not in ('escalated', 'admin')
     and v_q.set_aside_at is null then
    raise exception 'This question is still with the student checkers.' using errcode = '55000';
  end if;
  return public.approval_set_question_state(p_question_id, p_state, p_note);
end;
$function$;

revoke all on function public.hod_set_question_state(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hod_set_question_state(uuid, text, text) to authenticated;
