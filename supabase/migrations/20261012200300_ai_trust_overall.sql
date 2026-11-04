-- 20261012200300: ONE overall AI trust counter and the gate that reads it (HOD desk design, owner rule 2026-10-12).
--
-- Rule: every question goes to student checkers first. AI trust is a single counter of student checks; once it reaches
-- the threshold (100) the AI may auto-approve clean questions and keeps learning from the changes students make.
--
-- ai_trust_overall() counts QUESTIONS the AI decided (ai_decision pass or fix, ai_decided_at set) that a student then
-- checked, one count per question however many times it was looked at:
--   agreed  = the student passed it as it stood (no fix, no printed-typo fix, no split)
--   changed = a student fixed it, fixed a printed typo, or split it (a split is a checker change; a set-aside by the
--             HOD is not a student verdict and is not counted here)
--   checks_done = agreed + changed
--   reached = checks_done >= threshold. The agreement rate is shown but does NOT gate: the owner's rule is the count.
-- Only checker_kind = 'student' verdicts count (the HOD's and admin's own passes do not), and undone verdicts are
-- ignored (content_checks_counted / audit_review_log_counted already drop undone rows). Both the old frozen Maths copies
-- and new swarm papers count: they are all AI-decided questions that a student later checked.
--
-- Access: HOD or admin, or service_role (the pipeline reads it with the service key). Anyone else gets 42501; anon has
-- no EXECUTE. ai_trust_meter (the per-level view), ai_trust_levels, admin_set_ai_trust, ai_trust_recheck and
-- ai_trust_outcomes are NOT changed, and no trust level is flipped by this migration.
--
-- ai_auto_approve_allowed() is the gate: STABLE, returns ai_trust_overall().reached, same access rule. There is NO
-- auto-approve path in SQL (the AI check runs from the pipeline: Shikshaq Papers\pipeline\auditor\ai_check\apply_plan.py,
-- read_trust() then routing_for() / settle_payload()). That pipeline must call ai_auto_approve_allowed() through the
-- service role at the start of an apply and, when it returns false, treat every level as untrusted (validation mode:
-- every AI pass and fix goes to a student). See swarm\logs\hod_rpc_contract_20261012.md.

create or replace function public.ai_trust_overall_threshold()
returns integer
language sql
immutable
as $fn$ select 100; $fn$;

create or replace function public.ai_trust_overall()
returns table(checks_done integer, agreed integer, changed integer, threshold integer, reached boolean, agreement_rate numeric)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_done int; v_agreed int; v_thr int := public.ai_trust_overall_threshold();
begin
  if not (public.is_hod() or auth.role() = 'service_role') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  with seen as (
    select q.id, q.ai_decided_at
    from public.audit_questions q
    where q.ai_decision in ('pass', 'fix') and q.ai_decided_at is not null
  ),
  people as (
    select s.id, bool_or(k.verdict in ('fix', 'printed_typo')) as changed
    from seen s
    join public.content_checks_counted k
      on k.table_name = 'audit_questions' and k.row_id = s.id::text
     and k.checker_kind = 'student'
     and k.verdict in ('pass', 'fix', 'printed_typo')
     and k.created_at >= s.ai_decided_at
    group by s.id
  ),
  splits as (
    select distinct s.id
    from seen s
    join public.audit_review_log_counted l
      on l.question_id = s.id and l.at >= s.ai_decided_at and l.action = 'checker_split'
  ),
  per_q as (
    select coalesce(p.id, sp.id) as id,
           (coalesce(p.changed, false) or sp.id is not null) as changed
    from people p
    full join splits sp on sp.id = p.id
  )
  select count(*)::int, count(*) filter (where not per_q.changed)::int
    into v_done, v_agreed
  from per_q;
  return query select v_done, v_agreed, v_done - v_agreed, v_thr, v_done >= v_thr,
                      case when v_done > 0 then round(v_agreed::numeric / v_done, 4) end;
end;
$function$;

create or replace function public.ai_auto_approve_allowed()
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not (public.is_hod() or auth.role() = 'service_role') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return coalesce((select o.reached from public.ai_trust_overall() o), false);
end;
$function$;

revoke all on function public.ai_trust_overall_threshold() from public, anon, authenticated;
revoke all on function public.ai_trust_overall() from public, anon, authenticated;
revoke all on function public.ai_auto_approve_allowed() from public, anon, authenticated;
grant execute on function public.ai_trust_overall() to authenticated, service_role;
grant execute on function public.ai_auto_approve_allowed() to authenticated, service_role;
