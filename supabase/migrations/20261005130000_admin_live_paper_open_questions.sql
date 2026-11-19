-- 20261005130000_admin_live_paper_open_questions.sql
--
-- Owner, 2026-10-05: "see exactly which are open and solve them" (the
-- "N open" badge on a live paper in Ready to go live).
--
-- admin_live_paper_open_questions(p_audit_paper_id) lists the questions that
-- block "Update live paper" for ONE paper: the same rule admin_live_paper_pending
-- counts (approval_question_state(...) = 'open'), one row each, explicit
-- columns only. No answer_key, no question text: the admin opens the question
-- in the paper review page to read and decide.
--
-- Admin only (is_admin() first, 42501 otherwise). Revoked from public, anon AND
-- authenticated by name, then granted to authenticated, the same as
-- admin_live_paper_pending.

create or replace function public.admin_live_paper_open_questions(p_audit_paper_id uuid)
returns table(
  audit_question_id uuid, ord integer, display_number text, number_path text,
  review_bucket text, flag_reasons text[], flag_detail text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select q.id, q.ord::integer, q.display_number, q.number_path,
           q.review_bucket, q.flag_reasons, q.flag_detail
    from public.audit_questions q
    where q.paper_id = p_audit_paper_id
      and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open'
    order by q.ord, q.id;
end;
$function$;

revoke all on function public.admin_live_paper_open_questions(uuid) from public, anon, authenticated;
grant execute on function public.admin_live_paper_open_questions(uuid) to authenticated;
