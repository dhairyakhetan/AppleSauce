-- 20261012200100: smart auto-assign. Rewrites only the CHOOSING part of distribute_unassigned_papers().
--
-- Kept exactly as it is today: signature (no arguments, returns integer = papers handed out), SECURITY DEFINER,
-- search_path, the access check (HOD or admin, service_role, or the throttled wrapper's transaction-local marker; a
-- student calling it directly still gets 42501), the blocking advisory lock, the call to verifier_return_idle(), the
-- paper cap (verifier_paper_cap(), 10), "not the same paper someone just got sent back from", valid_until, admins
-- never receive papers. CREATE OR REPLACE keeps the grants (authenticated + service_role, anon none).
--
-- What changes, in plain words. For each unassigned paper (open servable student questions, nobody holds it):
--   HARD RULES (a person failing any of these is never given the paper):
--     1. Frozen Maths copies (audit_papers.source = 'live_copy') are never handed out.
--     2. Not their own school: the checker's school and the paper's school (either the paper's school column or the
--        school the HOD set in publish_meta) are compared after school_norm() (case, spaces and punctuation ignored).
--        When both are known and equal the paper is skipped for that person. Unknown on either side = no exclusion.
--     3. The paper's class must not be above the checker's class (a class 9 student never gets a class 12 paper).
--        A checker who never gave a class counts as class 12, as before.
--     4. Fewer than verifier_paper_cap() papers held, details not expired, not an admin, active (all as before).
--   SCORE (assignment_points(), the numbers are documented in 20261012200000): preferred subject +60, class within
--     two below theirs +30 (class 12 student: classes 10 to 12), board match +20 / mismatch -20, then minus for
--     papers and open questions already held (the even-workload term), minus a little for same subject / class held.
--     Highest score wins; ties go to whoever holds fewest papers, then fewest open questions, then user id.
--   ORDER OF PAPERS: papers someone prefers go first, then round-robin across subjects by age (as before; the old
--     "live_copy first" tiebreak is gone because live_copy papers are excluded).
--   IDLE PULL-BACK: unchanged and still in the same run. verifier_return_idle() runs first and sends any paper that
--     is queued/assigned, has open work, and has had no activity (no counted log line by the holder since it was
--     assigned) for verifier_idle_days() = 7 days back to unassigned, so the loop below can hand it to someone else.
--     The person it came back from is not given the same paper again for those 7 days (kept, see "returned" check).
-- No data row is touched by the migration itself.

create or replace function public.distribute_unassigned_papers()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare p record; v_user uuid; n int := 0;
begin
  if not (public.is_hod() or auth.role() = 'service_role' or coalesce(current_setting('app.dist_internal', true), '') = '1') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('distribute_unassigned_papers'));
  perform public.verifier_return_idle();
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
          where q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question'
            and public.checker_question_servable(q)
          group by q.paper_id) c
    join public.audit_papers ap on ap.id = c.paper_id
    where ap.source is distinct from 'live_copy'
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
