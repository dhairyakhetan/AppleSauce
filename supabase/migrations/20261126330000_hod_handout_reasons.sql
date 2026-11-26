-- 20261126330000: "Auto assign all" says the FULL reason a paper or a checker got nothing (HOD audit, 26 Nov 2026;
-- owner: "finish all tasks fixes").
--
-- Before: after Auto assign all the screen explained what it could see itself (expired details, the 10-paper limit,
-- a class above every checker's grade). Two rules of the hand-out (distribute_unassigned_papers) live only in the
-- database: a checker never gets a paper from their own school, and never gets back a paper they let sit for 7 days
-- (returned with "nothing done for ..."). A paper blocked only by those was described as "no rule we can see".
--
-- After: a new READ-ONLY function hod_handout_reasons(paper ids) answers, for the papers still waiting after the
-- run (the screen passes the ids it lists, at most 200 are read), and for every active checker:
--   papers:   [{paper_id, reason}]  reason is the FIRST hand-out rule that rules out every checker, in the
--             hand-out's own order:
--               'taken'       somebody holds it now (given out just now, or by hand)
--               'no_checker'  no active checker whose details have not expired
--               'all_full'    every such checker already holds the most papers with work (verifier_paper_cap())
--               'grade'       the class is above the grade of every checker with room
--               'own_school'  every checker left is at the paper's own school
--               'let_it_sit'  every checker left let this paper sit for verifier_idle_days() days
--               'other'       none of these: a checker could take it (press Auto assign all again)
--   checkers: [{user_id, reason}]   'expired' | 'full' | 'none_left' | 'grade' | 'own_school' | 'let_it_sit' | 'other',
--             the same rules from the checker's side, over the same papers.
--   cap, idle_days: the two numbers the words use.
-- It uses exactly the hand-out's tests (school_norm on the paper's school and its publish_meta school, class_grade,
-- grade not recorded = 12, admins are never checkers, verifier_has_work for "papers with work").
--
-- Cheap and bounded: at most 200 papers; the only costly helper (verifier_has_work, which checks questions) runs only
-- for a checker who holds verifier_paper_cap() papers or more in all, because anyone holding fewer has room anyway.
-- Nothing is written. Subjects are not a rule (they only help pick who gets a paper), so they are not a reason here.
--
-- Doors: SECURITY DEFINER, search_path public, pg_temp, is_hod() checked inside (42501), revoked from public, anon AND
-- authenticated by name, then granted to authenticated only.

