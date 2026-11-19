-- Plumbing fixes found in the 7 Oct browser check of the verifier screens.
--
-- A paper stays assigned while any of its questions is with the HOD
-- (verifier_close_finished waits for them), even when the verifier has
-- nothing left to do on it. Two rules treated that paper as still "in hand":
--
--   1. The 7-day idle return took it back ("nothing done for 7 days") when
--      the HOD, not the verifier, was the one taking time. Now only papers
--      with questions the verifier can still answer are returned for
--      idleness.
--   2. The cap of 10 papers counted it, so a verifier waiting on the HOD got
--      fewer new papers. Now the cap counts papers with work left for them.
--
-- And one gap: a verifier who is switched off (paper_checkers.active = false
-- or removed) kept their papers until the idle rule caught them 7 days
-- later. Now those papers go back to the pool at the next hand-out, logged
-- as 'auto_return_inactive'.

create or replace function public.verifier_has_work(p_paper_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from public.audit_questions q
                 where q.paper_id = p_paper_id
                   and q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question'
                   and public.checker_question_servable(q));
$$;

create or replace function public.verifier_return_idle()
returns integer
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r record;
  n int := 0;
begin
  if not (public.is_paper_checker() or public.is_hod() or auth.role() = 'service_role') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- Holders who are no longer active verifiers: back to the pool now.
  for r in
    select a.id, a.audit_paper_id, a.user_id
    from public.checker_assignments a
    where a.status in ('queued', 'assigned')
      and not exists (select 1 from public.paper_checkers pc where pc.user_id = a.user_id and pc.active)
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

  -- Idle for 7 days with questions still theirs to answer.
  for r in
    select a.id, a.audit_paper_id, a.user_id
    from public.checker_assignments a
    where a.status in ('queued', 'assigned')
      and greatest(a.assigned_at,
                   coalesce((select max(l.at) from public.audit_review_log l
                             where l.paper_id = a.audit_paper_id
                               and l.actor_user_id = a.user_id
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

-- Same as 20261007140000 except the cap counts only papers with work left.
create or replace function public.distribute_unassigned_papers()
returns integer
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  p record;
  v_user uuid;
  v_min int;
  n int := 0;
begin
  if not (public.is_paper_checker() or public.is_hod() or auth.role() = 'service_role') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('distribute_unassigned_papers'));

  perform public.verifier_return_idle();

  create temp table if not exists _dist_papers
    (paper_id uuid, subject text, grade int, board text, n int, rank bigint) on commit drop;
  truncate _dist_papers;
  insert into _dist_papers
  select x.paper_id, x.subject, x.grade, x.board, x.n,
         row_number() over (order by x.turn, x.subject)
  from (
    select c.paper_id, public.subject_key(ap.subject) as subject,
           coalesce(public.class_grade(ap.class), 12) as grade,
           public.board_family(ap.board) as board, c.n,
           row_number() over (partition by public.subject_key(ap.subject)
                              order by case when ap.source = 'live_copy' then 0 else 1 end, ap.created_at) as turn
    from (select q.paper_id, count(*)::int as n from public.audit_questions q
          where q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question'
            and public.checker_question_servable(q)
          group by q.paper_id) c
    join public.audit_papers ap on ap.id = c.paper_id
    where not exists (select 1 from public.checker_assignments a
                      where a.audit_paper_id = c.paper_id and a.status in ('queued', 'assigned'))
  ) x;
  if not found then
    return 0;
  end if;

  create temp table if not exists _dist_load
    (user_id uuid, grade int, board text, preferred text[], load int, papers int) on commit drop;
  truncate _dist_load;
  insert into _dist_load
  select pc.user_id, vp.grade, public.board_family(vp.board),
         (select array_agg(public.subject_key(s)) from unnest(vp.preferred_subjects) s),
         coalesce((select count(*)::int
                   from public.checker_assignments a
                   join public.audit_questions q on q.paper_id = a.audit_paper_id
                   where a.user_id = pc.user_id and a.status in ('queued', 'assigned')
                     and q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question'
                     and public.checker_question_servable(q)), 0),
         -- Papers with work left for them; one only waiting on the HOD does not count.
         (select count(*)::int from public.checker_assignments a
          where a.user_id = pc.user_id and a.status in ('queued', 'assigned')
            and public.verifier_has_work(a.audit_paper_id))
  from public.paper_checkers pc
  join public.verifier_profiles vp on vp.user_id = pc.user_id
  where pc.active
    and vp.grade is not null
    and vp.valid_until >= current_date
    and not exists (select 1 from public.admins ad where ad.id = pc.user_id);

  create temp table if not exists _dist_held (user_id uuid, subject text, grade int) on commit drop;
  truncate _dist_held;
  insert into _dist_held
  select a.user_id, public.subject_key(ap.subject), coalesce(public.class_grade(ap.class), 12)
  from public.checker_assignments a
  join public.audit_papers ap on ap.id = a.audit_paper_id
  where a.status in ('queued', 'assigned')
    and a.user_id in (select user_id from _dist_load);

  for p in select * from _dist_papers order by rank loop
    v_user := null;
    select min(d.load) into v_min from _dist_load d
    where p.grade <= d.grade and d.papers < public.verifier_paper_cap();
    continue when v_min is null;
    select d.user_id into v_user
    from _dist_load d
    where p.grade <= d.grade
      and d.papers < public.verifier_paper_cap()
      and d.load <= v_min + greatest(p.n, 15)
      and not exists (select 1 from public.checker_assignments x
                      where x.audit_paper_id = p.paper_id and x.user_id = d.user_id
                        and x.status = 'returned' and x.closed_reason like 'nothing done for %'
                        and x.closed_at > now() - make_interval(days => public.verifier_idle_days()))
    order by
      (coalesce(array_length(d.preferred, 1), 0) > 0 and p.subject = any(d.preferred)) desc,
      (p.board is not null and p.board = d.board) desc,
      (select count(*) from _dist_held h where h.user_id = d.user_id and h.subject = p.subject),
      (select count(*) from _dist_held h where h.user_id = d.user_id and h.grade = p.grade),
      d.load,
      d.user_id
    limit 1;

    continue when v_user is null;

    insert into public.checker_assignments (audit_paper_id, user_id, assigned_by, status, started_at)
    values (p.paper_id, v_user, null, 'assigned', now())
    on conflict do nothing;
    if found then
      update _dist_load set load = load + p.n, papers = papers + 1 where user_id = v_user;
      insert into _dist_held values (v_user, p.subject, p.grade);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.verifier_has_work(uuid)',
    'public.verifier_return_idle()',
    'public.distribute_unassigned_papers()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;
grant execute on function public.verifier_return_idle() to authenticated, service_role;
grant execute on function public.distribute_unassigned_papers() to authenticated, service_role;
grant execute on function public.verifier_has_work(uuid) to service_role;

insert into public.log_action_catalog (action, kind, meaning) values
  ('auto_return_inactive', 'admin', 'A paper went back to the pool because its verifier is no longer active')
on conflict (action) do nothing;
