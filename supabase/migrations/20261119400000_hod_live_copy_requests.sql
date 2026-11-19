-- Shikshaq: a checker's request reaches the HOD on live Maths copies too (19 Nov 2026).
-- Paste this whole file into the Supabase SQL editor and press Run. Then send me a picture of the 4 lines at the
-- bottom (all four should say "ok").
--
-- Owner, 19 Nov 2026: "if it is with a checker it should be able to raise with hod and send to ai, even if it live
-- maths paper".
--
-- THE HOLE THIS CLOSES: a checker on a live Maths copy could already press "Ask the HOD" or "Send back to the AI", and the
-- question left their list, but the HOD desk skipped live Maths copies completely, so nobody ever saw it and nobody could
-- answer it. Two test requests sat like that.
--
-- WHAT IT DOES (5 functions replaced, each with its old text plus a few words; nothing is deleted, no question text is
-- touched):
--   * hod_needs_you_papers and hod_needs_you_questions: a live Maths copy now shows in Needs you, but ONLY the questions a
--     checker sent up ("escalated"). The computer-flagged questions of live Maths copies stay out, exactly as before.
--   * hod_desk_counts: the Needs you question count includes those same checker requests.
--   * hod_set_question_state: an HOD can pass, leave out or reopen such a question.
--   * hod_ai_redo_decide: an HOD can say yes or no to "send back to the AI" on such a question.
--   Sending a question back to the checkers already worked on every paper (hod_send_back has no such rule).
-- WHAT STAYS THE SAME: hod_edit_question still refuses a question that is already live (every live Maths copy question is),
-- so only an admin can change its words. Publishing, Ready to go live, previews and the other checks still skip live
-- Maths copies. When an HOD passes the last open question of a live Maths copy, the existing rule that copies a finished
-- paper onto the live site fires exactly as it does when a checker passes it.
--
-- ROLLBACK (puts the five functions back as they were, hiding live Maths copies again): ask me for the rollback file, or
-- paste the five older versions from the migrations 20261012110000, 20261012185000, 20261012190000 and 20261118100000.

-- 1. Needs you, the papers ---------------------------------------------------------------------------------------------
create or replace function public.hod_needs_you_papers()
returns table(audit_paper_id uuid, title text, subject text, cls text, school text, is_live boolean, escalated integer, admin_bucket integer, total integer)
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
                    concat_ws(' ', coalesce(ap.publish_meta ->> 'school', ap.school),
                              coalesce(ap.publish_meta ->> 'subject', ap.subject),
                              coalesce(ap.publish_meta ->> 'cls', ap.class),
                              coalesce(ap.publish_meta ->> 'exam', ap.exam_type),
                              nullif(coalesce(ap.publish_meta ->> 'year', ap.year), 'year-unknown'))),
           coalesce(ap.publish_meta ->> 'subject', ap.subject),
           coalesce(ap.publish_meta ->> 'cls', ap.class),
           coalesce(ap.publish_meta ->> 'school', ap.school),
           coalesce(bp.is_published, false),
           w.esc::integer,
           w.adm::integer,
           coalesce(t.n, 0)::integer
      from (
        select q.paper_id as pid,
               count(*) filter (where q.review_bucket = 'escalated') as esc,
               count(*) filter (where q.review_bucket = 'admin') as adm
          from public.audit_questions q
          join public.audit_papers p2 on p2.id = q.paper_id
         where q.kind = 'question'
           and q.review_bucket in ('escalated', 'admin')
           and (p2.source <> 'live_copy' or q.review_bucket = 'escalated')
           and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open'
         group by q.paper_id
      ) w
      join public.audit_papers ap on ap.id = w.pid
      left join public.bank_papers bp on bp.id = ap.live_bank_paper_id
      left join lateral (
        select count(*) as n from public.audit_questions q2
         where q2.paper_id = ap.id and q2.kind = 'question'
      ) t on true
     order by (w.esc + w.adm) desc, ap.id;
end;
$function$;

-- 2. Needs you, the questions of one paper -----------------------------------------------------------------------------
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

-- 3. The count on the Needs you tab ------------------------------------------------------------------------------------
create or replace function public.hod_desk_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_trail jsonb;
  v_need_q integer;
  v_ready_ok integer;
  v_live integer;
  v_hidden integer;
  v_uploads integer;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(t.stage, t.n), '{}'::jsonb)
    into v_trail
    from (select stage, count(*) as n from public.hod_paper_trail() group by stage) t;

  select count(*) into v_need_q
    from public.audit_questions q
    join public.audit_papers ap on ap.id = q.paper_id
   where q.kind = 'question' and q.review_bucket in ('escalated', 'admin')
     and (ap.source <> 'live_copy' or q.review_bucket = 'escalated')
     and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open';

  select count(*) into v_ready_ok
    from public.audit_papers ap
   where ap.approval_state = 'awaiting' and ap.source <> 'live_copy'
     and not exists (select 1 from jsonb_array_elements(public.approval_paper_checks(ap.id)) e
                      where not (e ->> 'ok')::boolean);

  select count(*) filter (where bp.is_published), count(*) filter (where not bp.is_published)
    into v_live, v_hidden
    from public.bank_papers bp;

  select count(*) into v_uploads from public.paper_submissions s where s.status = 'pending';

  return jsonb_build_object(
    'read', coalesce((v_trail ->> 'read')::integer, 0),
    'checking', coalesce((v_trail ->> 'checking')::integer, 0),
    'needs_you', coalesce((v_trail ->> 'needs_you')::integer, 0),
    'ready', coalesce((v_trail ->> 'ready')::integer, 0),
    'ready_ok', v_ready_ok,
    'approved', coalesce((v_trail ->> 'live')::integer, 0),
    'needs_you_questions', v_need_q,
    'live', v_live,
    'hidden', v_hidden,
    'student_uploads_pending', v_uploads);
