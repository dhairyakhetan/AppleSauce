-- Two slow HOD desk functions made fast (13 Nov 2026). Same rows, same rules, same doors.
--
-- MEASURED on live data, in rolled-back rehearsals (nothing was changed to measure):
--
--   1. hod_paper_trail (and so hod_desk_counts, which calls it: the strip of counts and the tab badges)
--      The scan itself took 1.6 s. The cause was the little helper approval_question_state(kind, passed, set_aside_at): it
--      carries its own "search_path" setting, so the database cannot fold it into the query and instead runs it as a separate
--      call, and the query asked for it about 8 times for every question (once per count). About 29,000 questions times 8 calls
--      is the whole 1.6 s. The same answer is now worked out ONCE per question with the identical test written in place
--      (a case with the exact three rules of that helper). Rehearsal: the scan went from 1.62 s to 0.09 s, and the old and new
--      versions returned identical rows for all 612 papers (checked both ways). The helper itself is untouched.
--
--   2. distribute_unassigned_papers (the Auto assign all button, and the hand-out job every 2 minutes)
--      Its first step counted the questions a checker can be given on EVERY paper (about 2,000 questions, 1 ms each, about
--      6.8 s), and only then threw away the papers somebody already holds. The planner runs the question check before the
--      "nobody holds it" test. Fix: first collect the papers nobody holds that have an open question (a plain list of ids,
--      the same trick hod_unassigned_papers uses since 20261113310000), then count only the questions of those papers.
--      Rehearsal: that step went from 6.8 s to 0.1 s today. A paper that qualifies before still qualifies (a paper with a
--      question a checker can be given must have an open question, so it is on the list), so the same papers come out in
--      the same order. With the "nobody holds it" test left out of both sides, the old and the new step returned the same 67 rows.
--      The rest of the function (who gets which paper, the scoring, the caps) is word for word the same.
--
-- Not changed here, and measured: checker_question_servable costs about 1 ms per question (its three helper calls cost
-- 0.1 ms together), which is what keeps hod_assignments (2.1 s) and hod_team (4.6 s) slow. That needs its own careful change.

