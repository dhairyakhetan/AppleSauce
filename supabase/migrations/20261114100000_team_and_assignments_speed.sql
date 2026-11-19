-- Two slow HOD desk lists made fast (14 Nov 2026): the Team tab (hod_team, about 4 seconds) and "Who has what"
-- (hod_assignments, about 2 seconds). Same rows, same order, same rules, same doors.
--
-- WHY THEY WERE SLOW (measured on live data, in rolled-back rehearsals; nothing was changed to measure):
--   Both lists count, for every paper a person holds, the questions a checker can still be given. They did it by calling the
--   per-question check checker_question_servable once per question (about 2,000 questions). That check is itself a little
--   function that calls three more little functions and then looks the paper up, and the database sets all of that up again
--   from scratch on every single call: about 1 to 1.7 thousandths of a second per question, which is the whole 2 seconds.
--   The three little functions themselves are cheap (about 0.2 seconds for all 2,000 questions together), and the paper lookup
--   becomes a plain join when it is written out flat.
--
-- THE FIX: the same test, written out flat ONCE in a new internal helper, hod_held_papers_waiting(). It uses exactly the same
--   rules as checker_question_servable and calls the same three little functions (checker_body_ok, checker_has_picture,
--   checker_reference_ok), so those rules still live in one place each. It only looks at papers somebody holds (queued or
--   assigned), which are the only papers either list ever asks about. Both lists now read their counts from it.
--   checker_question_servable itself is NOT changed (the checker screens and the hand-out job still use it).
--   If the rules in checker_question_servable ever change, change hod_held_papers_waiting to match (the marker comment in it
--   says so); a test in the repository pins the pieces.
--
-- Nothing else changes: hod_team keeps every column and the way it is ordered, hod_assignments the same, same grants.
-- One tiny addition: hod_assignments now breaks a tie between two papers given to the same person at the same moment by
-- the assignment number, so the list no longer shuffles those rows from one refresh to the next (they were in no set order).
--
-- PROOF (rolled-back rehearsals on live data, 14 Nov 2026): hod_team 3.7 s -> 0.4 s and hod_assignments 2.1 to 4.5 s (the server's load varies) -> 0.26 to 0.49 s;
-- old and new rows identical both ways (EXCEPT in each direction returned 0 rows; 14 people, 102 held papers, 1,992 waiting
-- questions in total, the same total as before).

create or replace function public.hod_held_papers_waiting()
returns table(paper_id uuid, waiting integer)
language sql
stable
set search_path = public, pg_temp
as $function$
  -- marker: held-papers-waiting-20261114. Mirrors checker_question_servable(q), written flat so it is set up once per call
  -- and not once per question. Keep the two in step.
  select q.paper_id, count(*)::int
    from public.audit_questions q
   where q.paper_id in (select a.audit_paper_id from public.checker_assignments a where a.status in ('queued', 'assigned'))
     and q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question'
     and q.set_aside_at is null
     and (
       coalesce(public.checker_body_ok(q), false)
       or (
         'incomplete_text' = any (coalesce(q.flag_reasons, '{}'::text[]))
         and coalesce(q.source ->> 'page_verified', '') = 'true'
         and (q.source ->> 'page') ~ '^[0-9]{1,3}$'
         and exists (
               select 1 from public.audit_paper_pages pg
               where pg.audit_paper_id = q.paper_id
                 and pg.page = case when (q.source ->> 'page') ~ '^[0-9]{1,3}$' then (q.source ->> 'page')::int end)
       )
     )
     and public.checker_has_picture(q)
     and public.checker_reference_ok(q)
     and coalesce(q.source ->> 'pipeline', '') <> 'english_w14'
     and exists (
       select 1 from public.audit_papers ap
       where ap.id = q.paper_id
         and ap.source in ('live_copy', 'new_ocr')
         and not ('pdf_mismatch' = any (coalesce(ap.flag_reasons, '{}'::text[])))
     )
   group by q.paper_id;
$function$;

-- Internal only: the two HOD lists below run as the database owner and call it; nobody else needs to.
revoke all on function public.hod_held_papers_waiting() from public, anon, authenticated;

create or replace function public.hod_assignments()
returns table(assignment_id bigint, status text, user_id uuid, checker_name text, paper_id uuid, subject text, school text, cls text, exam text, year text, remaining integer, given_by_name text, assigned_at timestamp with time zone, started_at timestamp with time zone)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
begin
  -- marker: team-assignments-speed-20261114 (the "remaining" counts come from hod_held_papers_waiting, worked out once)
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    with w as materialized (
      select hw.paper_id as pid, hw.waiting from public.hod_held_papers_waiting() hw
    )
    select a.id, a.status, a.user_id, public.history_actor_from_key(a.user_id::text) ->> 'name',
           a.audit_paper_id, ap.subject, ap.school, ap.class, ap.exam_type, ap.year,
           coalesce(w.waiting, 0),
           case when a.assigned_by is null then 'Automatic'
                else public.history_actor_from_key(a.assigned_by::text) ->> 'name' end,
           a.assigned_at, a.started_at
    from public.checker_assignments a
    join public.audit_papers ap on ap.id = a.audit_paper_id
    left join w on w.pid = a.audit_paper_id
    where a.status in ('assigned', 'queued')
    order by 4, case a.status when 'assigned' then 0 else 1 end, a.assigned_at, a.id;
end;
$function$;

create or replace function public.hod_team()
returns table(user_id uuid, name text, email text, active boolean, subjects text[], classes text[], papers_held integer, questions_waiting integer, reviewed_today integer, reviewed_7d integer, reviewed_all integer, papers_reviewed integer, passed_as_is integer, edited integer, escalated integer, skipped integer, skipped_done integer, overturned integer, last_active timestamp with time zone)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_today timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  -- marker: team-assignments-speed-20261114 (the "waiting" counts come from hod_held_papers_waiting, worked out once)
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    with people as (
      select pc.user_id, pc.active, pc.subjects, pc.classes from public.paper_checkers pc
    ),
    acts as (
      select l.actor_user_id as uid, l.action, l.at, l.question_id, l.paper_id
      from public.audit_review_log_counted l
      join people p on p.user_id = l.actor_user_id
      where l.action in ('checker_pass', 'checker_fix', 'checker_printed_typo', 'checker_split',
                         'checker_ask_help', 'checker_skip')
    ),
    mine as (
      select k.actor_user_id as uid, k.row_id, k.created_at
      from public.content_checks_counted k
      join people p on p.user_id = k.actor_user_id
      where k.table_name = 'audit_questions' and k.checker_kind = 'student'
    ),
    over as (
      select m.uid, count(distinct m.row_id)::int as n
      from mine m
      where exists (select 1 from public.content_checks_counted k2
                    where k2.table_name = 'audit_questions' and k2.row_id = m.row_id
                      and k2.created_at > m.created_at
                      and k2.actor_user_id is distinct from m.uid
                      and k2.verdict in ('fix', 'printed_typo'))
      group by m.uid
    ),
    later as (
      select s.uid, count(distinct s.question_id)::int as n
      from acts s
      where s.action = 'checker_skip'
        and s.question_id is not null
        and exists (select 1 from public.audit_review_log_counted d
                    where d.question_id = s.question_id
                      and d.at > s.at
                      and d.action in ('checker_pass', 'checker_fix', 'checker_printed_typo', 'checker_split',
                                       'checker_ask_help', 'admin_pass', 'admin_edit', 'set_aside',
                                       'moved_to_students'))
      group by s.uid
    ),
    w as materialized (
      select hw.paper_id as pid, hw.waiting from public.hod_held_papers_waiting() hw
    ),
    held as (
      select a.user_id, count(*)::int as papers,
             sum(coalesce(w.waiting, 0))::int as waiting
      from public.checker_assignments a
      left join w on w.pid = a.audit_paper_id
      where a.status in ('queued', 'assigned')
      group by a.user_id
    )
    select p.user_id,
           public.history_actor_from_key(p.user_id::text) ->> 'name',
           u.email::text, p.active, p.subjects, p.classes,
           coalesce(h.papers, 0), coalesce(h.waiting, 0),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action <> 'checker_skip' and a.at >= v_today),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action <> 'checker_skip' and a.at >= now() - interval '7 days'),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action <> 'checker_skip'),
           (select count(distinct a.paper_id)::int from acts a where a.uid = p.user_id and a.action <> 'checker_skip'),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action = 'checker_pass'),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action in ('checker_fix', 'checker_printed_typo', 'checker_split')),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action = 'checker_ask_help'),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action = 'checker_skip'),
           coalesce(l.n, 0),
           coalesce(o.n, 0),
           (select max(a.at) from acts a where a.uid = p.user_id)
    from people p
    join auth.users u on u.id = p.user_id
    left join held h on h.user_id = p.user_id
    left join over o on o.uid = p.user_id
    left join later l on l.uid = p.user_id
    order by p.active desc, 11 desc, 2;
end;
$function$;

-- Same doors as before: signed-in people only (each function checks HOD or admin inside).
revoke all on function public.hod_assignments() from public, anon, authenticated;
revoke all on function public.hod_team() from public, anon, authenticated;
grant execute on function public.hod_assignments() to authenticated;
grant execute on function public.hod_team() to authenticated;
