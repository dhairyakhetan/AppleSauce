-- Shikshaq: "Send back to AI", asked by a student, approved by an HOD (18 Nov 2026).
-- Paste this whole file into the Supabase SQL editor and press Run. Then send me a picture of the 6 lines at the
-- bottom (all six should say "ok").
--
-- Owner, 18 Nov 2026: "The students are checking papers, and sometimes ... they come across a question or something
-- that is so wrong that it needs to be sent back to the AI. So give the students an option to elevate, send back to
-- AI option, but it doesn't get instantly sent back to AI. First, it is elevated to an HOD. An HOD approves it. Then
-- it is marked as need AI review with the reason mentioned as well."
-- Owner's answers the same day: while the HOD decides, the question LEAVES the student; after the HOD says yes the
-- paper may still be published (the existing "Publish anyway" or by setting the question aside); after the AI redoes
-- it, the redone question goes STRAIGHT to the HOD.
--
-- HOW IT WORKS (it is a second kind of "Ask for help", so every screen that already handles "Ask for help" keeps working):
--   1. A student presses "Send back to AI" and types a reason (at least 5 characters). The question leaves their list
--      and waits with the HOD, exactly like Ask for help, but carries the mark ai_redo_state = 'requested'.
--   2. The HOD sees it in Needs you with the reason and two choices. Yes: the mark becomes 'approved' ("needs AI
--      review"; the reason stays). No: the mark is cleared and it stays with the HOD as an ordinary help request.
--   3. An approved question stays in the HOD's Needs you list, so an HOD can still set it aside and publish the paper.
--   4. Later, when the owner asks, Claude reads every 'approved' question with its reason, re-reads it against the saved
--      PDF, and sets the mark to 'redone' (a separate step, not in this file). The question stays with the HOD.
--
-- WHAT THIS CHANGES (nothing is deleted, no question text is touched):
--   * audit_questions: 7 new empty columns (ai_redo_state, ai_redo_reason, ai_redo_by, ai_redo_at, ai_redo_decided_by,
--     ai_redo_decided_at, ai_redo_note), one rule on the state word, one small index.
--   * 2 new functions: checker_ask_for_ai_redo (students), hod_ai_redo_decide (HODs and admins).
--   * 4 functions replaced with the same text plus a few words: checker_ask_for_help and hod_send_back (they clear the
--     mark), verifier_verdict_and_next (knows the new action 'ask_ai_redo'), hod_needs_you_questions (shows the mark
--     and finds the reason of the new kind of request).
--   * 3 plain-words history lines.
-- Until this file is pasted the screens (once merged) show "not switched on yet" and nothing breaks.
--
-- ROLLBACK (nothing else depends on it):
--   drop function if exists public.checker_ask_for_ai_redo(uuid, text);
--   drop function if exists public.hod_ai_redo_decide(uuid, boolean, text);
--   -- put the four replaced functions back from their earlier files: checker_ask_for_help from
--   -- 20260928000000_paper_checker_and_admin.sql, hod_send_back from 20261007100000_checker_assignments_and_hod.sql,
--   -- verifier_verdict_and_next from 20261012970000_verifier_pass_and_next.sql, hod_needs_you_questions from
--   -- 20261012110000_hod_needs_you.sql (and any later file that replaced them).
--   delete from public.log_action_catalog where action in ('checker_ask_ai_redo', 'hod_ai_redo_approve', 'hod_ai_redo_decline');
--   alter table public.audit_questions drop column if exists ai_redo_state, drop column if exists ai_redo_reason,
--     drop column if exists ai_redo_by, drop column if exists ai_redo_at, drop column if exists ai_redo_decided_by,
--     drop column if exists ai_redo_decided_at, drop column if exists ai_redo_note;

-- 1. The mark and its reason ------------------------------------------------------------------------------------------
alter table public.audit_questions
  add column if not exists ai_redo_state text,
  add column if not exists ai_redo_reason text,
  add column if not exists ai_redo_by uuid,
  add column if not exists ai_redo_at timestamptz,
  add column if not exists ai_redo_decided_by uuid,
  add column if not exists ai_redo_decided_at timestamptz,
  add column if not exists ai_redo_note text;

do $c$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.audit_questions'::regclass and conname = 'audit_questions_ai_redo_state_check') then
    alter table public.audit_questions
      add constraint audit_questions_ai_redo_state_check
      check (ai_redo_state is null or ai_redo_state in ('requested', 'approved', 'redone'));
  end if;
end
$c$;

create index if not exists audit_questions_ai_redo_idx
  on public.audit_questions (paper_id) where ai_redo_state is not null;

-- 2. A student asks for the AI to redo a question (it leaves the student and goes to the HOD) ---------------------------
create or replace function public.checker_ask_for_ai_redo(p_question_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_before public.audit_questions;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  -- same lease and role checks as Ask for help (a student can only do this to the question they hold)
  v_before := public.checker_authorize_question(p_question_id);

  if char_length(v_reason) < 5 then
    raise exception 'Say what is wrong with this question (at least 5 characters).' using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'That reason is too long (500 characters at most).' using errcode = '22023';
  end if;

  update public.audit_questions
  set review_bucket = 'escalated', checked_by_user = auth.uid(),
      locked_by = null, locked_until = null,
      ai_redo_state = 'requested', ai_redo_reason = v_reason, ai_redo_by = auth.uid(), ai_redo_at = now(),
      ai_redo_decided_by = null, ai_redo_decided_at = null, ai_redo_note = null
  where id = p_question_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
  values (null, auth.uid(), v_before.paper_id, p_question_id, 'checker_ask_ai_redo', 'review_bucket',
          to_jsonb(v_before.review_bucket),
          jsonb_build_object('review_bucket', 'escalated', 'ai_redo_state', 'requested'),
          v_reason);
end;
$function$;

-- 3. The HOD says yes (marked "needs AI review") or no (stays with the HOD as an ordinary help request) -----------------
create or replace function public.hod_ai_redo_decide(p_question_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q public.audit_questions;
  v_source text;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_q from public.audit_questions where id = p_question_id for update;
  if v_q.id is null or v_q.review_bucket <> 'escalated' then
    raise exception 'This question is not waiting for the HOD' using errcode = '22023';
  end if;
  select ap.source into v_source from public.audit_papers ap where ap.id = v_q.paper_id;
  if v_source = 'live_copy' then
    raise exception 'This is a live Maths copy. It is frozen and is not part of the HOD desk.' using errcode = '55000';
  end if;
  if v_q.ai_redo_state is distinct from 'requested' then
    raise exception 'No AI redo request is waiting on this question' using errcode = '22023';
  end if;

  if coalesce(p_approve, false) then
    update public.audit_questions
    set ai_redo_state = 'approved', ai_redo_decided_by = auth.uid(), ai_redo_decided_at = now(), ai_redo_note = v_note
    where id = p_question_id;
    insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
    values (null, auth.uid(), v_q.paper_id, p_question_id, 'hod_ai_redo_approve', 'ai_redo_state',
            to_jsonb('requested'::text), to_jsonb('approved'::text),
            coalesce(v_note, v_q.ai_redo_reason));
  else
    update public.audit_questions
    set ai_redo_state = null, ai_redo_reason = null, ai_redo_by = null, ai_redo_at = null,
        ai_redo_decided_by = null, ai_redo_decided_at = null, ai_redo_note = null
    where id = p_question_id;
    insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
    values (null, auth.uid(), v_q.paper_id, p_question_id, 'hod_ai_redo_decline', 'ai_redo_state',
            to_jsonb('requested'::text), 'null'::jsonb,
            coalesce(v_note, v_q.ai_redo_reason));
  end if;
end;
$function$;

-- 4. Ask for help and Send back clear the mark (so an old mark can never show on a new request) -----------------------
create or replace function public.checker_ask_for_help(p_question_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_before public.audit_questions;
begin
  v_before := public.checker_authorize_question(p_question_id);

  update public.audit_questions
  set review_bucket = 'escalated', checked_by_user = auth.uid(),
      locked_by = null, locked_until = null,
      ai_redo_state = null, ai_redo_reason = null, ai_redo_by = null, ai_redo_at = null,
      ai_redo_decided_by = null, ai_redo_decided_at = null, ai_redo_note = null
  where id = p_question_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
  values (null, auth.uid(), v_before.paper_id, p_question_id, 'checker_ask_help', 'review_bucket',
          to_jsonb(v_before.review_bucket),
          jsonb_build_object('review_bucket', 'escalated'),
          coalesce(p_reason, 'ask for help'));
end;
$function$;

create or replace function public.hod_send_back(p_question_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q public.audit_questions;
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_q from public.audit_questions where id = p_question_id for update;
  if v_q.id is null or v_q.review_bucket <> 'escalated' then
    raise exception 'This question is not waiting for the HOD' using errcode = '22023';
  end if;
  update public.audit_questions
  set review_bucket = 'kid', locked_by = null, locked_until = null,
      ai_redo_state = null, ai_redo_reason = null, ai_redo_by = null, ai_redo_at = null,
      ai_redo_decided_by = null, ai_redo_decided_at = null, ai_redo_note = null
  where id = p_question_id;
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
  values (null, auth.uid(), v_q.paper_id, p_question_id, 'hod_send_back', 'review_bucket',
          to_jsonb('escalated'::text), to_jsonb('kid'::text), nullif(left(btrim(coalesce(p_note, '')), 500), ''));
end;
$function$;

-- 5. The "give a verdict and get the next question" call learns the new action ---------------------------------------
create or replace function public.verifier_verdict_and_next(
  p_action text,
  p_question_id uuid,
  p_paper_id uuid default null,
  p_expected_version integer default null,
  p_body text default null,
  p_display_number text default null,
  p_marks numeric default null,
  p_printed_typo boolean default false,
  p_typo_note text default null,
  p_reason text default null,
  p_include_skipped boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_version integer;
  v_qpaper uuid;
  v_paper uuid;
  v_next record;
  v_ctx jsonb := '[]'::jsonb;
  v_nextj jsonb := null;
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('pass', 'fix', 'skip', 'ask_help', 'ask_ai_redo') then
    raise exception 'Unknown verdict: %', coalesce(p_action, 'none') using errcode = '22023';
  end if;

  if p_action = 'pass' then
    v_version := public.checker_pass_locked(p_question_id, p_expected_version);
  elsif p_action = 'fix' then
    v_version := public.checker_fix_locked(p_question_id, p_expected_version, p_body, p_display_number, p_marks,
                                           p_printed_typo, p_typo_note);
  elsif p_action = 'skip' then
    perform public.checker_skip_question(p_question_id);
  elsif p_action = 'ask_ai_redo' then
    perform public.checker_ask_for_ai_redo(p_question_id, p_reason);
  else
    perform public.checker_ask_for_help(p_question_id, p_reason);
  end if;

  select aq.paper_id into v_qpaper from public.audit_questions aq where aq.id = p_question_id;
  if p_paper_id is not null and p_paper_id is distinct from v_qpaper then
    raise exception 'That question is not on this paper' using errcode = '22023';
  end if;
  v_paper := coalesce(p_paper_id, v_qpaper);

  select * into v_next from public.verifier_next_in_paper(v_paper, coalesce(p_include_skipped, false)) limit 1;

  if found and v_next.id is not null then
    begin
      select coalesce(jsonb_agg(to_jsonb(c) order by c.ord), '[]'::jsonb) into v_ctx
      from public.checker_question_context(v_next.id) c;
    exception when insufficient_privilege then
      v_ctx := '[]'::jsonb;
    end;
    v_nextj := to_jsonb(v_next) || jsonb_build_object('context', v_ctx);
  end if;

  return jsonb_build_object(
    'verdict_ok', true,
    'verdict', p_action,
    'verdict_version', v_version,
    'next', v_nextj,
    'next_paper_id', case when v_nextj is null then null else v_paper end
  );
end;
$function$;

-- 6. The HOD's Needs-you list shows the mark and finds the reason of the new kind of request ---------------------------
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
  if v_source = 'live_copy' then
    raise exception 'This is a live Maths copy. It is frozen and is not part of the HOD desk.' using errcode = '55000';
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
    and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open';

  return v;
end;
$function$;

-- 7. History lines in plain words -------------------------------------------------------------------------------------
insert into public.log_action_catalog (action, kind, meaning) values
  ('checker_ask_ai_redo', 'checker', 'A checker asked for a question to be sent back to the AI, and said why'),
  ('hod_ai_redo_approve', 'admin', 'The HOD agreed that a question needs the AI to redo it'),
  ('hod_ai_redo_decline', 'admin', 'The HOD declined a request to send a question back to the AI')
on conflict (action) do nothing;

-- 8. Who may call them: signed-in people only; each function checks its role inside ----------------------------------
revoke all on function public.checker_ask_for_ai_redo(uuid, text) from public, anon, authenticated;
grant execute on function public.checker_ask_for_ai_redo(uuid, text) to authenticated;
revoke all on function public.hod_ai_redo_decide(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.hod_ai_redo_decide(uuid, boolean, text) to authenticated;
-- the replaced functions keep the permissions they already had; say them again so a re-run can never leave one open
revoke all on function public.checker_ask_for_help(uuid, text) from public, anon, authenticated;
grant execute on function public.checker_ask_for_help(uuid, text) to authenticated;
revoke all on function public.hod_send_back(uuid, text) from public, anon, authenticated;
grant execute on function public.hod_send_back(uuid, text) to authenticated;
revoke all on function public.verifier_verdict_and_next(text, uuid, uuid, integer, text, text, numeric, boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function public.verifier_verdict_and_next(text, uuid, uuid, integer, text, text, numeric, boolean, text, text, boolean) to authenticated;
revoke all on function public.hod_needs_you_questions(uuid) from public, anon, authenticated;
grant execute on function public.hod_needs_you_questions(uuid) to authenticated;

-- CHECK: send me a picture of this result. It should show six lines, all "ok". -----------------------------------------
select 'the seven new columns exist' as what,
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'audit_questions' and column_name like 'ai\_redo\_%') = 7
            then 'ok' else 'MISSING' end as result
union all
select 'a student can ask, a signed-out visitor cannot',
       case when to_regprocedure('public.checker_ask_for_ai_redo(uuid, text)') is not null
             and has_function_privilege('authenticated', 'public.checker_ask_for_ai_redo(uuid, text)', 'execute')
             and not has_function_privilege('anon', 'public.checker_ask_for_ai_redo(uuid, text)', 'execute')
            then 'ok' else 'NOT SAFE' end
union all
select 'the HOD decision is closed to visitors',
       case when to_regprocedure('public.hod_ai_redo_decide(uuid, boolean, text)') is not null
             and has_function_privilege('authenticated', 'public.hod_ai_redo_decide(uuid, boolean, text)', 'execute')
             and not has_function_privilege('anon', 'public.hod_ai_redo_decide(uuid, boolean, text)', 'execute')
            then 'ok' else 'NOT SAFE' end
union all
select 'the next-question call knows ask_ai_redo and stays closed to visitors',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'verifier_verdict_and_next'
                            and pg_get_functiondef(p.oid) like '%ask_ai_redo%')
             and not has_function_privilege('anon', 'public.verifier_verdict_and_next(text, uuid, uuid, integer, text, text, numeric, boolean, text, text, boolean)', 'execute')
            then 'ok' else 'MISSING' end
union all
select 'the HOD list shows the mark',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'hod_needs_you_questions'
                            and pg_get_functiondef(p.oid) like '%ai_redo_state%')
             and not has_function_privilege('anon', 'public.hod_needs_you_questions(uuid)', 'execute')
            then 'ok' else 'MISSING' end
union all
select 'the three history lines exist',
       case when (select count(*) from public.log_action_catalog
                   where action in ('checker_ask_ai_redo', 'hod_ai_redo_approve', 'hod_ai_redo_decline')) = 3
            then 'ok' else 'MISSING' end;
