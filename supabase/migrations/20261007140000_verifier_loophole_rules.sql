-- Owner's answers to the loophole questions, 7 Oct 2026.
--
--   1. A verifier who does nothing on a paper for 7 days loses it: it goes
--      back to the pool automatically and the HOD history says so. Work
--      already done stays. The same verifier is not handed that paper again
--      by the automatic hand-out for 7 days (an HOD still can).
--   2. A skipped question goes to the end of that verifier's list instead of
--      vanishing for 24 hours. The paper finishes only when they answer it.
--   3. A paper whose class is not known is handed out as Class 12, so only
--      Class 12 verifiers get it automatically (nobody gets a paper above
--      their grade). An HOD can still give it to anyone.
--
-- Settled without a change (recorded so nobody "fixes" them):
--   - Own school is allowed (past papers; nothing to leak).
--   - An expired profile keeps the papers it holds and gets no new ones
--     (distribute_unassigned_papers already filters valid_until; the
--     verifier screens do not).
--   - Verifiers are trusted as they are: no planted mistakes, no HOD sample.
--   - No message when papers arrive.

-- ------------------------------------------------------------ 1. idle return

create or replace function public.verifier_idle_days()
returns integer
language sql immutable
set search_path to 'public', 'pg_temp'
as $$ select 7 $$;

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

-- ------------------------------------------------- 1 + 3. the hand-out itself
--
-- Same as 20261007130000 with three changes: idle papers are returned first,
-- an unknown class counts as Class 12, and a verifier is not handed back a
-- paper that was taken from them for idleness in the last 7 days.

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
  -- One distributor at a time.
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
           coalesce(public.class_grade(ap.class), 12) as grade,   -- unknown class: Class 12 only
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

  -- Each eligible verifier and what they already hold.
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
         (select count(*)::int from public.checker_assignments a
          where a.user_id = pc.user_id and a.status in ('queued', 'assigned'))
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
    -- Even playing field first: only verifiers within one paper's worth of
    -- the lightest eligible load are considered (a strict board-first order
    -- left a CBSE verifier with nothing in testing, since most papers are
    -- ICSE). Among those, the preferences decide.
    select min(d.load) into v_min from _dist_load d
    where p.grade <= d.grade and d.papers < public.verifier_paper_cap();
    continue when v_min is null;
    select d.user_id into v_user
    from _dist_load d
    where p.grade <= d.grade
      and d.papers < public.verifier_paper_cap()
      and d.load <= v_min + greatest(p.n, 15)
      -- not straight back to someone who just sat on it
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

    continue when v_user is null;   -- nobody's grade is high enough; an HOD can give it by hand

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

-- ------------------------------------------------- 2. skipped goes to the end

create or replace function public.verifier_next_in_paper(p_paper_id uuid)
returns table(id uuid, paper_id uuid, ord integer, display_number text, number_path text, body text,
              options jsonb, marks numeric, instructions text, flag_reasons text[], flag_detail text,
              source jsonb, subject text, school text, cls text, exam text, year text, version integer,
              page integer, page_path text, snippet_path text)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_claimed uuid;
  v_since timestamptz;
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select a.assigned_at into v_since
  from public.checker_assignments a
  where a.audit_paper_id = p_paper_id and a.user_id = v_uid
    and a.status in ('queued', 'assigned');
  if not found then
    raise exception 'This paper is not assigned to you' using errcode = '42501';
  end if;

  for attempt in 1..5 loop
    v_id := null;
    -- Questions this verifier skipped (while holding the paper) come last,
    -- the earliest skipped first, so each comes round again in turn.
    select aq.id into v_id
    from public.audit_questions aq
    left join lateral (select max(s.skipped_at) as at from public.audit_question_skips s
                       where s.question_id = aq.id and s.user_id = v_uid
                         and s.skipped_at >= v_since) sk on true
    where aq.paper_id = p_paper_id
      and aq.review_bucket = 'kid' and aq.question_passed = false and aq.kind = 'question'
      and public.checker_question_servable(aq)
      and (aq.locked_until is null or aq.locked_until < now() or aq.locked_by = v_uid)
    order by case when aq.locked_by = v_uid and aq.locked_until > now() and sk.at is null then 0 else 1 end,
             sk.at nulls first, aq.ord, aq.id
    limit 1;

    if v_id is null then
      perform public.verifier_close_finished(v_uid);
      return;
    end if;

    update public.audit_questions as aqu
    set locked_by = v_uid, locked_until = now() + interval '10 minutes', leased_at = now()
    where aqu.id = v_id
      and (aqu.locked_until is null or aqu.locked_until < now() or aqu.locked_by = v_uid)
    returning aqu.id into v_claimed;
    exit when v_claimed is not null;
  end loop;

  if v_claimed is null then
    return;
  end if;
  return query
    select aq.id, aq.paper_id, aq.ord, aq.display_number, aq.number_path,
           aq.body, aq.options, aq.marks, aq.instructions,
           aq.flag_reasons, aq.flag_detail, aq.source,
           ap.subject, ap.school, ap.class, ap.exam_type, ap.year, aq.version,
           case when (aq.source ->> 'page') ~ '^[0-9]{1,6}$' then (aq.source ->> 'page')::integer end,
           pg.object_path,
           coalesce(nullif(aq.source ->> 'snippet_object', ''), nullif(aq.source ->> 'whole_snippet_object', ''))
    from public.audit_questions aq
    join public.audit_papers ap on ap.id = aq.paper_id
    left join public.audit_paper_pages pg
           on pg.audit_paper_id = aq.paper_id
          and (aq.source ->> 'page') ~ '^[0-9]{1,6}$'
          and pg.page = (aq.source ->> 'page')::integer
    where aq.id = v_claimed;
end;
$$;

-- ------------------------------------------------------------------- grants

do $$
declare f text;
begin
  foreach f in array array[
    'public.verifier_idle_days()',
    'public.verifier_return_idle()',
    'public.distribute_unassigned_papers()',
    'public.verifier_next_in_paper(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;
grant execute on function public.verifier_return_idle() to authenticated, service_role;
grant execute on function public.distribute_unassigned_papers() to authenticated, service_role;
grant execute on function public.verifier_next_in_paper(uuid) to authenticated, service_role;
grant execute on function public.verifier_idle_days() to service_role;

insert into public.log_action_catalog (action, kind, meaning) values
  ('auto_return_idle', 'admin', 'A paper went back to the pool after 7 days with nothing done on it')
on conflict (action) do nothing;
