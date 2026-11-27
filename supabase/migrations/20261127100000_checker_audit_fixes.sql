-- 20261127100000: database part of the student-checker audit of 26/27 Nov 2026 (findings CK-01, CK-04, CK-13, CK-17).
-- NOT APPLIED when written. The website works before and after this is pasted: it reads the new function only if it
-- answers, and every changed function keeps its name, arguments, return shape and grants. Safe to run twice
-- (create or replace only; nothing is deleted or changed in any paper, question, assignment or log line).
--
-- CK-01  A paper put on hold (or whose pictures are missing) was closed behind the checker as "all questions checked":
--        the next read found no question that could be served, so verifier_close_finished marked the assignment done and
--        the paper fell off My papers with questions still unchecked. Now an assignment stays open while some of its open
--        questions are only WAITING (paper on hold, or picture / reference page missing).
--        New helper verifier_question_waiting(question), closed to every client role. Papers kept open this way count as
--        "no work" for the 10-paper cap and for the 7-day return (both use verifier_has_work, unchanged).
-- CK-13  New read-only verifier_my_papers_extra(): for each paper the caller holds, how many questions are waiting and
--        how many days are left before the 7-day "nothing done" return; plus the papers that return took back from the
--        caller in the last 3 days, so My papers can say so. verifier_my_papers itself is NOT changed.
-- CK-04  "Ask my HOD for more papers" said "you already hold a paper" to a checker whose papers were all finished and only
--        waiting on the HOD. paper_ask_for_more and hod_paper_asks now count only papers that still have questions the
--        checker can answer (verifier_has_work).
-- CK-17  checker_my_stats, checker_checked_today_count and checker_my_paper_stats also count "send back to the computer"
--        (checker_ask_ai_redo), like the HOD side already does.
--
-- Not done here on purpose: CK-08 (Undo after split, OR or send-back) and CK-12 (a "mine" flag on the paper's question
-- list) are handled in the website only.
--
-- Rollback: create or replace verifier_close_finished, paper_ask_for_more, hod_paper_asks, checker_my_stats,
-- checker_checked_today_count and checker_my_paper_stats again from 20261007130000, 20261113200000, 20261105100000 and
-- 20261125100000; drop function public.verifier_my_papers_extra(); drop function
-- public.verifier_question_waiting(public.audit_questions).

-- 1 (CK-01) -----------------------------------------------------------------------------------------------------
-- A question a checker COULD answer but cannot right now: the paper is on hold (pdf_mismatch) or the picture or
-- reference page it needs is not there yet. It is "waiting", not "finished".
create or replace function public.verifier_question_waiting(p_q public.audit_questions)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p_q.kind = 'question'
     and p_q.review_bucket = 'kid'
     and p_q.question_passed = false
     and p_q.set_aside_at is null
     and not public.checker_question_servable(p_q)
     and (
       exists (select 1 from public.audit_papers ap
                where ap.id = p_q.paper_id
                  and 'pdf_mismatch' = any (coalesce(ap.flag_reasons, '{}'::text[])))
       or not public.checker_has_picture(p_q)
       or not public.checker_reference_ok(p_q)
     );
$function$;

revoke all on function public.verifier_question_waiting(public.audit_questions) from public, anon, authenticated;

-- verifier_close_finished: the 20261007130000 body, plus one more "not exists" (waiting questions keep the assignment).
create or replace function public.verifier_close_finished(p_uid uuid)
returns void
language sql security definer
set search_path to 'public', 'pg_temp'
as $$
  update public.checker_assignments a
  set status = 'done', closed_at = now(), closed_reason = 'all questions checked'
  where a.user_id = p_uid and a.status in ('queued', 'assigned')
    and not exists (select 1 from public.audit_questions q
                    where q.paper_id = a.audit_paper_id and q.review_bucket = 'kid'
                      and q.question_passed = false and q.kind = 'question'
                      and public.checker_question_servable(q))
    and not exists (select 1 from public.audit_questions q
                    where q.paper_id = a.audit_paper_id and q.review_bucket = 'escalated'
                      and q.question_passed = false and q.set_aside_at is null)
    and not exists (select 1 from public.audit_questions q
                    where q.paper_id = a.audit_paper_id
                      and public.verifier_question_waiting(q));
$$;

