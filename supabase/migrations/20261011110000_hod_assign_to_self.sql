-- An HOD can give a paper to themselves ("Assign to me" on the HOD desk).
--
-- Before: hod_assign_paper() only accepted a person listed in paper_checkers, and
-- is_paper_checker() was true only for admins and listed verifiers, so an HOD who
-- is not an admin could neither be handed a paper nor open /checker.
--
-- Now:
--  * hod_assign_paper(): the caller (already checked to be an HOD) may name
--    themselves without a paper_checkers row. Everyone else must still be an
--    active verifier. The grade/expiry rule (verifier_can_take) still applies;
--    an HOD with no profile has no grade, which that rule treats as "any paper".
--  * is_paper_checker(): also true for an active HOD, so they can open /checker
--    and verify. They are NOT added to paper_checkers, so the automatic hand-out
--    (distribute_unassigned_papers) never gives them papers on its own.
-- Grants are unchanged (create or replace keeps them).

create or replace function public.is_paper_checker()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.is_admin()
      or exists (select 1 from public.paper_checkers pc where pc.user_id = auth.uid() and pc.active)
      or exists (select 1 from public.paper_hods h where h.user_id = auth.uid() and h.active);
$function$;

create or replace function public.hod_assign_paper(p_paper_id uuid, p_user_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_prev public.checker_assignments;
  v_block text;
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_user_id is distinct from auth.uid()
     and not exists (select 1 from public.paper_checkers pc where pc.user_id = p_user_id and pc.active) then
    raise exception 'That person is not an active verifier' using errcode = '22023';
  end if;
  if not exists (select 1 from public.audit_papers ap where ap.id = p_paper_id) then
    raise exception 'Paper not found' using errcode = '22023';
  end if;
  v_block := public.verifier_can_take(p_user_id, p_paper_id);
  if v_block is not null then
    raise exception '%', v_block using errcode = '22023';
  end if;

  select * into v_prev from public.checker_assignments
  where audit_paper_id = p_paper_id and status in ('queued', 'assigned') for update;
  if v_prev.id is not null then
    if v_prev.user_id = p_user_id then
      return 'assigned';
    end if;
    update public.checker_assignments
    set status = 'returned', closed_at = now(), closed_reason = 'moved by the HOD'
    where id = v_prev.id;
    update public.audit_questions set locked_by = null, locked_until = null
    where paper_id = p_paper_id and locked_by = v_prev.user_id;
  end if;

  insert into public.checker_assignments (audit_paper_id, user_id, assigned_by, status, started_at)
  values (p_paper_id, p_user_id, auth.uid(), 'assigned', now());

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), p_paper_id, null, 'hod_assign_paper',
          p_user_id::text || coalesce(' (moved from ' || v_prev.user_id::text || ')', ''));
  return 'assigned';
end;
$function$;
