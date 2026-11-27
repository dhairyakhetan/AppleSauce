-- 20261127110000: HOD and site-wide audit fixes (27 Nov 2026; owner: "fix the confirmed findings").
-- ONE file; every function is "create or replace" from its latest definition, with only the stated change, and the
-- doors are kept (SECURITY DEFINER, search_path public, pg_temp, is_hod() checked inside, revoked from public, anon AND
-- authenticated by name, then granted to authenticated only). Safe to run twice. The website keeps working before this
-- is pasted (it falls back to the old behaviour when a new function is missing).
--
-- 1. hod_set_question_state ("Put it back" no longer strands a question).
--    Before: an HOD left out a question a student had passed (go-live preview, 20261126300000), changed their mind and
--    pressed Put it back. 'reopen' cleared the leave-out and the pass, but the question stayed in a student bucket, which
--    the Needs you list never shows and 'pass' refuses ("still with the student checkers"). The paper was stuck.
--    After: when a question of a paper waiting to go live is put back and it sits in a student bucket, then
--      * if it was PASSED before it was left out (the 'admin_set_aside' log row stores that state), it is passed again;
--      * otherwise it moves to the HOD bucket ('admin'), so it shows in Needs you and can be settled there.
--    Everything else is word for word as in 20261126300000.
-- 2. hod_queue_paper (NEW): an HOD can put a finished paper on the Ready to go live list. Before, only the pipeline could
--    (queue_paper_for_approval is closed to everyone else), so "Open it in Ready to go live" led to a paper that was not
--    on the list and could not be published. Safe by design: new pipeline papers only (source new_ocr, not live, not on
--    the list yet, not marked red), no open question, at least one passed question, and every picture of a passed question already on the
--    site (the pipeline copies them; an HOD cannot). It writes the same fields queue_paper_for_approval writes and one
--    audit_review_log row with the HOD as the actor. The four go-live checks still run at Publish.
-- 2b. hod_unqueued_papers (NEW): says WHICH papers the Ready list banner counts, so the HOD can open each one.
-- 3. hod_held_other_papers (NEW): the third list of the Assignments tab, "Held for another reason": papers with work for a
--    checker that are on neither "Papers nobody has" nor "Not ready to give out", with ONE reason key per paper
--    ('wrong_pdf', 'english_reread', 'reference_pages', 'text', 'other'). Read only.
-- 4. hod_unassigned_papers: skips live Maths copies, like Auto assign all does (the number shown could be higher than
--    anything the button could hand out).
-- 5. distribute_unassigned_papers: records who pressed the button (assigned_by = the HOD). The two background callers
--    (service role, no signed-in person) still record null = "Automatic". Nothing else changes.

-- 1 -------------------------------------------------------------------------------------------------------------------
create or replace function public.hod_set_question_state(p_question_id uuid, p_state text, p_note text default null)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q public.audit_questions;
  v_approval text;
  v_before text;
  v_res text;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  if p_state not in ('pass', 'set_aside', 'reopen') then
    raise exception 'Choose pass, set aside or reopen.' using errcode = '22023';
  end if;
  select * into v_q from public.audit_questions where id = p_question_id;
  if v_q.id is null then
    raise exception 'That question could not be found.' using errcode = 'P0002';
  end if;
  select ap.approval_state into v_approval from public.audit_papers ap where ap.id = v_q.paper_id;

  -- Leave out any question of a paper waiting to go live (20261126300000), with a note.
  if p_state = 'set_aside' and v_approval = 'awaiting' then
    if nullif(btrim(coalesce(p_note, '')), '') is null then
      raise exception 'Say why the question is left out.' using errcode = '22023';
    end if;
    return public.approval_set_question_state(p_question_id, p_state, p_note);
  end if;

  -- NEW (20261127110000): put back a question that was left out of a paper waiting to go live while it sat in a student
  -- bucket. Give it back the state it had, or send it to the HOD so it can be settled in Needs you.
  if p_state = 'reopen' and v_approval = 'awaiting' and v_q.set_aside_at is not null
     and v_q.review_bucket not in ('escalated', 'admin') then
    v_res := public.approval_set_question_state(p_question_id, p_state, p_note);
    select l.before ->> 'state' into v_before
      from public.audit_review_log l
     where l.question_id = p_question_id and l.action = 'admin_set_aside'
     order by l.at desc
     limit 1;
    if v_before = 'passed' then
      return public.approval_set_question_state(p_question_id, 'pass', 'Put back as it was: it was already passed before it was left out.');
    end if;
    update public.audit_questions
       set review_bucket = 'admin', locked_by = null, locked_until = null
     where id = p_question_id;
    return v_res;
  end if;

  if p_state in ('pass', 'set_aside')
     and v_q.review_bucket not in ('escalated', 'admin')
     and v_q.set_aside_at is null then
    raise exception 'This question is still with the student checkers.' using errcode = '55000';
  end if;
  return public.approval_set_question_state(p_question_id, p_state, p_note);
end;
$function$;

