-- 20261127130000: the hand-out lists and Auto assign all were timing out (27 Nov 2026, owner screenshot: "The list of free
-- papers did not load. This is taking longer than it should"). Also: papers that are SET ASIDE (marked red) are never
-- handed out and never listed as free (owner decision, 27 Nov 2026).
--
-- WHY IT WAS SLOW
--   Since 26 Nov nothing is given out automatically, so almost EVERY paper with open work is "free". The 13 Nov speed fix
--   (20261113310000) only helped while few papers were free: it ran the per-question picture check on the free papers'
--   questions, and that is now nearly all of them (several thousand open student questions after the 26 Nov load; the timing check K0 shows the exact work).
--   For each of those questions the database ran a chain of small functions (checker_question_servable ->
--   checker_body_ok, checker_has_picture -> checker_page_fallback_ok -> paper_all_pages_stored, checker_reference_ok ...),
--   and then ran checker_has_picture AGAIN for every question inside paper_pictures_complete / paper_picture_gaps. Every
--   one of those calls costs a call set-up, and paper_all_pages_stored re-counted the paper's pages for every question
--   whose page was "not found". On 13 Nov this cost about 3.7 ms per question (7.5 s for ~2,000 questions), so several
--   thousand questions is far past the 8 second limit. The three lists (Papers nobody has, Not ready to give out, Held for
--   another reason), the Pipeline route strip and Auto assign all all walk the same questions.
--
-- WHAT CHANGES (same answers, far fewer steps)
--   1. paper_handout_facts(paper ids) (NEW, closed to every client role): ONE set-based query that works out, for each
--      paper given, the counts every list needs: open questions, questions a checker can be given, questions held
--      for each reason, questions missing a picture, printed pages missing. Each paper's page count is worked out ONCE
--      (not once per question) and each question's picture rule ONCE (not twice). The rules are the same text as
--      checker_question_servable / checker_has_picture / checker_reference_ok / checker_body_ok /
--      paper_picture_gaps, written as joins instead of one function call per question. Those functions are NOT
--      changed (the checker screens still use them); src/lib/handout-speed-migration.test.ts proves, row for row on
--      a realistic synthetic data set, that old and new agree.
--   2. hod_unassigned_papers, hod_held_back_papers, hod_held_other_papers and distribute_unassigned_papers read
--      paper_handout_facts instead of calling the per-question functions. Same columns, same rules, same order
--      (with the paper id added as the last tie-break), same grants. distribute_unassigned_papers also reads each
--      checker's current load from the same facts instead of re-checking every question of every held paper.
--   3. One small index (create index if not exists, NOT concurrent: it takes a very short write lock on
--      audit_questions, well under a second at this size) that matches the facts query exactly. The other indexes the
--      query needs already exist: audit_paper_pages primary key (audit_paper_id, page), checker_assignments
--      partial unique index (audit_paper_id) where status in ('queued','assigned'), audit_questions
--      idx_audit_questions_open_by_paper (paper_id) where kind = 'question' and question_passed = false.
--
-- SET ASIDE PAPERS (audit_papers.is_red = true, status 'red', red_reason says why; this is how the project parks a paper,
-- for example the duplicate ICSE Maths 2025 copy ac157e93 in the 26 Nov three paper fixes)
--   * hod_unassigned_papers and distribute_unassigned_papers leave them out.
--   * hod_assign_paper refuses them (a paper already held by the person it is given to again is left alone).
--   * hod_held_back_papers leaves them out (their story is not "missing pictures").
--   * hod_held_other_papers lists them with the new reason 'set_aside'.
--   Nothing is deleted or moved.
--
-- Rollback: create or replace the three functions again from 20261127110000_hod_sitewide_audit_fixes.sql
-- (hod_unassigned_papers, hod_held_other_papers, distribute_unassigned_papers) and hod_held_back_papers from
-- 20261113310000_hod_lists_speed.sql; hod_assign_paper from its live text without the "set aside" block; then
-- drop function public.paper_handout_facts(uuid[]); drop index if exists public.audit_questions_kid_open_paper_idx.
-- Safe to run twice.

-- 1. The index -------------------------------------------------------------------------------------------------------
create index if not exists audit_questions_kid_open_paper_idx
  on public.audit_questions (paper_id)
  where kind = 'question' and review_bucket = 'kid' and question_passed = false;

-- 2. paper_handout_facts ---------------------------------------------------------------------------------------------
create or replace function public.paper_handout_facts(p_paper_ids uuid[])
returns table(paper_id uuid, n_open integer, n_serv integer, n_w14 integer, n_noref integer, n_nobody integer,
              missing_snips integer, pages_total integer, pages_missing integer)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with pp as materialized (
    -- per PAPER, once: its page count, how many of its printed pages are stored, and the paper-level part of
    -- checker_question_servable (a live copy or a new OCR paper that is not a wrong PDF).
    select ap.id,
           coalesce(ap.page_count, 0) as pc,
           coalesce(ap.source in ('live_copy', 'new_ocr')
                    and not ('pdf_mismatch' = any (coalesce(ap.flag_reasons, '{}'::text[]))), false) as paper_ok,
           coalesce((select count(distinct pg.page)::int
                       from public.audit_paper_pages pg
                      where pg.audit_paper_id = ap.id
                        and coalesce(pg.object_path, '') <> ''
                        and pg.page between 1 and coalesce(ap.page_count, 0)), 0) as n_stored
      from public.audit_papers ap
     where ap.id = any (coalesce(p_paper_ids, '{}'::uuid[]))
  ),
  pf as materialized (
    select pp.id, pp.pc, pp.paper_ok, pp.n_stored,
           -- paper_all_pages_stored(): a known page count and every page 1..page_count stored
           (pp.pc > 0 and pp.n_stored = pp.pc) as all_stored
      from pp
  ),
  qb as materialized (
    -- per QUESTION, once: the picture rule, the reading-reference rule and the body rule.
    select q.paper_id,
           pf.paper_ok,
           (q.set_aside_at is null) as live_q,
           (coalesce(q.source ->> 'pipeline', '') = 'english_w14') as is_w14,
           -- checker_body_ok
           (btrim(coalesce(q.body, '')) <> '' or (coalesce(q.flag_detail, '') like '%suggestion: {%body%')) as body_ok,
           -- the "incomplete text" branch of checker_question_servable (may be null, like the original)
           ('incomplete_text' = any (coalesce(q.flag_reasons, '{}'::text[]))
            and coalesce(q.source ->> 'page_verified', '') = 'true'
            and (q.source ->> 'page') ~ '^[0-9]{1,3}$'
            and exists (
                  select 1 from public.audit_paper_pages pg
                  where pg.audit_paper_id = q.paper_id
                    and pg.page = case when (q.source ->> 'page') ~ '^[0-9]{1,3}$' then (q.source ->> 'page')::int end)
           ) as inc_ok,
           -- checker_has_picture (may be null, like the original)
           (coalesce(q.source ->> 'whole_snippet_object', '') <> ''
            or (coalesce(q.source ->> 'snippet_object', '') <> ''
                and (case when coalesce(q.source ->> 'align_score', '') = '' then true
                          when (q.source ->> 'align_score') ~ '^-?[0-9]+(\.[0-9]+)?$' then (q.source ->> 'align_score')::numeric >= 0.9
                          else false end))
            or coalesce(par.id is not null
                        and (coalesce(par.source ->> 'whole_snippet_object', '') <> ''
                             or (coalesce(par.source ->> 'snippet_object', '') <> ''
                                 and (case when coalesce(par.source ->> 'align_score', '') = '' then true
                                           when (par.source ->> 'align_score') ~ '^-?[0-9]+(\.[0-9]+)?$' then (par.source ->> 'align_score')::numeric >= 0.9
                                           else false end))), false)
            or (q.source ->> 'page_verified' = 'true'
                and (q.source ->> 'page') ~ '^[0-9]{1,3}$'
                and exists (
                      select 1 from public.audit_paper_pages pg
                      where pg.audit_paper_id = q.paper_id
                        and pg.page = case when (q.source ->> 'page') ~ '^[0-9]{1,3}$' then (q.source ->> 'page')::int end))
            -- checker_page_fallback_ok: the page was looked for and not found, and every page of the paper is stored
            or (coalesce(q.source ->> 'page_verified', '') = 'false' and pf.all_stored)
           ) as hp,
           -- checker_reference_ok
           (not (
              ('figure_missing' = any (coalesce(q.flag_reasons, '{}'::text[])))
              or coalesce(q.figure::text, 'null') not in ('null', '{}', '[]', '""')
              or coalesce(par.id is not null
                          and ('figure_missing' = any (coalesce(par.flag_reasons, '{}'::text[]))
                               or coalesce(par.figure::text, 'null') not in ('null', '{}', '[]', '""')
                               or coalesce(par.body, '') ~* '\mtable\M'
                               or position('|' in coalesce(par.body, '')) > 0
                               or length(coalesce(par.body, '')) > 300
                               or coalesce(par.source -> 'swarm' ->> 'kind', '') = 'passage'), false)
            )
            or coalesce(q.source ->> 'whole_snippet_object', '') <> ''
            or coalesce(par.id is not null and coalesce(par.source ->> 'whole_snippet_object', '') <> '', false)
            or (
              (lq.pg is not null or lp.pg is not null)
              and not (
                (lq.pg is not null
                 and not exists (select 1 from public.audit_paper_pages a
                                  where a.audit_paper_id = q.paper_id and a.page = lq.pg))
                or (lp.pg is not null
                    and not exists (select 1 from public.audit_paper_pages a
                                     where a.audit_paper_id = par.paper_id and a.page = lp.pg))
              )
            )
            or (coalesce(q.source ->> 'page_verified', '') = 'false' and pf.all_stored)
           ) as ref_ok
      from public.audit_questions q
      join pf on pf.id = q.paper_id
      left join public.audit_questions par on par.id = q.parent_id
      cross join lateral (select case when (q.source ->> 'page') ~ '^[0-9]{1,3}$' then (q.source ->> 'page')::int end as pg) lq
      cross join lateral (select case when (par.source ->> 'page') ~ '^[0-9]{1,3}$' then (par.source ->> 'page')::int end as pg) lp
     where q.paper_id = any (coalesce(p_paper_ids, '{}'::uuid[]))
       and q.kind = 'question' and q.review_bucket = 'kid' and q.question_passed = false
  ),
  agg as (
    select qb.paper_id as pid,
           count(*) filter (where qb.live_q)::int as n_open,
           -- checker_question_servable (a null part counts as "no", as before)
           count(*) filter (where qb.live_q
                              and (coalesce(qb.body_ok, false) or qb.inc_ok)
                              and qb.hp and qb.ref_ok
                              and not qb.is_w14
                              and qb.paper_ok)::int as n_serv,
           count(*) filter (where qb.live_q and qb.is_w14)::int as n_w14,
           count(*) filter (where qb.live_q and not coalesce(qb.ref_ok, false))::int as n_noref,
           count(*) filter (where qb.live_q and not coalesce(qb.body_ok, false))::int as n_nobody,
           -- paper_picture_gaps.missing_snips (a null picture answer is not counted, as before)
           count(*) filter (where qb.live_q and not qb.hp)::int as missing_snips
      from qb
     group by qb.paper_id
  )
  select pf.id,
         coalesce(a.n_open, 0), coalesce(a.n_serv, 0), coalesce(a.n_w14, 0), coalesce(a.n_noref, 0),
         coalesce(a.n_nobody, 0), coalesce(a.missing_snips, 0),
         pf.pc, greatest(pf.pc - pf.n_stored, 0)
    from pf
    left join agg a on a.pid = pf.id;
$function$;

revoke all on function public.paper_handout_facts(uuid[]) from public, anon, authenticated;

-- 3. Papers nobody has ------------------------------------------------------------------------------------------------
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

  -- The papers nobody holds that still have an open question for a checker. Live Maths copies and papers that are set
  -- aside (marked red) are left out, exactly as Auto assign all leaves them out.
  select coalesce(array_agg(ap.id), '{}'::uuid[]) into v_free
    from public.audit_papers ap
   where ap.source is distinct from 'live_copy'
     and not (coalesce(ap.is_red, false) or coalesce(ap.status, '') = 'red')
     and not exists (select 1 from public.checker_assignments a
                      where a.audit_paper_id = ap.id and a.status in ('queued', 'assigned'))
     and exists (select 1 from public.audit_questions q0
                  where q0.paper_id = ap.id and q0.review_bucket = 'kid'
                    and q0.question_passed = false and q0.kind = 'question');

  -- One pass over their questions, then the papers with a question a checker can be given and a complete picture set.
  return query
    select f.paper_id, ap.subject, ap.school, ap.class, ap.exam_type, ap.year, f.n_serv
      from public.paper_handout_facts(v_free) f
      join public.audit_papers ap on ap.id = f.paper_id
     where f.n_serv > 0 and f.missing_snips = 0 and f.pages_missing = 0
     order by ap.subject, ap.class, f.n_serv desc, f.paper_id
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$function$;

revoke all on function public.hod_unassigned_papers(integer) from public, anon, authenticated;
grant execute on function public.hod_unassigned_papers(integer) to authenticated;

-- 4. Not ready to give out --------------------------------------------------------------------------------------------
create or replace function public.hod_held_back_papers(p_limit integer default 200)
returns table(paper_id uuid, subject text, school text, cls text, exam text, year text, open_count integer, missing_snips integer, pages_total integer, pages_missing integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_cand uuid[];
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select coalesce(array_agg(ap.id), '{}'::uuid[]) into v_cand
    from public.audit_papers ap
   where ap.source in ('new_ocr', 'live_copy')
     and not ('pdf_mismatch' = any (coalesce(ap.flag_reasons, '{}'::text[])))
     and not (coalesce(ap.is_red, false) or coalesce(ap.status, '') = 'red')
     and exists (select 1 from public.audit_questions q
                  where q.paper_id = ap.id and q.kind = 'question' and q.review_bucket = 'kid'
                    and q.question_passed = false and q.set_aside_at is null)
     and not exists (select 1 from public.checker_assignments a
                      where a.audit_paper_id = ap.id and a.status in ('queued', 'assigned'));

  return query
    select ap.id, ap.subject, ap.school, ap.class, ap.exam_type, ap.year,
           f.n_open, f.missing_snips, f.pages_total, f.pages_missing
      from public.paper_handout_facts(v_cand) f
      join public.audit_papers ap on ap.id = f.paper_id
     where f.n_open > 0
       and (f.missing_snips > 0 or f.pages_missing > 0)
     order by (f.missing_snips + f.pages_missing), ap.subject, ap.class, ap.id
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$function$;

revoke all on function public.hod_held_back_papers(integer) from public, anon, authenticated;
grant execute on function public.hod_held_back_papers(integer) to authenticated;

-- 5. Held for another reason (and set aside) ---------------------------------------------------------------------------
create or replace function public.hod_held_other_papers(p_limit integer default 200)
returns table(paper_id uuid, subject text, school text, cls text, exam text, year text, open_count integer, reason text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_cand uuid[];
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select coalesce(array_agg(ap.id), '{}'::uuid[]) into v_cand
    from public.audit_papers ap
   where (ap.source = 'new_ocr' or coalesce(ap.is_red, false) or coalesce(ap.status, '') = 'red')
     and exists (select 1 from public.audit_questions q
                  where q.paper_id = ap.id and q.kind = 'question' and q.review_bucket = 'kid'
                    and q.question_passed = false and q.set_aside_at is null)
     and not exists (select 1 from public.checker_assignments a
                      where a.audit_paper_id = ap.id and a.status in ('queued', 'assigned'));

  return query
    select ap.id, ap.subject, ap.school, ap.class, ap.exam_type, ap.year, f.n_open,
           case when (coalesce(ap.is_red, false) or coalesce(ap.status, '') = 'red') then 'set_aside'
                when 'pdf_mismatch' = any (coalesce(ap.flag_reasons, '{}'::text[])) then 'wrong_pdf'
                when f.n_serv = 0 and f.n_w14 > 0 then 'english_reread'
                when f.n_serv = 0 and f.n_noref > 0 then 'reference_pages'
                when f.n_serv = 0 and f.n_nobody > 0 then 'text'
                else 'other' end
      from public.paper_handout_facts(v_cand) f
      join public.audit_papers ap on ap.id = f.paper_id
     where
       -- a paper that is set aside is always shown here, with that reason ...
       (coalesce(ap.is_red, false) or coalesce(ap.status, '') = 'red')
       -- ... any other paper only when it is NOT already on "Papers nobody has" (a servable question and a complete
       -- picture set) and NOT already on "Not ready to give out" (missing pictures or pages, not a wrong PDF).
       or (ap.source = 'new_ocr'
           and not (f.n_serv > 0 and f.missing_snips = 0 and f.pages_missing = 0)
           and not (not ('pdf_mismatch' = any (coalesce(ap.flag_reasons, '{}'::text[])))
                    and f.n_open > 0 and (f.missing_snips > 0 or f.pages_missing > 0)))
     order by ap.subject, ap.class, ap.id
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$function$;

revoke all on function public.hod_held_other_papers(integer) from public, anon, authenticated;
grant execute on function public.hod_held_other_papers(integer) to authenticated;

-- 6. Auto assign all --------------------------------------------------------------------------------------------------
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

  -- The papers nobody holds that still have an open question for a checker. Live Maths copies and papers that are set
  -- aside (marked red) are never handed out (NEW: set aside).
  select coalesce(array_agg(ap.id), '{}'::uuid[]) into v_free
    from public.audit_papers ap
   where ap.source is distinct from 'live_copy'
     and not (coalesce(ap.is_red, false) or coalesce(ap.status, '') = 'red')
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
    from (select f.paper_id, f.n_serv as n
            from public.paper_handout_facts(v_free) f
           where f.n_serv > 0 and f.missing_snips = 0 and f.pages_missing = 0) c
    join public.audit_papers ap on ap.id = c.paper_id
    where ap.source is distinct from 'live_copy'
      and not exists (select 1 from public.checker_assignments a
                      where a.audit_paper_id = c.paper_id and a.status in ('queued', 'assigned'))
  ) x;
  if not found then return 0; end if;
  create temp table if not exists _dist_load (user_id uuid, grade int, grade_known boolean, board text, preferred text[],
                                              school text, load int, papers int) on commit drop;
  truncate _dist_load;
  -- Each checker's load and number of papers with work: read from the same facts, once for all held papers.
  insert into _dist_load
  with hf as materialized (
    select f.paper_id, f.n_serv
      from public.paper_handout_facts(
             (select coalesce(array_agg(a.audit_paper_id), '{}'::uuid[])
                from public.checker_assignments a where a.status in ('queued', 'assigned'))) f
  )
  select pc.user_id, coalesce(vp.grade, 12), vp.grade is not null, public.board_family(vp.board),
         (select array_agg(public.subject_family(s)) from unnest(vp.preferred_subjects) s),
         public.school_norm(vp.school),
         coalesce((select sum(hf.n_serv)::int from public.checker_assignments a
                   join hf on hf.paper_id = a.audit_paper_id
                   where a.user_id = pc.user_id and a.status in ('queued', 'assigned')), 0),
         (select count(*)::int from public.checker_assignments a
          join hf on hf.paper_id = a.audit_paper_id
          where a.user_id = pc.user_id and a.status in ('queued', 'assigned') and hf.n_serv > 0)
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
    values (p.paper_id, v_user, auth.uid(), 'assigned', now()) on conflict do nothing;  -- who pressed the button (null for the background callers)
    if found then
      update _dist_load set load = load + p.n, papers = papers + 1 where user_id = v_user;
      insert into _dist_held values (v_user, p.subject, p.grade);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$function$;

revoke all on function public.distribute_unassigned_papers() from public, anon, authenticated;
grant execute on function public.distribute_unassigned_papers() to authenticated;

-- 7. hod_assign_paper refuses a paper that is set aside, patched from the live text (the rule about missing pictures is kept).
do $patch$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.hod_assign_paper(uuid,uuid)'::regprocedure) into v_def;
  if v_def !~ 'set aside' then
    v_new := regexp_replace(
      v_def,
      '(select \* into v_prev from public\.checker_assignments\s+where audit_paper_id = p_paper_id and status in \(''queued'', ''assigned''\) for update;)',
      E'\\1\n  if exists (select 1 from public.audit_papers sa where sa.id = p_paper_id\n                and (coalesce(sa.is_red, false) or coalesce(sa.status, '''') = ''red''))\n     and v_prev.user_id is distinct from p_user_id then\n    raise exception ''This paper is set aside (marked red), so it cannot be given out.'' using errcode = ''22023'';\n  end if;');
    if v_new = v_def then
      raise exception 'could not patch hod_assign_paper (anchor not found)';
    end if;
    execute v_new;
  end if;
end
$patch$;
