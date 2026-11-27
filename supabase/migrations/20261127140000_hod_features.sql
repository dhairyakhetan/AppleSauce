-- 20261127140000: HOD features (27 Nov 2026, owner decisions). ONE file, safe to run twice, nothing is deleted and no
-- question text is touched. The website keeps working before this is pasted (each new button says "not switched on
-- yet" until then).
--
-- 1. Send to AI from the HOD desk (owner: "give HODs a way to send a question back to AI from here with a reason").
--      hod_send_to_ai(question, reason)            one question; reason 5 to 500 characters; the HOD is recorded.
--      hod_undo_send_to_ai(question)               real undo, only while the AI has not picked it up (5 minutes at most).
--    The question gets the same mark a student's request gets after an HOD says yes (ai_redo_state = 'approved'), so the
--    AI re-read job (workflow\AI_REREAD_RUNBOOK.md) finds it with no change: it reads ai_redo_reason as "the reason".
-- 2. Send a whole paper to the AI (owner: "when the same problem runs through the whole paper").
--      hod_paper_ai_counts(paper)                  read only: how many questions would go.
--      hod_send_paper_to_ai(paper, reason, other)  ONE paper request (table ai_redo_paper_requests) plus one mark per
--                                                  question. Each question's reason starts with "The HOD says this
--                                                  problem runs through the whole paper:" so the re-reader sees it as a
--                                                  paper-wide problem. Default: only the questions waiting on the HOD;
--                                                  with p_include_other also the paper's open questions that sit with
--                                                  the student checkers (they are moved to the HOD first).
--      hod_undo_send_paper_to_ai(request)          undoes the whole request, all or nothing.
--    hod_ai_redo_count() gives the number on the Send to AI tab. hod_ai_redo_list and hod_needs_you_questions are replaced
--    with their latest text plus ONE new key each (asked_by_hod / ai_redo_by_hod), so a card can say an HOD sent it.
-- 3. hod_send_paper_back_to_checking(paper, reason): a paper on the Ready list leaves it and its passed questions go back to
--    the student checkers. Only a paper from the pipeline that is waiting (approval_state 'awaiting') and not live. Questions
--    left out stay left out. Every question and the paper get a history line with the HOD and the reason.
-- 4. verifier_my_papers_given_by(): read only, for a checker: the first name of the HOD who handed out each of their papers
--    (the hand-out records who pressed Auto assign all since 20261127110000). verifier_my_papers is NOT changed.
-- 5. Plain-words history lines in log_action_catalog.
--
-- Every function: SECURITY DEFINER, search_path public, pg_temp, role checked inside (is_hod, or is_paper_checker for
-- the checker's read), revoked from public, anon AND authenticated by name, then granted to authenticated only.
--
-- NOT TOUCHED (another job is rewriting them): hod_unassigned_papers, distribute_unassigned_papers, hod_assign_paper,
-- checker_question_servable and the picture helper functions.
--
-- ROLLBACK (nothing else depends on the new things):
--   drop function if exists public.hod_send_to_ai(uuid, text);
--   drop function if exists public.hod_undo_send_to_ai(uuid);
--   drop function if exists public.hod_paper_ai_counts(uuid);
--   drop function if exists public.hod_send_paper_to_ai(uuid, text, boolean);
--   drop function if exists public.hod_undo_send_paper_to_ai(uuid);
--   drop function if exists public.hod_ai_redo_count();
--   drop function if exists public.hod_send_paper_back_to_checking(uuid, text);
--   drop function if exists public.verifier_my_papers_given_by();
--   drop table if exists public.ai_redo_paper_requests;
--   (hod_ai_redo_list and hod_needs_you_questions: paste 20261119300000 and 20261119400000 section 2 again.)

begin;

-- 0. The paper-wide request (one row per "Send whole paper to AI") ----------------------------------------------------
create table if not exists public.ai_redo_paper_requests (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.audit_papers(id) on delete cascade,
  reason text not null,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  include_other boolean not null default false,
  question_ids uuid[] not null default '{}'::uuid[],
  undone_at timestamptz,
  undone_by uuid
);
alter table public.ai_redo_paper_requests enable row level security;
revoke all on table public.ai_redo_paper_requests from public, anon, authenticated;
create index if not exists ai_redo_paper_requests_paper_idx on public.ai_redo_paper_requests (paper_id);

-- 1. One question to the AI ---------------------------------------------------------------------------------------------
create or replace function public.hod_send_to_ai(p_question_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q public.audit_questions;
  v_source text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_old jsonb;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  if char_length(v_reason) < 5 then
    raise exception 'Say what is wrong with this question (at least 5 characters).' using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'That reason is too long (500 characters at most).' using errcode = '22023';
  end if;
  select * into v_q from public.audit_questions where id = p_question_id for update;
  if v_q.id is null then
    raise exception 'That question could not be found.' using errcode = 'P0002';
  end if;
  if v_q.kind <> 'question' then
    raise exception 'Only a question can be sent to the AI.' using errcode = '22023';
  end if;
  select ap.source into v_source from public.audit_papers ap where ap.id = v_q.paper_id;
  if v_source = 'live_copy' then
    raise exception 'This is a live Maths copy. It is frozen and is not part of the HOD desk.' using errcode = '55000';
  end if;
  if v_q.live_bank_question_id is not null then
    raise exception 'This question is already on the live site. Only an admin changes a live question.' using errcode = '55000';
  end if;
  if v_q.review_bucket not in ('escalated', 'admin')
     or public.approval_question_state(v_q.kind, v_q.question_passed, v_q.set_aside_at) <> 'open' then
    raise exception 'Only a question that is waiting for the HOD can be sent to the AI from here.' using errcode = '55000';
  end if;
  if v_q.ai_redo_state = 'requested' then
    raise exception 'A student already asked for this one. Say yes or no to their request.' using errcode = '22023';
  end if;
  if v_q.ai_redo_state = 'approved' then
    raise exception 'This question is already waiting for the AI.' using errcode = '22023';
  end if;

  v_old := jsonb_build_object(
    'ai_redo_state', v_q.ai_redo_state, 'ai_redo_reason', v_q.ai_redo_reason, 'ai_redo_by', v_q.ai_redo_by,
    'ai_redo_at', v_q.ai_redo_at, 'ai_redo_decided_by', v_q.ai_redo_decided_by,
    'ai_redo_decided_at', v_q.ai_redo_decided_at, 'ai_redo_note', v_q.ai_redo_note,
    'review_bucket', v_q.review_bucket);

  update public.audit_questions
     set ai_redo_state = 'approved', ai_redo_reason = v_reason, ai_redo_by = auth.uid(), ai_redo_at = now(),
         ai_redo_decided_by = auth.uid(), ai_redo_decided_at = now(), ai_redo_note = null
   where id = p_question_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
  values (null, auth.uid(), v_q.paper_id, p_question_id, 'hod_send_to_ai', 'ai_redo_state', v_old,
          jsonb_build_object('ai_redo_state', 'approved'), v_reason);

  return jsonb_build_object('question_id', p_question_id, 'sent', true);
end;
$function$;

create or replace function public.hod_undo_send_to_ai(p_question_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q public.audit_questions;
  v_log public.audit_review_log;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  select * into v_q from public.audit_questions where id = p_question_id for update;
  if v_q.id is null then
    raise exception 'That question could not be found.' using errcode = 'P0002';
  end if;
  select * into v_log from public.audit_review_log l
   where l.question_id = p_question_id and l.action = 'hod_send_to_ai' and l.undone_at is null
   order by l.at desc, l.id desc limit 1;
  if v_log.id is null or v_log.actor_user_id is distinct from auth.uid() then
    raise exception 'There is nothing of yours to undo on this question.' using errcode = '55000';
  end if;
  if v_log.at < now() - interval '5 minutes' then
    raise exception 'It is too late to undo this. Send it back to the students or pass it instead.' using errcode = '55000';
  end if;
  if v_q.ai_redo_state is distinct from 'approved'
     or exists (select 1 from public.audit_review_log l
                 where l.question_id = p_question_id and l.action like 'ai\_redo\_%' and l.at >= v_log.at) then
    raise exception 'The AI has already picked this question up, so it cannot be taken back.' using errcode = '55000';
  end if;

  update public.audit_questions
     set ai_redo_state = v_log.before ->> 'ai_redo_state',
         ai_redo_reason = v_log.before ->> 'ai_redo_reason',
         ai_redo_by = (v_log.before ->> 'ai_redo_by')::uuid,
         ai_redo_at = (v_log.before ->> 'ai_redo_at')::timestamptz,
         ai_redo_decided_by = (v_log.before ->> 'ai_redo_decided_by')::uuid,
         ai_redo_decided_at = (v_log.before ->> 'ai_redo_decided_at')::timestamptz,
         ai_redo_note = v_log.before ->> 'ai_redo_note'
   where id = p_question_id;
  update public.audit_review_log set undone_at = now(), undone_by = auth.uid() where id = v_log.id;
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
  values (null, auth.uid(), v_q.paper_id, p_question_id, 'hod_undo_send_to_ai', 'ai_redo_state',
          jsonb_build_object('ai_redo_state', 'approved'), v_log.before - 'review_bucket', 'Taken back by the HOD who sent it');
  return jsonb_build_object('question_id', p_question_id, 'undone', true);
end;
$function$;

-- 2. A whole paper to the AI --------------------------------------------------------------------------------------------
-- How many questions would go. needs_you = open questions waiting on the HOD; other = open questions still with the
-- student checkers; skipped = waiting on the HOD but already in the AI flow (a student asked, or already sent).
create or replace function public.hod_paper_ai_counts(p_audit_paper_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_source text;
  v jsonb;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  select ap.source into v_source from public.audit_papers ap where ap.id = p_audit_paper_id;
  if v_source is null then
    raise exception 'That paper could not be found.' using errcode = 'P0002';
  end if;
  if v_source = 'live_copy' then
    raise exception 'This is a live Maths copy. It is frozen and is not part of the HOD desk.' using errcode = '55000';
  end if;
  select jsonb_build_object(
           'needs_you', count(*) filter (where q.review_bucket in ('escalated', 'admin')
                                           and q.ai_redo_state is distinct from 'requested' and q.ai_redo_state is distinct from 'approved'),
           'other', count(*) filter (where q.review_bucket = 'kid'
                                       and q.ai_redo_state is distinct from 'requested' and q.ai_redo_state is distinct from 'approved'),
           'skipped', count(*) filter (where q.review_bucket in ('escalated', 'admin') and q.ai_redo_state in ('requested', 'approved')))
    into v
    from public.audit_questions q
   where q.paper_id = p_audit_paper_id and q.kind = 'question' and q.live_bank_question_id is null
     and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open';
  return v;
end;
$function$;

create or replace function public.hod_send_paper_to_ai(p_audit_paper_id uuid, p_reason text, p_include_other boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_prefix constant text := 'The HOD says this problem runs through the whole paper: ';
  v_p public.audit_papers;
  v_req uuid := gen_random_uuid();
  v_ids uuid[] := '{}'::uuid[];
  v_moved integer := 0;
  v_old jsonb;
  r public.audit_questions;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  if char_length(v_reason) < 5 then
    raise exception 'Say what is wrong with this paper (at least 5 characters).' using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'That reason is too long (500 characters at most).' using errcode = '22023';
  end if;
  select * into v_p from public.audit_papers where id = p_audit_paper_id for update;
  if v_p.id is null then
    raise exception 'That paper could not be found.' using errcode = 'P0002';
  end if;
  if v_p.source = 'live_copy' then
    raise exception 'This is a live Maths copy. It is frozen and is not part of the HOD desk.' using errcode = '55000';
  end if;

  for r in
    select * from public.audit_questions q
     where q.paper_id = p_audit_paper_id and q.kind = 'question' and q.live_bank_question_id is null
       and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open'
       and (q.review_bucket in ('escalated', 'admin') or (coalesce(p_include_other, false) and q.review_bucket = 'kid'))
       and q.ai_redo_state is distinct from 'requested' and q.ai_redo_state is distinct from 'approved'
     order by q.ord, q.id
     for update
  loop
    v_old := jsonb_build_object(
      'ai_redo_state', r.ai_redo_state, 'ai_redo_reason', r.ai_redo_reason, 'ai_redo_by', r.ai_redo_by,
      'ai_redo_at', r.ai_redo_at, 'ai_redo_decided_by', r.ai_redo_decided_by,
      'ai_redo_decided_at', r.ai_redo_decided_at, 'ai_redo_note', r.ai_redo_note,
      'review_bucket', r.review_bucket, 'checked_by_user', r.checked_by_user);
    if r.review_bucket = 'kid' then
      v_moved := v_moved + 1;
    end if;
    update public.audit_questions
       set review_bucket = case when review_bucket = 'kid' then 'escalated' else review_bucket end,
           locked_by = case when review_bucket = 'kid' then null else locked_by end,
           locked_until = case when review_bucket = 'kid' then null else locked_until end,
           checked_by_user = case when review_bucket = 'kid' then auth.uid() else checked_by_user end,
           ai_redo_state = 'approved', ai_redo_reason = v_prefix || v_reason, ai_redo_by = auth.uid(), ai_redo_at = now(),
           ai_redo_decided_by = auth.uid(), ai_redo_decided_at = now(), ai_redo_note = null
     where id = r.id;
    insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
    values (null, auth.uid(), p_audit_paper_id, r.id, 'hod_send_to_ai_with_paper', 'ai_redo_state', v_old,
            jsonb_build_object('ai_redo_state', 'approved', 'request_id', v_req), v_reason);
    v_ids := v_ids || r.id;
  end loop;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'There is no question on this paper that can be sent to the AI right now.' using errcode = '55000';
  end if;

  insert into public.ai_redo_paper_requests (id, paper_id, reason, requested_by, include_other, question_ids)
  values (v_req, p_audit_paper_id, v_reason, auth.uid(), coalesce(p_include_other, false), v_ids);
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
  values (null, auth.uid(), p_audit_paper_id, null, 'hod_send_paper_to_ai', null, null,
          jsonb_build_object('request_id', v_req, 'questions', array_length(v_ids, 1), 'moved_from_students', v_moved,
                             'include_other', coalesce(p_include_other, false)),
          v_reason);

  return jsonb_build_object('request_id', v_req, 'sent', array_length(v_ids, 1), 'moved_from_students', v_moved);
end;
$function$;

create or replace function public.hod_undo_send_paper_to_ai(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_req public.ai_redo_paper_requests;
  v_n integer := 0;
  r record;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  select * into v_req from public.ai_redo_paper_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'That request could not be found.' using errcode = 'P0002';
  end if;
  if v_req.undone_at is not null then
    raise exception 'That request was already taken back.' using errcode = '55000';
  end if;
  if v_req.requested_by is distinct from auth.uid() then
    raise exception 'Only the HOD who sent the paper can take it back.' using errcode = '55000';
  end if;
  if v_req.requested_at < now() - interval '5 minutes' then
    raise exception 'It is too late to undo this. The AI may already have started.' using errcode = '55000';
  end if;
  -- All or nothing: if any one question has moved on, nothing is changed.
  if exists (
       select 1
         from unnest(v_req.question_ids) as u(qid)
         join public.audit_questions q on q.id = u.qid
        where q.ai_redo_state is distinct from 'approved' or q.ai_redo_by is distinct from auth.uid()
           or exists (select 1 from public.audit_review_log l
                       where l.question_id = q.id and l.action like 'ai\_redo\_%' and l.at >= v_req.requested_at)) then
    raise exception 'The AI has already picked up some of these questions, so the request cannot be taken back.' using errcode = '55000';
  end if;

  for r in
    select l.id as log_id, l.question_id, l.before
      from public.audit_review_log l
     where l.action = 'hod_send_to_ai_with_paper' and l.undone_at is null
       and l.after ->> 'request_id' = p_request_id::text
     order by l.id
  loop
    update public.audit_questions
       set review_bucket = coalesce(r.before ->> 'review_bucket', review_bucket),
           checked_by_user = case when r.before ? 'checked_by_user' then (r.before ->> 'checked_by_user')::uuid else checked_by_user end,
           ai_redo_state = r.before ->> 'ai_redo_state',
           ai_redo_reason = r.before ->> 'ai_redo_reason',
           ai_redo_by = (r.before ->> 'ai_redo_by')::uuid,
           ai_redo_at = (r.before ->> 'ai_redo_at')::timestamptz,
           ai_redo_decided_by = (r.before ->> 'ai_redo_decided_by')::uuid,
           ai_redo_decided_at = (r.before ->> 'ai_redo_decided_at')::timestamptz,
           ai_redo_note = r.before ->> 'ai_redo_note'
     where id = r.question_id;
    update public.audit_review_log set undone_at = now(), undone_by = auth.uid() where id = r.log_id;
    v_n := v_n + 1;
  end loop;

  update public.ai_redo_paper_requests set undone_at = now(), undone_by = auth.uid() where id = p_request_id;
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
  values (null, auth.uid(), v_req.paper_id, null, 'hod_undo_send_paper_to_ai', null, null,
          jsonb_build_object('request_id', p_request_id, 'questions', v_n), 'Taken back by the HOD who sent it');
  return jsonb_build_object('request_id', p_request_id, 'undone', v_n);
end;
$function$;

-- The number on the Send to AI tab: questions waiting for an HOD's yes or no, plus questions waiting for the AI.
create or replace function public.hod_ai_redo_count()
returns integer
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v integer;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  select count(*)::integer into v
    from public.audit_questions q
   where q.kind = 'question' and q.ai_redo_state in ('requested', 'approved');
  return v;
end;
$function$;

-- 2b. The two lists learn who sent a question (one new key each; everything else is the latest text) ---------------------
create or replace function public.hod_ai_redo_list()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v jsonb;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id,
           'paper_id', q.paper_id,
           'paper_source', ap.source,
           'paper_title', coalesce(nullif(btrim(ap.title), ''),
                                   concat_ws(' ', coalesce(ap.publish_meta ->> 'school', ap.school),
                                             coalesce(ap.publish_meta ->> 'subject', ap.subject),
                                             coalesce(ap.publish_meta ->> 'cls', ap.class),
                                             coalesce(ap.publish_meta ->> 'exam', ap.exam_type),
                                             nullif(coalesce(ap.publish_meta ->> 'year', ap.year), 'year-unknown'))),
           'subject', coalesce(ap.publish_meta ->> 'subject', ap.subject),
           'cls', coalesce(ap.publish_meta ->> 'cls', ap.class),
           'school', coalesce(ap.publish_meta ->> 'school', ap.school),
           'ord', q.ord,
           'display_number', q.display_number,
           'number_path', q.number_path,
           'body', q.body,
           'marks', q.marks,
           'ai_redo_state', q.ai_redo_state,
           'ai_redo_reason', q.ai_redo_reason,
           'ai_redo_note', q.ai_redo_note,
           'asked_by_hod', (q.ai_redo_by is not null and q.ai_redo_by is not distinct from q.ai_redo_decided_by),
           'asked_by_name', public.history_actor_from_key(q.ai_redo_by::text) ->> 'name',
           'asked_at', q.ai_redo_at,
           'decided_by_name', public.history_actor_from_key(q.ai_redo_decided_by::text) ->> 'name',
           'decided_at', q.ai_redo_decided_at,
           'question_state', public.approval_question_state(q.kind, q.question_passed, q.set_aside_at),
           'trail', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'at', t.at,
                      'action', t.action,
                      'who', public.history_actor_from_key(coalesce(t.actor_user_id, t.reviewer_id)::text) ->> 'name',
                      'note', t.note,
                      'field', t.field,
                      'before', case when t.field = 'body' and jsonb_typeof(t.before) = 'string' then t.before end,
                      'after', case when t.field = 'body' and jsonb_typeof(t.after) = 'string' then t.after end,
                      'undone', t.undone_at is not null) order by t.at, t.id)
               from (select l.* from public.audit_review_log l
                      where l.question_id = q.id
                        and l.at >= coalesce(q.ai_redo_at, l.at) - interval '1 minute'
                      order by l.at, l.id
                      limit 40) t
           ), '[]'::jsonb)
         ) order by case q.ai_redo_state when 'requested' then 0 when 'approved' then 1 else 2 end,
                    coalesce(q.ai_redo_decided_at, q.ai_redo_at), q.id), '[]'::jsonb)
    into v
  from public.audit_questions q
  join public.audit_papers ap on ap.id = q.paper_id
  where q.kind = 'question'
    and q.ai_redo_state in ('requested', 'approved', 'redone');

  return v;
