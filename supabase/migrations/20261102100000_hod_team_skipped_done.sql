-- 20261102100000: "Later corrected" on the HOD desk Verifiers tab (tracker bug, 2 November 2026).
--
-- The column was fed by `overturned` (questions a verifier passed that someone else later fixed), so it stayed at 0 for a
-- verifier who skipped questions and then went back and dealt with them. hod_team() gains `skipped_done`: the distinct
-- questions this verifier skipped and then dealt with themselves afterwards (pass, fix, printed typo, split, or sent to the
-- HOD). It reads the counted log, so an answer the verifier undid does not count. `overturned` stays as it was; the screen
-- now calls it "Fixed by others". Same people, same other counts, same ordering (the positional `order by 11 desc, 2` still
-- means reviewed_all, then name).
--
-- The return type changes, so the function is dropped and created again. Nothing else in the database refers to it
-- (checked against pg_proc and pg_views on 2 November 2026). Rule for every hod_* function: closed to public, anon AND
-- authenticated by name, then granted to authenticated; service_role keeps the default grant it already had.
--
-- Rollback: drop function public.hod_team(); then run the 18-column body kept in the comment at the foot of this file
-- (the live body as read on 2 November 2026), then the same revoke and grant lines.

drop function public.hod_team();

create function public.hod_team()
returns table (
  user_id uuid, name text, email text, active boolean, subjects text[], classes text[],
  papers_held integer, questions_waiting integer, reviewed_today integer, reviewed_7d integer, reviewed_all integer,
  papers_reviewed integer, passed_as_is integer, edited integer, escalated integer, skipped integer,
  skipped_done integer, overturned integer, last_active timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_today timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
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
        and exists (select 1 from acts d
                    where d.uid = s.uid and d.question_id = s.question_id
                      and d.action <> 'checker_skip' and d.at > s.at)
      group by s.uid
    ),
    held as (
      select a.user_id, count(*)::int as papers,
             sum((select count(*) from public.audit_questions q
                  where q.paper_id = a.audit_paper_id and q.review_bucket = 'kid'
                    and q.question_passed = false and q.kind = 'question'
                    and public.checker_question_servable(q)))::int as waiting
      from public.checker_assignments a
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

revoke all on function public.hod_team() from public, anon, authenticated;
grant execute on function public.hod_team() to authenticated;

-- Rollback body (the live function as read on 2 November 2026; 18 columns, no skipped_done):
--
--   create function public.hod_team()
--   returns table (user_id uuid, name text, email text, active boolean, subjects text[], classes text[],
--     papers_held integer, questions_waiting integer, reviewed_today integer, reviewed_7d integer, reviewed_all integer,
--     papers_reviewed integer, passed_as_is integer, edited integer, escalated integer, skipped integer, overturned integer,
--     last_active timestamptz)
--   ... the same body as above without the `later` CTE, without `coalesce(l.n, 0),` in the select list and without
--   `left join later l on l.uid = p.user_id`.