create or replace function public.hod_paper_trail()
returns table(audit_paper_id uuid, stage text, total integer, passed integer, checking integer, needs_you integer, set_aside integer, title text, subject text, cls text, school text, is_live boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;

  return query
    select ap.id,
           case when ap.approval_state = 'approved' then 'live'
                when ap.approval_state = 'awaiting' and c.no_person = 0 then 'ready'
                when c.need > 0 then 'needs_you'
                when c.chk > 0 or (c.tot > 0 and c.n_open = 0) then 'checking'
                else 'read' end,
           c.tot::integer, c.n_passed::integer, c.chk::integer, c.need::integer, c.n_aside::integer,
           coalesce(nullif(btrim(ap.title), ''),
                    concat_ws(' ', coalesce(ap.publish_meta ->> 'school', ap.school),
                              coalesce(ap.publish_meta ->> 'subject', ap.subject),
                              coalesce(ap.publish_meta ->> 'cls', ap.class),
                              coalesce(ap.publish_meta ->> 'exam', ap.exam_type),
                              nullif(coalesce(ap.publish_meta ->> 'year', ap.year), 'year-unknown'))),
           coalesce(ap.publish_meta ->> 'subject', ap.subject),
           coalesce(ap.publish_meta ->> 'cls', ap.class),
           coalesce(ap.publish_meta ->> 'school', ap.school),
           coalesce(bp.is_published, false)
      from public.audit_papers ap
      cross join lateral (
        select count(*) filter (where s.st <> 'section') as tot,
               count(*) filter (where s.st = 'passed') as n_passed,
               count(*) filter (where s.st = 'open') as n_open,
               count(*) filter (where s.st = 'set_aside') as n_aside,
               count(*) filter (where s.st = 'open' and s.bucket = 'kid') as chk,
               count(*) filter (where s.st = 'open' and s.bucket in ('escalated', 'admin')) as need,
               count(*) filter (where s.st in ('open', 'passed') and not s.pv) as no_person
          -- The state of a question is worked out once, in place, with the exact rules of approval_question_state
          -- (a heading is a section; passed wins over set aside; otherwise open). Calling that helper here ran it
          -- about 8 times per question.
          from (select case when q.kind <> 'question' then 'section'
                            when coalesce(q.question_passed, false) then 'passed'
                            when q.set_aside_at is not null then 'set_aside'
                            else 'open' end as st,
                       q.review_bucket as bucket,
                       -- "a person verified it" only decides the Ready stage of a paper waiting for approval
                       case when ap.approval_state = 'awaiting'
                            then public.approval_person_verdict(q.id, q.checked_by_user)
                            else true end as pv
                  from public.audit_questions q where q.paper_id = ap.id) s
      ) c
      left join public.bank_papers bp on bp.id = ap.live_bank_paper_id
     where ap.source <> 'live_copy'
     order by ap.id;
end;
$function$;

create or replace function public.distribute_unassigned_papers()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare p record; v_user uuid; n int := 0; v_free uuid[];
begin
  if not (public.is_hod() or auth.role() = 'service_role' or coalesce(current_setting('app.dist_internal', true), '') = '1') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('distribute_unassigned_papers'));
  perform public.verifier_return_idle();

  -- The papers nobody holds that still have an open question for a checker (cheap). The expensive per-question check
  -- below then runs only on the questions of THESE papers, not on every paper's questions.
  select coalesce(array_agg(ap.id), '{}'::uuid[]) into v_free
    from public.audit_papers ap
   where ap.source is distinct from 'live_copy'
     and not exists (select 1 from public.checker_assignments a
                      where a.audit_paper_id = ap.id and a.status in ('queued', 'assigned'))
     and exists (select 1 from public.audit_questions q0
                  where q0.paper_id = ap.id and q0.review_bucket = 'kid'
                    and q0.question_passed = false and q0.kind = 'question');

  create temp table if not exists _dist_papers (paper_id uuid, subject text, grade int, board text, n int, rank bigint,
                                                school_a text, school_b text) on commit drop;
  truncate _dist_papers;
  insert into _dist_papers
  select x.paper_id, x.subject, x.grade, x.board, x.n, row_number() over (order by x.turn, x.subject),
         x.school_a, x.school_b
  from (
    select c.paper_id, public.subject_family(ap.subject) as subject, public.class_grade(ap.class) as grade,
           public.board_family(ap.board) as board, c.n,
           public.school_norm(ap.school) as school_a, public.school_norm(ap.publish_meta ->> 'school') as school_b,
           row_number() over (partition by public.subject_family(ap.subject) order by ap.created_at) as turn
    from (select q.paper_id, count(*)::int as n from public.audit_questions q
          where q.paper_id = any (v_free)
            and q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question'
            and public.checker_question_servable(q)
          group by q.paper_id) c
    join public.audit_papers ap on ap.id = c.paper_id
    where ap.source is distinct from 'live_copy' and public.paper_pictures_complete(c.paper_id)
      and not exists (select 1 from public.checker_assignments a
                      where a.audit_paper_id = c.paper_id and a.status in ('queued', 'assigned'))
  ) x;
  if not found then return 0; end if;
  create temp table if not exists _dist_load (user_id uuid, grade int, grade_known boolean, board text, preferred text[],
                                              school text, load int, papers int) on commit drop;
  truncate _dist_load;
  insert into _dist_load
  select pc.user_id, coalesce(vp.grade, 12), vp.grade is not null, public.board_family(vp.board),
         (select array_agg(public.subject_family(s)) from unnest(vp.preferred_subjects) s),
         public.school_norm(vp.school),
         coalesce((select count(*)::int from public.checker_assignments a
                   join public.audit_questions q on q.paper_id = a.audit_paper_id
                   where a.user_id = pc.user_id and a.status in ('queued', 'assigned')
                     and q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question'
                     and public.checker_question_servable(q)), 0),
         (select count(*)::int from public.checker_assignments a
          where a.user_id = pc.user_id and a.status in ('queued', 'assigned')
            and public.verifier_has_work(a.audit_paper_id))
  from public.paper_checkers pc left join public.verifier_profiles vp on vp.user_id = pc.user_id
  where pc.active and (vp.valid_until is null or vp.valid_until >= current_date)
    and not exists (select 1 from public.admins ad where ad.id = pc.user_id);
  create temp table if not exists _dist_held (user_id uuid, subject text, grade int) on commit drop;
  truncate _dist_held;
  insert into _dist_held
  select a.user_id, public.subject_family(ap.subject), public.class_grade(ap.class)
  from public.checker_assignments a join public.audit_papers ap on ap.id = a.audit_paper_id
  where a.status in ('queued', 'assigned') and a.user_id in (select user_id from _dist_load);
  for p in select * from _dist_papers dp
           order by (exists (select 1 from _dist_load d
                             where dp.subject = any(d.preferred) and (dp.grade is null or dp.grade <= d.grade))) desc,
                    rank
  loop
    v_user := null;
    select s.user_id into v_user
    from (
      select d.user_id, d.papers, d.load,
             (select pts.total
              from public.assignment_points(
                     p.subject, p.grade, p.board, d.preferred, d.grade, d.grade_known, d.board, d.papers, d.load,
                     (select count(*)::int from _dist_held h where h.user_id = d.user_id and h.subject = p.subject),
                     (select count(*)::int from _dist_held h where h.user_id = d.user_id and h.grade = p.grade)) pts) as score
      from _dist_load d
      where (p.grade is null or p.grade <= d.grade)
        and d.papers < public.verifier_paper_cap()
        and not (d.school is not null
                 and (d.school is not distinct from p.school_a or d.school is not distinct from p.school_b))
        and not exists (select 1 from public.checker_assignments x
                        where x.audit_paper_id = p.paper_id and x.user_id = d.user_id
                          and x.status = 'returned' and x.closed_reason like 'nothing done for %'
                          and x.closed_at > now() - make_interval(days => public.verifier_idle_days()))
    ) s
    order by s.score desc, s.papers, s.load, s.user_id
    limit 1;
    continue when v_user is null;
    insert into public.checker_assignments (audit_paper_id, user_id, assigned_by, status, started_at)
    values (p.paper_id, v_user, null, 'assigned', now()) on conflict do nothing;
    if found then
      update _dist_load set load = load + p.n, papers = papers + 1 where user_id = v_user;
      insert into _dist_held values (v_user, p.subject, p.grade);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$function$;

