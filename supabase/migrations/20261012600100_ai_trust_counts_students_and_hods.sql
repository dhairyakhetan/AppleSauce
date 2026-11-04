-- 20261012600100: the AI trust counters count student and HOD actors only (owner rule 2026-10-12, final).
--
-- Rule: the 100-check overall counter counts verdicts by STUDENTS OR HODs (not admin fixes) on swarm and AI questions
-- together. After 100, each confidence level additionally needs 97% agreement over its latest 100 and an admin press
-- (that later step, ai_trust_meter / admin_set_ai_trust / ai_trust_recheck / ai_trust_bar, is NOT changed here).
--
-- What was wrong (read-only check, swarm\logs\ai_trust_check_20261012.md):
--   ai_trust_overall()   counted checker_kind = 'student' only (dropped HOD verdicts) and counted 'checker_split' log rows
--                        from any actor (an admin split would count).
--   ai_trust_outcomes()  counted checker_kind in ('student', 'hod', 'admin') (admin fixes counted) and 'checker_split'
--                        from any actor.
--
-- Now both read:
--   verdicts: content_checks_counted rows with checker_kind in ('student', 'hod') (the table also allows 'admin' and the
--             AI kinds haiku_paddle / haiku_pdf / sonnet; those never count). Undone rows are already dropped by the view.
--   splits:   audit_review_log_counted rows with action = 'checker_split' whose actor is a person who is not an admin:
--             actor_user_id is not null (system / AI rows carry no actor) and is not in public.admins.
--   ai_trust_outcomes still also reads 'hod_set_aside' (an HOD setting a question aside after the AI decided is a
--   "the AI was not right" signal); that action is an HOD act and is left as it was.
--
-- Unchanged on purpose: return shapes, SECURITY DEFINER, search_path = public, pg_temp, the inside role check of
-- ai_trust_overall() (HOD or admin or service_role, else 42501), the threshold function, and ai_auto_approve_allowed()
-- (STABLE, same access rule, coalesce(.., false): fails closed when the counter is not reached or returns nothing).
-- Only create or replace of two functions; no trust level is flipped and no row is written.
--
-- Grants are re-asserted to exactly today's state:
--   ai_trust_overall()   revoke from public, anon, authenticated; grant to authenticated, service_role
--   ai_trust_outcomes()  revoke from public, anon, authenticated; grant to service_role only

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
     and k.checker_kind in ('student', 'hod')
     and k.verdict in ('pass', 'fix', 'printed_typo')
     and k.created_at >= s.ai_decided_at
    group by s.id
  ),
  splits as (
    select distinct s.id
    from seen s
    join public.audit_review_log_counted l
      on l.question_id = s.id and l.at >= s.ai_decided_at and l.action = 'checker_split'
     and l.actor_user_id is not null
     and not exists (select 1 from public.admins a where a.id = l.actor_user_id)
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

create or replace function public.ai_trust_outcomes()
returns table(question_id uuid, subject text, level text, decision text, reason text,
              checked_at timestamptz, as_is boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with seen as (
    select q.id, ap.subject, q.ai_confidence, q.ai_decision, q.ai_review_reason, q.ai_decided_at
    from public.audit_questions q
    join public.audit_papers ap on ap.id = q.paper_id
    where q.ai_review_reason is not null
      and q.ai_decision in ('pass', 'fix')
      and q.ai_confidence in ('high', 'medium', 'low')
      and q.ai_decided_at is not null
  ),
  people as (
    select s.id,
           max(k.created_at) filter (where k.verdict in ('pass', 'fix', 'printed_typo')) as last_at,
           bool_or(k.verdict in ('fix', 'printed_typo')) as changed
    from seen s
    join public.content_checks_counted k
      on k.table_name = 'audit_questions' and k.row_id = s.id::text
     and k.checker_kind in ('student', 'hod')
     and k.created_at >= s.ai_decided_at
    group by s.id
  ),
  other as (
    select s.id, max(l.at) as last_at
    from seen s
    join public.audit_review_log_counted l
      on l.question_id = s.id and l.at >= s.ai_decided_at
     and (
           (l.action = 'checker_split'
            and l.actor_user_id is not null
            and not exists (select 1 from public.admins a where a.id = l.actor_user_id))
        or l.action = 'hod_set_aside'
         )
    group by s.id
  )
  select s.id, s.subject, s.ai_confidence, s.ai_decision, s.ai_review_reason,
         greatest(p.last_at, o.last_at),
         (o.id is null and not coalesce(p.changed, false))
  from seen s
  left join people p on p.id = s.id
  left join other o on o.id = s.id
  where p.last_at is not null or o.id is not null;
$function$;

-- Re-assert the grants (create or replace keeps the ACL, restated so it can never widen).
revoke all on function public.ai_trust_overall() from public, anon, authenticated;
revoke all on function public.ai_trust_outcomes() from public, anon, authenticated;
grant execute on function public.ai_trust_overall() to authenticated, service_role;
grant execute on function public.ai_trust_outcomes() to service_role;
