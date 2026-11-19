-- 20261106100000: (1) a paper put on HOLD stops answers, (2) "Later corrected" counts a skip someone else settled.
-- NOT applied by Claude. The owner pastes this into the Supabase SQL editor. The website works with or without it:
-- before it is pasted the old behaviour stays; after it, the screen already shows the right sentence (checker-errors.ts).
--
-- Both rulings were the owner's on 6 November 2026:
--   * "When a paper is put on HOLD, a checker who already has a question open can still answer it. Should hold stop
--      that too?"  Answer: "Yes, stop it".
--   * "A checker skips a question, then someone else fixes it. Should the first checker's tracker count that as
--      'corrected later'?"  Answer: "Yes, count it".
--
-- (1) HOLD. "Hold" in the database is the `pdf_mismatch` flag on the paper (audit_papers.flag_reasons). The hand-out
-- already refuses a held paper's questions (checker_question_servable), but the step that authorizes an ANSWER only
-- looked at the lease, the routing and the paper's source. So a question opened before the hold could still be
-- answered. checker_authorize_question() now refuses with the plain sentence 'This paper was put on hold' (42501).
-- Only the hold is added on purpose: the rest of the serving rules (pictures, page, reference) are NOT re-checked at
-- answer time, so a person is never refused in the middle of an answer because a picture job is running.
-- The check sits in the verifier branch only: an HOD settling an escalated question is not blocked, because the HOD
-- is the person who clears a hold.
-- The body below is the live function as read on 6 November 2026, with the hold check added and pg_temp added to the
-- search path (the rule for every definer function). Grants are unchanged: closed to public, anon AND authenticated
-- (it is only called from other definer functions).
--
-- (2) LATER CORRECTED. hod_team().skipped_done counted a skip only when the SAME verifier later dealt with the same
-- question. It now also counts a skip that someone else later settled. "Settled" = a later line in the counted log
-- (undone lines are not in it) by anyone, with one of: checker_pass, checker_fix, checker_printed_typo, checker_split,
-- checker_ask_help, admin_pass, admin_edit, set_aside, moved_to_students. Live check on 6 November 2026 (select only):
-- 20 before, 23 after, over 41 skipped questions. Same return type, same ordering, same grants as before.
--
-- Rollback:
--   (1) create or replace checker_authorize_question() again WITHOUT the `put on hold` block (the rest is identical).
--   (2) create or replace hod_team() again with the old `later` CTE:
--         later as (
--           select s.uid, count(distinct s.question_id)::int as n
--           from acts s
--           where s.action = 'checker_skip' and s.question_id is not null
--             and exists (select 1 from acts d
--                         where d.uid = s.uid and d.question_id = s.question_id
--                           and d.action <> 'checker_skip' and d.at > s.at)
--           group by s.uid
--         ),

-- ---------------------------------------------------------------------------------------------------------------
-- (1) Hold stops answers.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.checker_authorize_question(p_question_id uuid)
returns public.audit_questions
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_q public.audit_questions;
  v_source text;
begin
  if not (public.is_paper_checker() or public.is_hod()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_q from public.audit_questions where id = p_question_id;
  if v_q.id is null then
    raise exception 'Question not found' using errcode = '42501';
  end if;

  if v_q.review_bucket = 'escalated' then
    if not public.is_hod() then
      raise exception 'This question was sent to the HOD' using errcode = '42501';
    end if;
  else
    if not public.is_paper_checker() then
      raise exception 'Not authorized' using errcode = '42501';
    end if;
    if v_q.review_bucket <> 'kid' then
      raise exception 'This question is not routed to the paper checker' using errcode = '42501';
    end if;
    if not (
      (v_q.locked_by = auth.uid() and v_q.locked_until is not null and v_q.locked_until > now())
      or public.is_admin()
    ) then
      raise exception 'This question is not currently assigned to you' using errcode = '42501';
    end if;
    -- Hold means no more answers (owner, 6 November 2026).
    if exists (select 1 from public.audit_papers ap
               where ap.id = v_q.paper_id
                 and 'pdf_mismatch' = any (coalesce(ap.flag_reasons, '{}'::text[]))) then
      raise exception 'This paper was put on hold' using errcode = '42501';
    end if;
  end if;

  select ap.source into v_source from public.audit_papers ap where ap.id = v_q.paper_id;
  if v_source is null or v_source not in ('live_copy', 'new_ocr') then
    raise exception 'This paper is not eligible for checking' using errcode = '42501';
  end if;

  return v_q;
end;
$function$;

revoke all on function public.checker_authorize_question(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- (2) "Later corrected" counts a skip that someone else settled.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.hod_team()
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
        and exists (select 1 from public.audit_review_log_counted d
                    where d.question_id = s.question_id
                      and d.at > s.at
                      and d.action in ('checker_pass', 'checker_fix', 'checker_printed_typo', 'checker_split',
                                       'checker_ask_help', 'admin_pass', 'admin_edit', 'set_aside',
                                       'moved_to_students'))
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