end;
$function$;

-- 4. Pass, leave out or reopen ------------------------------------------------------------------------------------------
create or replace function public.hod_set_question_state(p_question_id uuid, p_state text, p_note text default null)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q public.audit_questions;
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
  if p_state in ('pass', 'set_aside')
     and v_q.review_bucket not in ('escalated', 'admin')
     and v_q.set_aside_at is null then
    raise exception 'This question is still with the student checkers.' using errcode = '55000';
  end if;
  return public.approval_set_question_state(p_question_id, p_state, p_note);
end;
$function$;

-- 5. Yes or no to "send back to the AI" ----------------------------------------------------------------------------------
create or replace function public.hod_ai_redo_decide(p_question_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q public.audit_questions;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_q from public.audit_questions where id = p_question_id for update;
  if v_q.id is null or v_q.review_bucket <> 'escalated' then
    raise exception 'This question is not waiting for the HOD' using errcode = '22023';
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

-- Every one of them stays closed to visitors and open to signed-in people (the function itself checks for an HOD) -------
revoke all on function public.hod_needs_you_papers() from public, anon, authenticated;
grant execute on function public.hod_needs_you_papers() to authenticated;
revoke all on function public.hod_needs_you_questions(uuid) from public, anon, authenticated;
grant execute on function public.hod_needs_you_questions(uuid) to authenticated;
revoke all on function public.hod_desk_counts() from public, anon, authenticated;
grant execute on function public.hod_desk_counts() to authenticated;
revoke all on function public.hod_set_question_state(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hod_set_question_state(uuid, text, text) to authenticated;
revoke all on function public.hod_ai_redo_decide(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.hod_ai_redo_decide(uuid, boolean, text) to authenticated;

-- CHECK: send me a picture of this result. It should show four lines, all "ok". -----------------------------------------
select 'all five functions exist, and a signed-out visitor cannot call any of them' as what,
       case when to_regprocedure('public.hod_needs_you_papers()') is not null
             and to_regprocedure('public.hod_needs_you_questions(uuid)') is not null
             and to_regprocedure('public.hod_desk_counts()') is not null
             and to_regprocedure('public.hod_set_question_state(uuid, text, text)') is not null
             and to_regprocedure('public.hod_ai_redo_decide(uuid, boolean, text)') is not null
             and has_function_privilege('authenticated', 'public.hod_needs_you_papers()', 'execute')
             and has_function_privilege('authenticated', 'public.hod_needs_you_questions(uuid)', 'execute')
             and has_function_privilege('authenticated', 'public.hod_desk_counts()', 'execute')
             and has_function_privilege('authenticated', 'public.hod_set_question_state(uuid, text, text)', 'execute')
             and has_function_privilege('authenticated', 'public.hod_ai_redo_decide(uuid, boolean, text)', 'execute')
             and not has_function_privilege('anon', 'public.hod_needs_you_papers()', 'execute')
             and not has_function_privilege('anon', 'public.hod_needs_you_questions(uuid)', 'execute')
             and not has_function_privilege('anon', 'public.hod_desk_counts()', 'execute')
             and not has_function_privilege('anon', 'public.hod_set_question_state(uuid, text, text)', 'execute')
             and not has_function_privilege('anon', 'public.hod_ai_redo_decide(uuid, boolean, text)', 'execute')
            then 'ok' else 'NOT SAFE' end as result
union all
select 'the Needs you lists show checker requests on live Maths copies',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'hod_needs_you_papers'
                            and pg_get_functiondef(p.oid) like '%p2.source%')
             and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'hod_needs_you_questions'
                            and pg_get_functiondef(p.oid) not like '%is frozen and is not part of the HOD desk%')
            then 'ok' else 'MISSING' end
union all
select 'passing, leaving out and yes or no to the AI no longer refuse live Maths copies',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'hod_set_question_state'
                            and pg_get_functiondef(p.oid) not like '%is frozen and is not part of the HOD desk%')
             and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'hod_ai_redo_decide'
                            and pg_get_functiondef(p.oid) not like '%is frozen and is not part of the HOD desk%')
            then 'ok' else 'MISSING' end
union all
select 'the Needs you count includes them, and editing a live question is still refused',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'hod_desk_counts'
                            and pg_get_functiondef(p.oid) like '%(ap.source <> ''live_copy'' or q.review_bucket = ''escalated'')%')
             and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'hod_edit_question'
                            and pg_get_functiondef(p.oid) like '%already live%')
            then 'ok' else 'MISSING' end;