create or replace function public.hod_handout_reasons(p_paper_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ids uuid[];
  v_cap integer := public.verifier_paper_cap();
  v_idle integer := public.verifier_idle_days();
  v_papers jsonb;
  v_checkers jsonb;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;

  -- At most 200 papers are read in one call (the screen lists at most that many).
  select coalesce(array_agg(s.id), '{}'::uuid[]) into v_ids
    from (select distinct x.id from unnest(coalesce(p_paper_ids, '{}'::uuid[])) as x(id) where x.id is not null limit 200) s;

  -- One read-only statement (nothing is written, not even a scratch table).
  with hr_papers as materialized (
    select ap.id as paper_id,
           public.class_grade(ap.class) as grade,
           public.school_norm(ap.school) as school_a,
           public.school_norm(ap.publish_meta ->> 'school') as school_b,
           exists (select 1 from public.checker_assignments a
                    where a.audit_paper_id = ap.id and a.status in ('queued', 'assigned')) as held
      from public.audit_papers ap
     where ap.id = any (v_ids)
  ),
  -- The checkers the hand-out considers (active, not an admin), with the details it reads.
  hr_people as materialized (
    select pc.user_id,
           coalesce(vp.grade, 12) as grade,
           public.school_norm(vp.school) as school,
           (vp.valid_until is not null and vp.valid_until < current_date) as expired,
           case when (select count(*) from public.checker_assignments a
                       where a.user_id = pc.user_id and a.status in ('queued', 'assigned')) < v_cap
                then false
                else (select count(*) from public.checker_assignments a
                       where a.user_id = pc.user_id and a.status in ('queued', 'assigned')
                         and public.verifier_has_work(a.audit_paper_id)) >= v_cap
           end as is_full
      from public.paper_checkers pc
      left join public.verifier_profiles vp on vp.user_id = pc.user_id
     where pc.active
       and not exists (select 1 from public.admins ad where ad.id = pc.user_id)
  ),
  -- Papers a checker let sit: the hand-out does not give them back to that checker within the idle window.
  hr_sat as materialized (
    select distinct x.audit_paper_id as paper_id, x.user_id
      from public.checker_assignments x
     where x.audit_paper_id = any (v_ids)
       and x.status = 'returned' and x.closed_reason like 'nothing done for %'
       and x.closed_at > now() - make_interval(days => v_idle)
  ),
  -- Every paper against every checker, with each hand-out rule worked out once.
  hr_pairs as materialized (
    select p.paper_id, p.held, d.user_id,
           not d.expired as ok,
           not d.is_full as room,
           (p.grade is null or p.grade <= d.grade) as grade_ok,
           (d.school is not null and (d.school is not distinct from p.school_a
                                      or d.school is not distinct from p.school_b)) as own_school,
           exists (select 1 from hr_sat s where s.paper_id = p.paper_id and s.user_id = d.user_id) as sat
      from hr_papers p cross join hr_people d
  ),
  paper_reasons as (
    select p.paper_id,
           case when p.held then 'taken'
                when coalesce(k.n_ok, 0) = 0 then 'no_checker'
                when k.n_room = 0 then 'all_full'
                when k.n_grade = 0 then 'grade'
                when k.n_school = 0 then 'own_school'
                when k.n_sat = 0 then 'let_it_sit'
                else 'other' end as reason
      from hr_papers p
      left join (
        select c.paper_id,
               count(*) filter (where c.ok) as n_ok,
               count(*) filter (where c.ok and c.room) as n_room,
               count(*) filter (where c.ok and c.room and c.grade_ok) as n_grade,
               count(*) filter (where c.ok and c.room and c.grade_ok and not c.own_school) as n_school,
               count(*) filter (where c.ok and c.room and c.grade_ok and not c.own_school and not c.sat) as n_sat
          from hr_pairs c
         group by c.paper_id
      ) k on k.paper_id = p.paper_id
  ),
  people_reasons as (
    select d.user_id,
           case when d.expired then 'expired'
                when d.is_full then 'full'
                when coalesce(k.n_free, 0) = 0 then 'none_left'
                when k.n_grade = 0 then 'grade'
                when k.n_school = 0 then 'own_school'
                when k.n_sat = 0 then 'let_it_sit'
                else 'other' end as reason
      from hr_people d
      left join (
        select c.user_id,
               count(*) as n_free,
               count(*) filter (where c.grade_ok) as n_grade,
               count(*) filter (where c.grade_ok and not c.own_school) as n_school,
               count(*) filter (where c.grade_ok and not c.own_school and not c.sat) as n_sat
          from hr_pairs c
         where not c.held
         group by c.user_id
      ) k on k.user_id = d.user_id
  )
  select (select coalesce(jsonb_agg(jsonb_build_object('paper_id', r.paper_id, 'reason', r.reason) order by r.paper_id), '[]'::jsonb)
            from paper_reasons r),
         (select coalesce(jsonb_agg(jsonb_build_object('user_id', r.user_id, 'reason', r.reason) order by r.user_id), '[]'::jsonb)
            from people_reasons r)
    into v_papers, v_checkers;

  return jsonb_build_object('papers', v_papers, 'checkers', v_checkers, 'cap', v_cap, 'idle_days', v_idle);
end;
$function$;

revoke all on function public.hod_handout_reasons(uuid[]) from public, anon, authenticated;
grant execute on function public.hod_handout_reasons(uuid[]) to authenticated;
