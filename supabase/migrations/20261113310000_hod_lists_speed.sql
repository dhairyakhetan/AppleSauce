-- HOD desk lists were timing out (13 Nov 2026): the database cuts any request off at 8 seconds and the Assignments list
-- (hod_unassigned_papers) took about 8 seconds, so the tab showed grey boxes and the strip showed "?".
--
-- WHY IT WAS SLOW (measured on live data, in rolled-back rehearsals):
--   * hod_unassigned_papers ran the expensive per-question check (checker_question_servable) on all ~2,000 open questions
--     of every paper, and only afterwards threw away the papers somebody already holds. The planner pushes a function
--     condition down to the question scan, so the check ran once per question and not once per paper.
--     Fix: first collect the few papers nobody holds (a plain list of ids), then check only the questions of those papers.
--     Measured: 7.5 s down to 0.03 s, same rows.
--   * hod_held_back_papers called paper_picture_gaps for every paper in the table, then dropped almost all of them.
--     Fix: keep only papers that have an open question for a checker and no holder first, then call it.
--     Measured: 0.4 s down to 0.01 s, same rows.
--   * hod_paper_trail asked "did a person verify this?" (approval_person_verdict) for every question of every paper, but the
--     answer only matters for papers waiting for approval. Now it is asked only for those. Same rows, about 25 percent faster.
--     (hod_desk_counts calls it, so the strip and the tab badges get a little faster too.)
-- Nothing else changes: same columns, same order, same rules, same grants. Old and new returned identical rows for every paper
-- in the rehearsal.

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

  -- The papers nobody holds that still have an open question for a checker (cheap).
  select coalesce(array_agg(ap.id), '{}'::uuid[]) into v_free
    from public.audit_papers ap
   where not exists (select 1 from public.checker_assignments a
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

create or replace function public.hod_held_back_papers(p_limit integer default 200)
returns table(paper_id uuid, subject text, school text, cls text, exam text, year text, open_count integer, missing_snips integer, pages_total integer, pages_missing integer)
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
      select ap.id, ap.subject, ap.school, ap.class as cls, ap.exam_type as exam, ap.year
        from public.audit_papers ap
       where ap.source in ('new_ocr', 'live_copy')
         and not ('pdf_mismatch' = any (coalesce(ap.flag_reasons, '{}'::text[])))
         and exists (select 1 from public.audit_questions q
                      where q.paper_id = ap.id and q.kind = 'question' and q.review_bucket = 'kid'
                        and q.question_passed = false and q.set_aside_at is null)
         and not exists (select 1 from public.checker_assignments a
                          where a.audit_paper_id = ap.id and a.status in ('queued', 'assigned'))
    )
    select cand.id, cand.subject, cand.school, cand.cls, cand.exam, cand.year,
           g.open_questions, g.missing_snips, g.pages_total, g.pages_missing
      from cand
      cross join lateral public.paper_picture_gaps(cand.id) g
     where g.open_questions > 0
       and (g.missing_snips > 0 or g.pages_missing > 0)
     order by (g.missing_snips + g.pages_missing), cand.subject, cand.cls, cand.id
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$function$;

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
          from (select public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) as st,
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

-- Same doors as before: signed-in people only (each function checks HOD or admin inside).
revoke all on function public.hod_unassigned_papers(integer) from public, anon, authenticated;
revoke all on function public.hod_held_back_papers(integer) from public, anon, authenticated;
revoke all on function public.hod_paper_trail() from public, anon, authenticated;
grant execute on function public.hod_unassigned_papers(integer) to authenticated;
grant execute on function public.hod_held_back_papers(integer) to authenticated;
grant execute on function public.hod_paper_trail() to authenticated;
