-- 12 Oct 2026. An admin or HOD who gives themselves a paper to check lost it
-- within about two minutes: verifier_return_idle() returned every assignment
-- whose user has no ACTIVE paper_checkers row, and admins / HODs are not rows in
-- that table. The next verdict then died on verifier_next_in_paper with 42501
-- "This paper is not assigned to you", the verdict was never saved, and the
-- screen sat on a skeleton while the old outbox retried a refusal that could
-- never succeed. 7 of 7 assignments ever returned for "no longer active" were
-- self-assigned by an admin or HOD.
--
-- Only the first loop changes: it now leaves an admin's or an active HOD's
-- assignment alone. The second loop (nothing done for N days) is untouched.
-- Same signature, so the existing grants stay; re-asserted below anyway.

create or replace function public.verifier_return_idle()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r record; n int := 0;
begin
  if not (public.is_paper_checker() or public.is_hod() or auth.role() = 'service_role') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  for r in
    select a.id, a.audit_paper_id, a.user_id from public.checker_assignments a
    where a.status in ('queued', 'assigned')
      and not exists (select 1 from public.paper_checkers pc where pc.user_id = a.user_id and pc.active)
      and not exists (select 1 from public.admins ad where ad.id = a.user_id)
      and not exists (select 1 from public.paper_hods h where h.user_id = a.user_id and h.active)
    for update of a skip locked
  loop
    update public.checker_assignments
    set status = 'returned', closed_at = now(), closed_reason = 'the verifier is no longer active, returned automatically'
    where id = r.id and status in ('queued', 'assigned');
    if found then
      insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
      values (null, null, r.audit_paper_id, null, 'auto_return_inactive', r.user_id::text);
      n := n + 1;
    end if;
  end loop;
  for r in
    select a.id, a.audit_paper_id, a.user_id from public.checker_assignments a
    where a.status in ('queued', 'assigned')
      and greatest(a.assigned_at,
                   coalesce((select max(l.at) from public.audit_review_log_counted l
                             where l.paper_id = a.audit_paper_id and l.actor_user_id = a.user_id
                               and l.at >= a.assigned_at), a.assigned_at))
          < now() - make_interval(days => public.verifier_idle_days())
      and public.verifier_has_work(a.audit_paper_id)
    for update of a skip locked
  loop
    update public.checker_assignments
    set status = 'returned', closed_at = now(),
        closed_reason = format('nothing done for %s days, returned automatically', public.verifier_idle_days())
    where id = r.id and status in ('queued', 'assigned');
    if found then
      insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
      values (null, null, r.audit_paper_id, null, 'auto_return_idle', r.user_id::text);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

revoke all on function public.verifier_return_idle() from public;
revoke all on function public.verifier_return_idle() from anon;
revoke all on function public.verifier_return_idle() from authenticated;
grant execute on function public.verifier_return_idle() to authenticated;
