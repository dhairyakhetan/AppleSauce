-- Shikshaq: the leftover fixes from the 12 Nov 2026 whole-flow audit.
-- Paste this whole file into the Supabase SQL editor and press Run. Then send me a picture of the result of the
-- check at the bottom (it should show 4 lines, all "ok").
-- Nothing here deletes or changes any paper, question or request. It only changes four rules.
--
-- 1. A question can no longer be both "passed" and "set aside" (a safety rule on the table; live data is clean).
-- 2. The admin Publish button now runs the same four safety checks the HOD desk runs (it skipped them before).
--    Old "record only" papers (approval_kind = 'retro') are left as they were.
-- 3. A paper card no longer counts a reopened question as done and still to do (it showed "5 of 6" for 4 done).
-- 4. Sending the exact same request twice within 10 minutes (for example after a lost connection) gives back the
--    first one instead of making a second.

-- 1 ------------------------------------------------------------------------------------------------------------
create or replace function public.trg_no_pass_while_set_aside()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.question_passed is true and new.set_aside_at is not null then
    raise exception 'A question cannot be both passed and set aside. Reopen it first.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists audit_questions_no_pass_while_set_aside on public.audit_questions;
create trigger audit_questions_no_pass_while_set_aside
  before update of question_passed, set_aside_at on public.audit_questions
  for each row
  when (new.question_passed is true and new.set_aside_at is not null)
  execute function public.trg_no_pass_while_set_aside();

