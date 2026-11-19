-- The checker's paper card showed only the checker's own share ("0 of 1 done") on a paper where the
-- computer had already passed the other 29 questions. Owner, 8 Nov 2026: "if others were passed it
-- should show full".
--
-- verifier_my_papers() gets two more columns, paper_total and paper_passed: every question of the paper
-- (not set aside) and how many of them are passed, whoever passed them. total, done, remaining, with_hod
-- and skipped keep their meaning and values, because the undo button, the "Start / Keep verifying"
-- button and the HOD screens read them. Only the card's "N of M done" and its bar use the new two.
--
-- The return type changes, so the function is dropped and made again, then its grants are put back
-- exactly as 20261007130000_verifier_paper_lists.sql had them: closed to public and anon, open to
-- signed-in users, and the caller is checked inside (is_paper_checker).
-- Same body as 20261011100000_throttle_paper_distribution.sql apart from the two new columns.

begin;

drop function if exists public.verifier_my_papers();

create function public.verifier_my_papers()
 returns table(assignment_id bigint, paper_id uuid, subject text, school text, cls text, exam text, year text, given_by_hod boolean, assigned_at timestamp with time zone, total integer, done integer, remaining integer, with_hod integer, skipped integer, paper_total integer, paper_passed integer)
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform public.distribute_unassigned_papers_throttled();
  perform public.verifier_close_finished(v_uid);
  return query
    with mine as (
      select a.* from public.checker_assignments a
      where a.user_id = v_uid and a.status in ('queued', 'assigned')
    ),
    c as (
      select m.id,
             (select count(*)::int from public.audit_questions q
               where q.paper_id = m.audit_paper_id and q.review_bucket = 'kid'
                 and q.question_passed = false and q.kind = 'question'
                 and public.checker_question_servable(q)) as remaining,
             (select count(distinct l.question_id)::int from public.audit_review_log_counted l
               where l.paper_id = m.audit_paper_id and l.actor_user_id = v_uid
                 and l.at >= m.assigned_at
                 and l.action in ('checker_pass', 'checker_fix', 'checker_printed_typo', 'checker_split')) as done,
             (select count(*)::int from public.audit_questions q
               where q.paper_id = m.audit_paper_id and q.review_bucket = 'escalated'
                 and q.question_passed = false and q.set_aside_at is null) as with_hod,
             (select count(*)::int from public.audit_questions q
               where q.paper_id = m.audit_paper_id and q.review_bucket = 'kid'
                 and q.question_passed = false and q.kind = 'question'
                 and public.checker_question_servable(q)
                 and exists (select 1 from public.audit_question_skips s
                             where s.question_id = q.id and s.user_id = v_uid
                               and s.skipped_at >= m.assigned_at)) as skipped,
             (select count(*)::int from public.audit_questions q
               where q.paper_id = m.audit_paper_id and q.kind = 'question'
                 and q.set_aside_at is null) as paper_total,
             (select count(*)::int from public.audit_questions q
               where q.paper_id = m.audit_paper_id and q.kind = 'question'
                 and q.set_aside_at is null and q.question_passed = true) as paper_passed
      from mine m
    )
    select m.id, m.audit_paper_id, ap.subject, ap.school, ap.class, ap.exam_type, ap.year,
           m.assigned_by is not null, m.assigned_at,
           c.done + c.remaining + c.with_hod, c.done, c.remaining, c.with_hod, c.skipped,
           c.paper_total, c.paper_passed
    from mine m
    join c on c.id = m.id
    join public.audit_papers ap on ap.id = m.audit_paper_id
    order by m.assigned_at, m.id;
end;
$function$;

revoke all on function public.verifier_my_papers() from public, anon, authenticated;
grant execute on function public.verifier_my_papers() to authenticated;

commit;