revoke all on function public.hod_set_question_state(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hod_set_question_state(uuid, text, text) to authenticated;

-- 2 -------------------------------------------------------------------------------------------------------------------
create or replace function public.hod_queue_paper(p_audit_paper_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_p public.audit_papers;
  v_open integer;
  v_passed integer;
  v_unstaged integer;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  select * into v_p from public.audit_papers where id = p_audit_paper_id for update;
  if v_p.id is null then
    raise exception 'That paper could not be found.' using errcode = 'P0002';
  end if;
  if v_p.source is distinct from 'new_ocr' then
    raise exception 'Only papers from the pipeline can be put on the Ready list.' using errcode = '55000';
  end if;
  if v_p.approval_state = 'awaiting' then
    return 'already';
  end if;
  if v_p.approval_state is not null then
    raise exception 'This paper cannot be put on the Ready list (it is already %).', v_p.approval_state using errcode = '55000';
  end if;
  if v_p.live_bank_paper_id is not null then
    raise exception 'This paper is already live.' using errcode = '55000';
  end if;
  if coalesce(v_p.is_red, false) then
    raise exception 'This paper is marked red (it has a problem), so it cannot be put on the Ready list yet.' using errcode = '55000';
  end if;

  select count(*) filter (where public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open'),
         count(*) filter (where public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'passed')
    into v_open, v_passed
    from public.audit_questions q where q.paper_id = p_audit_paper_id;
  if v_open > 0 then
    raise exception '% still open. Settle every question first.',
      v_open || case when v_open = 1 then ' question is' else ' questions are' end using errcode = '55000';
  end if;
  if v_passed = 0 then
    raise exception 'No question is passed yet. At least one must be passed.' using errcode = '55000';
  end if;
  select count(*) into v_unstaged
    from public.audit_questions q
   where q.paper_id = p_audit_paper_id and q.kind = 'question' and q.question_passed
     and (q.figure ->> 'path') is null
     and exists (select 1 from public.audit_figures f where f.question_id = q.id and f.status = 'active');
  if v_unstaged > 0 then
    raise exception '% not on the site yet. The pictures have to be copied first (the owner does this).',
      v_unstaged || case when v_unstaged = 1 then ' picture is' else ' pictures are' end using errcode = '55000';
  end if;

  update public.audit_papers
     set approval_state = 'awaiting', approval_kind = 'new', queued_at = now(),
         rejected_at = null, rejected_by = null
   where id = p_audit_paper_id;

  insert into public.audit_review_log (actor_user_id, paper_id, question_id, action, before, after, note)
  values (auth.uid(), p_audit_paper_id, null, 'queued_for_approval',
          jsonb_build_object('approval_state', v_p.approval_state),
          jsonb_build_object('approval_state', 'awaiting', 'kind', 'new'),
          'Put on the Ready to go live list by an HOD');
  return 'queued';
end;
$function$;

revoke all on function public.hod_queue_paper(uuid) from public, anon, authenticated;
grant execute on function public.hod_queue_paper(uuid) to authenticated;

-- 2b. hod_unqueued_papers (NEW): WHICH papers the banner on Ready to go live counts (the count function says only how
--     many). Same rule as hod_unqueued_papers_count (20261105000000), read only.
create or replace function public.hod_unqueued_papers(p_limit integer default 50)
returns table(audit_paper_id uuid, title text, school text, cls text, subject text, passed_count integer, left_out integer)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  return query
    select ap.id,
           coalesce(nullif(btrim(ap.title), ''),
                    concat_ws(' ', ap.school, ap.subject, ap.class, ap.exam_type, nullif(ap.year, 'year-unknown'))),
           ap.school, ap.class, ap.subject,
           (select count(*)::integer from public.audit_questions q
             where q.paper_id = ap.id and q.kind = 'question' and q.question_passed),
           (select count(*)::integer from public.audit_questions q
             where q.paper_id = ap.id and q.kind = 'question' and not coalesce(q.question_passed, false) and q.set_aside_at is not null)
      from public.audit_papers ap
     where ap.source = 'new_ocr'
       and ap.live_bank_paper_id is null
       and ap.approval_state is null
       and not coalesce(ap.is_red, false)
       and exists (select 1 from public.audit_questions q
                    where q.paper_id = ap.id and q.kind = 'question' and q.question_passed)
       and not exists (select 1 from public.audit_questions q
                        where q.paper_id = ap.id and q.kind = 'question'
                          and not coalesce(q.question_passed, false) and q.set_aside_at is null)
     order by ap.id
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$function$;

revoke all on function public.hod_unqueued_papers(integer) from public, anon, authenticated;
grant execute on function public.hod_unqueued_papers(integer) to authenticated;

-- 3 -------------------------------------------------------------------------------------------------------------------
create or replace function public.hod_held_other_papers(p_limit integer default 200)
returns table(paper_id uuid, subject text, school text, cls text, exam text, year text, open_count integer, reason text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    with cand as materialized (
      select ap.id, ap.subject, ap.school, ap.class as cls, ap.exam_type as exam, ap.year,
             ('pdf_mismatch' = any (coalesce(ap.flag_reasons, '{}'::text[]))) as wrong_pdf
        from public.audit_papers ap
       where ap.source = 'new_ocr'
         and exists (select 1 from public.audit_questions q
                      where q.paper_id = ap.id and q.kind = 'question' and q.review_bucket = 'kid'
                        and q.question_passed = false and q.set_aside_at is null)
         and not exists (select 1 from public.checker_assignments a
                          where a.audit_paper_id = ap.id and a.status in ('queued', 'assigned'))
    ),
    per as (
      select c.*,
             (select count(*) from public.audit_questions q
               where q.paper_id = c.id and q.kind = 'question' and q.review_bucket = 'kid'
                 and q.question_passed = false and q.set_aside_at is null)::int as n_open,
             (select count(*) from public.audit_questions q
               where q.paper_id = c.id and q.kind = 'question' and q.review_bucket = 'kid'
                 and q.question_passed = false and q.set_aside_at is null
                 and public.checker_question_servable(q))::int as n_serv,
             (select count(*) from public.audit_questions q
               where q.paper_id = c.id and q.kind = 'question' and q.review_bucket = 'kid'
                 and q.question_passed = false and q.set_aside_at is null
                 and coalesce(q.source ->> 'pipeline', '') = 'english_w14')::int as n_w14,
             (select count(*) from public.audit_questions q
               where q.paper_id = c.id and q.kind = 'question' and q.review_bucket = 'kid'
                 and q.question_passed = false and q.set_aside_at is null
                 and not coalesce(public.checker_reference_ok(q), false))::int as n_noref,
             (select count(*) from public.audit_questions q
               where q.paper_id = c.id and q.kind = 'question' and q.review_bucket = 'kid'
                 and q.question_passed = false and q.set_aside_at is null
                 and not coalesce(public.checker_body_ok(q), false))::int as n_nobody
        from cand c
    )
    select p.id, p.subject, p.school, p.cls, p.exam, p.year, p.n_open,
           case when p.wrong_pdf then 'wrong_pdf'
                when p.n_serv = 0 and p.n_w14 > 0 then 'english_reread'
                when p.n_serv = 0 and p.n_noref > 0 then 'reference_pages'
                when p.n_serv = 0 and p.n_nobody > 0 then 'text'
                else 'other' end
      from per p
      cross join lateral public.paper_picture_gaps(p.id) g
     -- NOT already on "Papers nobody has" (a servable question and a complete picture set) ...
     where not (p.n_serv > 0 and public.paper_pictures_complete(p.id))
     -- ... and NOT already on "Not ready to give out" (missing pictures or pages, not a wrong PDF).
       and not (not p.wrong_pdf and g.open_questions > 0 and (g.missing_snips > 0 or g.pages_missing > 0))
     order by p.subject, p.cls, p.id
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$function$;

revoke all on function public.hod_held_other_papers(integer) from public, anon, authenticated;
grant execute on function public.hod_held_other_papers(integer) to authenticated;

-- 4 -------------------------------------------------------------------------------------------------------------------
create or replace function public.hod_unassigned_papers(p_limit integer default 200)
returns table(paper_id uuid, subject text, school text, cls text, exam text, year text, open_count integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_free uuid[];
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- The papers nobody holds that still have an open question for a checker (cheap). Live Maths copies are left out
  -- (NEW, 20261127110000), exactly as Auto assign all leaves them out.
  select coalesce(array_agg(ap.id), '{}'::uuid[]) into v_free
    from public.audit_papers ap
   where ap.source is distinct from 'live_copy'
     and not exists (select 1 from public.checker_assignments a
                      where a.audit_paper_id = ap.id and a.status in ('queued', 'assigned'))
     and exists (select 1 from public.audit_questions q0
                  where q0.paper_id = ap.id and q0.review_bucket = 'kid'
                    and q0.question_passed = false and q0.kind = 'question');

  -- The expensive per-question check now runs only on the questions of those papers.
  return query
    select c.pid, ap.subject, ap.school, ap.class, ap.exam_type, ap.year, c.n
      from (select q.paper_id as pid, count(*)::int as n
              from public.audit_questions q
             where q.paper_id = any (v_free)
               and q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question'
               and public.checker_question_servable(q)
             group by q.paper_id) c
      join public.audit_papers ap on ap.id = c.pid
     where public.paper_pictures_complete(c.pid)
     order by ap.subject, ap.class, c.n desc
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$function$;

revoke all on function public.hod_unassigned_papers(integer) from public, anon, authenticated;
grant execute on function public.hod_unassigned_papers(integer) to authenticated;

-- 5 -------------------------------------------------------------------------------------------------------------------
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
    values (p.paper_id, v_user, auth.uid(), 'assigned', now()) on conflict do nothing;  -- NEW: who pressed the button (null for the background callers)
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

revoke all on function public.distribute_unassigned_papers() from public, anon, authenticated;
grant execute on function public.distribute_unassigned_papers() to authenticated;