-- 2 (CK-01, CK-13) ----------------------------------------------------------------------------------------------
-- kind 'open'     one row per paper the caller holds: held_back = open questions that are only waiting;
--                 idle_days_left = days until the 7-day return takes the paper back (null when the checker has nothing
--                 to do on it, because that return only takes papers with work left).
-- kind 'returned' papers the 7-day rule took back from the caller in the last 3 days.
create or replace function public.verifier_my_papers_extra()
returns table(paper_id uuid, kind text, held_back integer, idle_days_left integer, returned_at timestamptz,
              subject text, school text, cls text, exam text, year text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select a.audit_paper_id,
           'open'::text,
           (select count(*)::int from public.audit_questions q
             where q.paper_id = a.audit_paper_id and public.verifier_question_waiting(q)),
           case when public.verifier_has_work(a.audit_paper_id) then
             greatest(0, ceil(public.verifier_idle_days()
               - extract(epoch from (now() - greatest(a.assigned_at,
                   coalesce((select max(l.at) from public.audit_review_log_counted l
                              where l.paper_id = a.audit_paper_id and l.actor_user_id = a.user_id
                                and l.at >= a.assigned_at), a.assigned_at)))) / 86400.0))::int
           else null end,
           null::timestamptz, null::text, null::text, null::text, null::text, null::text
    from public.checker_assignments a
    where a.user_id = v_uid and a.status in ('queued', 'assigned')
    union all
    select a.audit_paper_id, 'returned'::text, 0, null::int, a.closed_at,
           ap.subject, ap.school, ap.class, ap.exam_type, ap.year
    from public.checker_assignments a
    join public.audit_papers ap on ap.id = a.audit_paper_id
    where a.user_id = v_uid and a.status = 'returned'
      and a.closed_reason like 'nothing done for%'
      and a.closed_at > now() - interval '3 days'
      and not exists (select 1 from public.checker_assignments b
                       where b.user_id = a.user_id and b.audit_paper_id = a.audit_paper_id
                         and b.status in ('queued', 'assigned'));
end;
$function$;

revoke all on function public.verifier_my_papers_extra() from public, anon, authenticated;
grant execute on function public.verifier_my_papers_extra() to authenticated;

-- 3 (CK-04) -----------------------------------------------------------------------------------------------------
-- Bodies copied from 20261113200000; only the "holds a paper" test changes (verifier_has_work).
create or replace function public.paper_ask_for_more()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- One person cannot ask twice at the same instant and slip past the limits.
  perform pg_advisory_xact_lock(hashtext('paper_asks:' || v_uid::text));

  -- An ask nobody answered for 3 days is old news: close it so a fresh one can be made.
  update public.paper_asks
     set status = 'expired', closed_at = now()
   where user_id = v_uid and status = 'open' and asked_at < now() - interval '3 days';

  -- Still holding a paper with work left for this person: there is nothing to ask for yet.
  if exists (select 1 from public.checker_assignments a
              where a.user_id = v_uid and a.status in ('queued', 'assigned')
                and public.verifier_has_work(a.audit_paper_id)) then
    return 'has_work';
  end if;

  if exists (select 1 from public.paper_asks where user_id = v_uid and status = 'open') then
    return 'already_asked';
  end if;

  if (select count(*) from public.paper_asks
       where user_id = v_uid and asked_at > now() - interval '24 hours') >= 3 then
    raise exception 'You have already asked a few times today. The HODs can see it. Please check back tomorrow.'
      using errcode = '54000';
  end if;

  insert into public.paper_asks (user_id) values (v_uid);
  return 'asked';
end;
$function$;

create or replace function public.hod_paper_asks()
returns table(ask_id uuid, user_id uuid, person_name text, asked_at timestamptz, finished_recently integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select a.id,
           a.user_id,
           left(public.history_person_name(a.user_id), 120),
           a.asked_at,
           (select count(*)::int from public.checker_assignments c
             where c.user_id = a.user_id and c.status = 'done' and c.closed_at > now() - interval '14 days')
      from public.paper_asks a
     where a.status = 'open'
       and a.asked_at > now() - interval '3 days'
       -- a person who holds a paper with work left for them is no longer waiting
       and not exists (select 1 from public.checker_assignments c
                        where c.user_id = a.user_id and c.status in ('queued', 'assigned')
                          and public.verifier_has_work(c.audit_paper_id))
     order by a.asked_at, a.id
     limit 100;
end;
$function$;

-- 4 (CK-17) -----------------------------------------------------------------------------------------------------
-- Bodies copied from 20261105100000 and 20261125100000; only the list of actions grows by checker_ask_ai_redo.
create or replace function public.checker_my_stats()
returns table (today_count bigint, total_count bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_today timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select
      (count(distinct l.question_id) filter (where l.at >= v_today))::bigint as today_count,
      count(distinct l.question_id)::bigint as total_count
    from public.audit_review_log_counted l
    where l.actor_user_id = auth.uid()
      and l.question_id is not null
      and l.action in ('checker_pass', 'checker_fix', 'checker_printed_typo', 'checker_split', 'checker_ask_help', 'checker_ask_ai_redo');
end;
$function$;

create or replace function public.checker_checked_today_count()
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_count int;
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select count(distinct l.question_id)::int into v_count
  from public.audit_review_log_counted l
  where l.at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
    and l.question_id is not null
    and l.action in ('checker_pass', 'checker_fix', 'checker_printed_typo', 'checker_split', 'checker_ask_help', 'checker_ask_ai_redo')
    and l.actor_user_id = auth.uid();

  return v_count;
end;
$function$;

create or replace function public.checker_my_paper_stats()
returns table (papers_today bigint, papers_total bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_today timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select
      (count(*) filter (where m.last_at >= v_today))::bigint as papers_today,
      count(*)::bigint as papers_total
    from (
      select l.paper_id, max(l.at) as last_at
      from public.audit_review_log_counted l
      where l.actor_user_id = auth.uid()
        and l.paper_id is not null
        and l.question_id is not null
        and l.action in ('checker_pass', 'checker_fix', 'checker_printed_typo', 'checker_split', 'checker_ask_help', 'checker_ask_ai_redo')
      group by l.paper_id
    ) m
    where not public.verifier_has_work(m.paper_id);
end;
$function$;
