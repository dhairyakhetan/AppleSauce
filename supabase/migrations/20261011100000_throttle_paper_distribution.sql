-- "Verify papers" took 6+ seconds to open: verifier_my_papers() called
-- distribute_unassigned_papers() on every load, and that function scans every
-- review question in the database (checker_question_servable on ~70,000 rows).
-- Measured 2026-10-11: distribute = 5,847 ms, rest of the list = ~9 ms.
--
-- The hand-out is global (not per verifier), so it does not need to run per
-- page load: a pg_cron job runs it every two minutes, the list keeps a
-- throttled (5-minute) call as a fallback, and the HOD "give out papers now"
-- button still calls distribute_unassigned_papers() directly. If another
-- session is already running it, a throttled caller skips it and returns at once.

create table if not exists public.distribution_throttle (
  id int primary key default 1 check (id = 1),
  last_run timestamptz not null default 'epoch'
);
insert into public.distribution_throttle (id) values (1) on conflict do nothing;
alter table public.distribution_throttle enable row level security;
revoke all on public.distribution_throttle from public, anon, authenticated;

create or replace function public.distribute_unassigned_papers_throttled()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_due boolean;
begin
  if not pg_try_advisory_xact_lock(hashtext('distribute_unassigned_papers_throttled')) then
    return 0;
  end if;
  update public.distribution_throttle
     set last_run = now()
   where id = 1 and last_run < now() - interval '5 minutes'
  returning true into v_due;
  if v_due is null then
    return 0;
  end if;
  return public.distribute_unassigned_papers();
end;
$function$;

revoke all on function public.distribute_unassigned_papers_throttled() from public, anon, authenticated;

-- The schedule does the hand-out in the background every 2 minutes, so a page
-- load almost never pays for it; the 5-minute throttled call in the list is
-- only a fallback if the schedule ever stops. (distribute_unassigned_papers()
-- insists on a checker, an HOD or service_role, so the job presents itself as
-- service_role for its own transaction.)
create or replace function public.distribute_unassigned_papers_cron()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.distribution_throttle set last_run = now() where id = 1;
  return public.distribute_unassigned_papers();
end;
$function$;

revoke all on function public.distribute_unassigned_papers_cron() from public, anon, authenticated;

select cron.schedule('distribute-unassigned-papers', '*/2 * * * *', 'select public.distribute_unassigned_papers_cron()');

create or replace function public.verifier_my_papers()
 returns table(assignment_id bigint, paper_id uuid, subject text, school text, cls text, exam text, year text, given_by_hod boolean, assigned_at timestamp with time zone, total integer, done integer, remaining integer, with_hod integer, skipped integer)
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
                               and s.skipped_at >= m.assigned_at)) as skipped
      from mine m
    )
    select m.id, m.audit_paper_id, ap.subject, ap.school, ap.class, ap.exam_type, ap.year,
           m.assigned_by is not null, m.assigned_at,
           c.done + c.remaining + c.with_hod, c.done, c.remaining, c.with_hod, c.skipped
    from mine m
    join c on c.id = m.id
    join public.audit_papers ap on ap.id = m.audit_paper_id
    order by m.assigned_at, m.id;
end;
$function$;