end;
$function$;

create or replace function public.hod_needs_you_questions(p_audit_paper_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_source text;
  v jsonb;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  select ap.source into v_source from public.audit_papers ap where ap.id = p_audit_paper_id;
  if v_source is null then
    raise exception 'That paper could not be found.' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id,
           'paper_id', q.paper_id,
           'ord', q.ord,
           'kind', q.kind,
           'parent_id', q.parent_id,
           'number_path', q.number_path,
           'display_number', q.display_number,
           'instructions', q.instructions,
           'body', q.body,
           'options', q.options,
           'marks', q.marks,
           'figure_path', q.figure ->> 'path',
           'state', 'open',
           'version', q.version,
           'flag_reasons', to_jsonb(q.flag_reasons),
           'review_bucket', q.review_bucket,
           'live_bank_question_id', q.live_bank_question_id,
           'ai_decision', q.ai_decision,
           'ai_review_reason', q.ai_review_reason,
           'ai_redo_state', q.ai_redo_state,
           'ai_redo_reason', q.ai_redo_reason,
           'ai_redo_by_hod', (q.ai_redo_by is not null and q.ai_redo_by is not distinct from q.ai_redo_decided_by),
           'page', case when (q.source ->> 'page') ~ '^[0-9]{1,6}$' then (q.source ->> 'page')::integer end,
           'page_path', pg.object_path,
           'snippet_path', coalesce(nullif(q.source ->> 'snippet_object', ''), nullif(q.source ->> 'whole_snippet_object', '')),
           'escalated_by', e.actor_user_id,
           'escalated_by_name', public.history_actor_from_key(e.actor_user_id::text) ->> 'name',
           'escalated_at', e.at,
           'reason', e.note
         ) order by q.ord, q.id), '[]'::jsonb)
    into v
  from public.audit_questions q
  left join public.audit_paper_pages pg
         on pg.audit_paper_id = q.paper_id
        and (q.source ->> 'page') ~ '^[0-9]{1,6}$'
        and pg.page = (q.source ->> 'page')::integer
  left join lateral (
    select l.actor_user_id, l.at, l.note from public.audit_review_log_counted l
     where l.question_id = q.id and l.action in ('checker_ask_help', 'checker_ask_ai_redo')
     order by l.at desc limit 1
  ) e on true
  where q.paper_id = p_audit_paper_id
    and q.kind = 'question'
    and q.review_bucket in ('escalated', 'admin')
    and (v_source <> 'live_copy' or q.review_bucket = 'escalated')
    and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open';

  return v;