-- Same doors as before: signed-in people only (each function checks HOD or admin, or the hand-out job, inside).
revoke all on function public.hod_paper_trail() from public, anon, authenticated;
revoke all on function public.distribute_unassigned_papers() from public, anon, authenticated;
grant execute on function public.hod_paper_trail() to authenticated;
grant execute on function public.distribute_unassigned_papers() to authenticated;

-- CHECK: send me a picture of this result. It should show four lines, all "ok". ------------------------------------
select 'paper trail works the state out once' as what,
       case when pg_get_functiondef('public.hod_paper_trail()'::regprocedure) like '%worked out once, in place%' then 'ok' else 'MISSING' end as result
union all
select 'hand-out only checks papers nobody holds',
       case when pg_get_functiondef('public.distribute_unassigned_papers()'::regprocedure) like '%q.paper_id = any (v_free)%' then 'ok' else 'MISSING' end
union all
select 'the counts still answer (signed-in HODs only)',
       case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'hod_desk_counts'
                          and has_function_privilege('authenticated', p.oid, 'EXECUTE')) then 'ok' else 'MISSING' end
union all
select 'signed-out visitors cannot run either',
       case when not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                              and p.proname in ('hod_paper_trail', 'distribute_unassigned_papers')
                              and has_function_privilege('anon', p.oid, 'EXECUTE')) then 'ok' else 'MISSING' end;