-- 2 ------------------------------------------------------------------------------------------------------------
create or replace function public.admin_approve_paper(p_audit_paper_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_kind text;
  v_failed text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select approval_kind into v_kind from public.audit_papers where id = p_audit_paper_id;
  if v_kind is distinct from 'retro' then
    select string_agg(e ->> 'label' || ': ' || (e ->> 'detail'), ' ')
      into v_failed
      from jsonb_array_elements(coalesce(public.approval_paper_checks(p_audit_paper_id), '[]'::jsonb)) e
     where not (e ->> 'ok')::boolean;
    if v_failed is not null then
      raise exception 'This paper cannot go live yet. %', v_failed using errcode = '55000';
    end if;
  end if;
  return public.approval_publish_paper(p_audit_paper_id, p_note);
end;
$function$;

-- 3 ------------------------------------------------------------------------------------------------------------
create or replace function public.verifier_my_papers()
returns table(assignment_id bigint, paper_id uuid, subject text, school text, cls text, exam text, year text, given_by_hod boolean, assigned_at timestamp with time zone, total integer, done integer, remaining integer, with_hod integer, skipped integer, paper_total integer, paper_passed integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform public.distribute_unassigned_papers_throttled();
  perform public.verifier_close_finished(v_uid);
  return query
    with mine as (
      select a.* from public.checker_assignments a
      where a.user_id = v_uid and a.status in ('queued', 'assigned')
    ),
    c as (
      select m.id,
             (select count(*)::int from public.audit_questions q
               where q.paper_id = m.audit_paper_id and q.review_bucket = 'kid'
                 and q.question_passed = false and q.kind = 'question'
                 and public.checker_question_servable(q)) as remaining,
             -- only questions that are passed right now: a question the person later reopened is not done any more
             (select count(distinct l.question_id)::int from public.audit_review_log_counted l
                join public.audit_questions pq on pq.id = l.question_id and pq.question_passed = true
               where l.paper_id = m.audit_paper_id and l.actor_user_id = v_uid
                 and l.at >= m.assigned_at
                 and l.action in ('checker_pass', 'checker_fix', 'checker_printed_typo', 'checker_split')) as done,
             (select count(*)::int from public.audit_questions q
               where q.paper_id = m.audit_paper_id and q.review_bucket = 'escalated'
                 and q.question_passed = false and q.set_aside_at is null) as with_hod,
             (select count(*)::int from public.audit_questions q
               where q.paper_id = m.audit_paper_id and q.review_bucket = 'kid'
                 and q.question_passed = false and q.kind = 'question'
                 and public.checker_question_servable(q)
                 and exists (select 1 from public.audit_question_skips s
                             where s.question_id = q.id and s.user_id = v_uid
                               and s.skipped_at >= m.assigned_at)) as skipped,
             (select count(*)::int from public.audit_questions q
               where q.paper_id = m.audit_paper_id and q.kind = 'question'
                 and q.set_aside_at is null) as paper_total,
             (select count(*)::int from public.audit_questions q
               where q.paper_id = m.audit_paper_id and q.kind = 'question'
                 and q.set_aside_at is null and q.question_passed = true) as paper_passed
      from mine m
    )
    select m.id, m.audit_paper_id, ap.subject, ap.school, ap.class, ap.exam_type, ap.year,
           m.assigned_by is not null, m.assigned_at,
           c.done + c.remaining + c.with_hod, c.done, c.remaining, c.with_hod, c.skipped,
           c.paper_total, c.paper_passed
    from mine m
    join c on c.id = m.id
    join public.audit_papers ap on ap.id = m.audit_paper_id
    order by m.assigned_at, m.id;
end;
$function$;

-- 4 ------------------------------------------------------------------------------------------------------------
create or replace function public.request_submit(p_kind text, p_title text, p_details text, p_page text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_hod boolean;
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '[​-‍⁠﻿]', '', 'g'));
  v_details text := btrim(coalesce(p_details, ''));
  v_page text := nullif(left(btrim(coalesce(p_page, '')), 300), '');
  v_id uuid;
begin
  if v_uid is null or not (public.is_paper_checker() or public.is_hod()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  v_hod := public.is_hod();

  if p_kind is null or p_kind not in ('bug', 'edit') then
    raise exception 'Say whether something is broken or something should change.' using errcode = '22023';
  end if;
  if char_length(v_title) < 3 then
    raise exception 'Give the request a short title, at least 3 letters.' using errcode = '22023';
  end if;
  if char_length(v_title) > 120 then
    raise exception 'The title is too long. Keep it under 120 letters.' using errcode = '22023';
  end if;
  if char_length(v_details) > 4000 then
    raise exception 'The details are too long. Keep them under 4000 letters.' using errcode = '22023';
  end if;

  -- One person cannot send two at the same instant and slip past the limits.
  perform pg_advisory_xact_lock(hashtext('fix_requests:' || v_uid::text));

  -- The very same request sent again within 10 minutes (a lost reply, a double tap) is the first one, not a new one.
  select r.id into v_id from public.fix_requests r
   where r.raised_by = v_uid and r.kind = p_kind and r.title = v_title and r.details = v_details
     and r.created_at > now() - interval '10 minutes'
   order by r.created_at desc limit 1;
  if v_id is not null then
    return v_id;
  end if;

  if (select count(*) from public.fix_requests r
       where r.raised_by = v_uid and r.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'You have already sent 10 requests in the last day. Please try again tomorrow.' using errcode = '54000';
  end if;
  if not v_hod and (select count(*) from public.fix_requests r
                     where r.raised_by = v_uid and r.status = 'waiting_for_hod') >= 20 then
    raise exception 'You already have 20 requests waiting for an HOD. Please wait for some to be dealt with.' using errcode = '54000';
  end if;

  insert into public.fix_requests (raised_by, raised_by_name, raised_as, kind, title, details, page_path, status)
  values (v_uid, left(public.history_person_name(v_uid), 120),
          case when v_hod then 'hod' else 'member' end,
          p_kind, v_title, v_details, v_page,
          case when v_hod then 'approved' else 'waiting_for_hod' end)
  returning id into v_id;
  return v_id;
end;
$function$;

-- CHECK: send me a picture of this result. It should show four lines, all "ok". -------------------------------
select 'set-aside rule on the table' as what,
       case when exists (select 1 from pg_trigger where tgname = 'audit_questions_no_pass_while_set_aside' and not tgisinternal) then 'ok' else 'MISSING' end as result
union all
select 'admin publish runs the checks',
       case when pg_get_functiondef('public.admin_approve_paper(uuid,text)'::regprocedure) like '%approval_paper_checks%' then 'ok' else 'MISSING' end
union all
select 'card counts only questions passed now',
       case when pg_get_functiondef('public.verifier_my_papers()'::regprocedure) like '%pq.question_passed = true%' then 'ok' else 'MISSING' end
union all
select 'same request twice is one',
       case when pg_get_functiondef('public.request_submit(text,text,text,text)'::regprocedure) like '%10 minutes%' then 'ok' else 'MISSING' end;