end;
$function$;

-- 3. Send a paper back from Ready to the student checkers --------------------------------------------------------------
-- Reverses what queue_paper_for_approval / hod_queue_paper did (approval_state 'awaiting', approval_kind, queued_at) and
-- reopens the paper's passed questions for the student checkers (the same fields approval_set_question_state 'reopen'
-- writes, plus the student bucket). Never touches a live paper, a live Maths copy or a paper that is not waiting.
-- Nothing is handed out by itself: the paper shows under "Papers nobody has" and goes to a checker when an HOD presses
-- Auto assign all.
create or replace function public.hod_send_paper_back_to_checking(p_audit_paper_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_p public.audit_papers;
  v_ids uuid[] := '{}'::uuid[];
  r public.audit_questions;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  if char_length(v_reason) < 5 then
    raise exception 'Say why the paper is going back to checking (at least 5 characters).' using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'That reason is too long (500 characters at most).' using errcode = '22023';
  end if;
  select * into v_p from public.audit_papers where id = p_audit_paper_id for update;
  if v_p.id is null then
    raise exception 'That paper could not be found.' using errcode = 'P0002';
  end if;
  if v_p.source is distinct from 'new_ocr' then
    raise exception 'Only papers from the pipeline can be sent back to checking.' using errcode = '55000';
  end if;
  if v_p.live_bank_paper_id is not null or v_p.approval_kind = 'retro' or v_p.approval_state = 'approved' then
    raise exception 'This paper is already live, so it cannot be sent back to checking.' using errcode = '55000';
  end if;
  if v_p.approval_state is distinct from 'awaiting' then
    raise exception 'This paper is not on the Ready list.' using errcode = '55000';
  end if;

  for r in
    select * from public.audit_questions q
     where q.paper_id = p_audit_paper_id and q.kind = 'question' and q.question_passed
       and q.set_aside_at is null and q.live_bank_question_id is null
       and q.ai_redo_state is distinct from 'requested' and q.ai_redo_state is distinct from 'approved'
     order by q.ord, q.id
     for update
  loop
    update public.audit_questions
       set question_passed = false,
           status = case when status = 'passed' then 'flagged' else status end,
           review_bucket = 'kid', locked_by = null, locked_until = null
     where id = r.id;
    insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
    values (null, auth.uid(), p_audit_paper_id, r.id, 'hod_reopen_for_checking', 'review_bucket',
            jsonb_build_object('state', 'passed', 'review_bucket', r.review_bucket),
            jsonb_build_object('state', 'open', 'review_bucket', 'kid'), v_reason);
    v_ids := v_ids || r.id;
  end loop;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'This paper has no passed question to send back.' using errcode = '55000';
  end if;

  update public.audit_papers
     set approval_state = null, approval_kind = null, queued_at = null
   where id = p_audit_paper_id;
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
  values (null, auth.uid(), p_audit_paper_id, null, 'hod_send_paper_back_to_checking', 'approval_state',
          jsonb_build_object('approval_state', v_p.approval_state, 'kind', v_p.approval_kind, 'queued_at', v_p.queued_at),
          jsonb_build_object('approval_state', null::text, 'questions_reopened', array_length(v_ids, 1)),
          v_reason);

  return jsonb_build_object('paper_id', p_audit_paper_id, 'reopened', array_length(v_ids, 1));
end;
$function$;

-- 4. A checker sees who handed them each paper (read only; verifier_my_papers is not changed) ---------------------------
create or replace function public.verifier_my_papers_given_by()
returns table(assignment_id bigint, first_name text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select a.id,
           case when position('@' in coalesce(p.full_name, '')) > 0 then null
                else nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), '') end
      from public.checker_assignments a
      left join public.profiles p on p.id = a.assigned_by
     where a.user_id = v_uid and a.status in ('queued', 'assigned') and a.assigned_by is not null;
end;
$function$;

-- 5. History lines in plain words -------------------------------------------------------------------------------------
insert into public.log_action_catalog (action, kind, meaning) values
  ('hod_send_to_ai', 'admin', 'An HOD sent a question to the AI to be read again, and said why'),
  ('hod_undo_send_to_ai', 'admin', 'An HOD took back a question they had just sent to the AI'),
  ('hod_send_to_ai_with_paper', 'admin', 'An HOD sent a question to the AI as part of a whole-paper request'),
  ('hod_send_paper_to_ai', 'admin', 'An HOD sent a whole paper to the AI to be read again, and said why'),
  ('hod_undo_send_paper_to_ai', 'admin', 'An HOD took back a whole-paper request they had just sent to the AI'),
  ('hod_reopen_for_checking', 'admin', 'A question went back to the student checkers because an HOD sent its paper back from Ready'),
  ('hod_send_paper_back_to_checking', 'admin', 'An HOD sent a paper back from the Ready list to the student checkers, and said why')
on conflict (action) do nothing;

-- 6. Who may call them: signed-in people only; each function checks its role inside ------------------------------------
revoke all on function public.hod_send_to_ai(uuid, text) from public, anon, authenticated;
grant execute on function public.hod_send_to_ai(uuid, text) to authenticated;
revoke all on function public.hod_undo_send_to_ai(uuid) from public, anon, authenticated;
grant execute on function public.hod_undo_send_to_ai(uuid) to authenticated;
revoke all on function public.hod_paper_ai_counts(uuid) from public, anon, authenticated;
grant execute on function public.hod_paper_ai_counts(uuid) to authenticated;
revoke all on function public.hod_send_paper_to_ai(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.hod_send_paper_to_ai(uuid, text, boolean) to authenticated;
revoke all on function public.hod_undo_send_paper_to_ai(uuid) from public, anon, authenticated;
grant execute on function public.hod_undo_send_paper_to_ai(uuid) to authenticated;
revoke all on function public.hod_ai_redo_count() from public, anon, authenticated;
grant execute on function public.hod_ai_redo_count() to authenticated;
revoke all on function public.hod_send_paper_back_to_checking(uuid, text) from public, anon, authenticated;
grant execute on function public.hod_send_paper_back_to_checking(uuid, text) to authenticated;
revoke all on function public.verifier_my_papers_given_by() from public, anon, authenticated;
grant execute on function public.verifier_my_papers_given_by() to authenticated;
revoke all on function public.hod_ai_redo_list() from public, anon, authenticated;
grant execute on function public.hod_ai_redo_list() to authenticated;
revoke all on function public.hod_needs_you_questions(uuid) from public, anon, authenticated;
grant execute on function public.hod_needs_you_questions(uuid) to authenticated;

commit;

-- CHECK (read only): send me a picture of this result. EVERY column should say true. ------------------------------------
select
  to_regclass('public.ai_redo_paper_requests') is not null as paper_request_table_exists,
  (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.ai_redo_paper_requests')) as paper_request_table_locked,
  to_regprocedure('public.hod_send_to_ai(uuid, text)') is not null as send_to_ai_exists,
  to_regprocedure('public.hod_undo_send_to_ai(uuid)') is not null as undo_exists,
  to_regprocedure('public.hod_paper_ai_counts(uuid)') is not null as paper_counts_exists,
  to_regprocedure('public.hod_send_paper_to_ai(uuid, text, boolean)') is not null as send_paper_exists,
  to_regprocedure('public.hod_undo_send_paper_to_ai(uuid)') is not null as undo_paper_exists,
  to_regprocedure('public.hod_ai_redo_count()') is not null as tab_count_exists,
  to_regprocedure('public.hod_send_paper_back_to_checking(uuid, text)') is not null as send_back_to_checking_exists,
  to_regprocedure('public.verifier_my_papers_given_by()') is not null as given_by_exists,
  (has_function_privilege('authenticated', 'public.hod_send_to_ai(uuid, text)', 'execute')
   and has_function_privilege('authenticated', 'public.hod_undo_send_to_ai(uuid)', 'execute')
   and has_function_privilege('authenticated', 'public.hod_paper_ai_counts(uuid)', 'execute')
   and has_function_privilege('authenticated', 'public.hod_send_paper_to_ai(uuid, text, boolean)', 'execute')
   and has_function_privilege('authenticated', 'public.hod_undo_send_paper_to_ai(uuid)', 'execute')
   and has_function_privilege('authenticated', 'public.hod_ai_redo_count()', 'execute')
   and has_function_privilege('authenticated', 'public.hod_send_paper_back_to_checking(uuid, text)', 'execute')
   and has_function_privilege('authenticated', 'public.verifier_my_papers_given_by()', 'execute')) as signed_in_people_can_call,
  (not has_function_privilege('anon', 'public.hod_send_to_ai(uuid, text)', 'execute')
   and not has_function_privilege('anon', 'public.hod_undo_send_to_ai(uuid)', 'execute')
   and not has_function_privilege('anon', 'public.hod_paper_ai_counts(uuid)', 'execute')
   and not has_function_privilege('anon', 'public.hod_send_paper_to_ai(uuid, text, boolean)', 'execute')
   and not has_function_privilege('anon', 'public.hod_undo_send_paper_to_ai(uuid)', 'execute')
   and not has_function_privilege('anon', 'public.hod_ai_redo_count()', 'execute')
   and not has_function_privilege('anon', 'public.hod_send_paper_back_to_checking(uuid, text)', 'execute')
   and not has_function_privilege('anon', 'public.verifier_my_papers_given_by()', 'execute')
   and not has_table_privilege('anon', 'public.ai_redo_paper_requests', 'select')
   and not has_table_privilege('authenticated', 'public.ai_redo_paper_requests', 'select')) as a_signed_out_visitor_cannot,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'hod_ai_redo_list'
             and pg_get_functiondef(p.oid) like '%asked_by_hod%') as send_to_ai_list_knows_who_sent,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'hod_needs_you_questions'
             and pg_get_functiondef(p.oid) like '%ai_redo_by_hod%') as needs_you_list_knows_who_sent,
  (select count(*) from public.log_action_catalog
    where action in ('hod_send_to_ai', 'hod_undo_send_to_ai', 'hod_send_to_ai_with_paper', 'hod_send_paper_to_ai',
                     'hod_undo_send_paper_to_ai', 'hod_reopen_for_checking', 'hod_send_paper_back_to_checking')) = 7 as history_lines_exist;
