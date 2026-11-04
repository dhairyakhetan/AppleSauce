-- HOD desk, step 9b: act on the questions that need the HOD.
--
-- Questions the pipeline routes to the desk (review_bucket 'admin') could only
-- be passed, set aside, reopened or edited by an admin: checker_pass_question
-- and hod_set_aside only handle the 'escalated' bucket. The "Needs you" tab
-- lists both buckets, so a HOD needs the same actions on both.
--
--  * approval_set_question_state(...)   the body of admin_set_question_state,
--    moved unchanged into an internal function. admin_set_question_state is
--    now "check admin, call it" (same result). hod_set_question_state is
--    "check HOD plus the rules below, call it".
--  * approval_apply_question_change(...) is internal (closed to every API
--    role) and used to demand an admin inside; it now accepts a HOD too
--    (is_hod() includes admins), so admin_edit_question behaves as before and
--    hod_edit_question can reach it.
--
-- HOD rules (stricter than admin, on purpose):
--  * never on a frozen Maths live copy;
--  * pass / set aside only questions the students are NOT still working on
--    (bucket escalated or admin), or ones already set aside; students keep
--    their questions until the HOD desk is asked to take them;
--  * reopen is always allowed (it puts the question back in its own bucket);
--  * edit only questions that are not live yet. Question text is changed only
--    through the versioned fix path, so the old text stays in history.

-- ---------------------------------------------------------------------------
create or replace function public.approval_apply_question_change(
  p_question_id uuid, p_version integer, p_changes jsonb, p_note text, p_action text, p_extra jsonb default null)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_allowed constant text[] := array['body', 'display_number', 'marks', 'options', 'instructions',
                                     'section_label', 'chapter', 'alternative_group', 'alternative_label',
                                     'suggested_time_minutes'];
  v_bad text;
  v_q public.audit_questions;
  v_before jsonb;
  v_after jsonb;
  v_new integer;
  v_live_paper text;
  v_bank_paper text;
  v_bank_version integer;
  v_bank_changes jsonb;
  v_fields text;
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'Nothing to change' using errcode = '22023';
  end if;
  select string_agg(k, ', ') into v_bad from jsonb_object_keys(p_changes) k where not (k = any (v_allowed));
  if v_bad is not null then
    raise exception 'These fields cannot be edited here: %', v_bad using errcode = '22023';
  end if;
  if p_changes ? 'options' and jsonb_typeof(p_changes -> 'options') not in ('array', 'null') then
    raise exception 'options must be a list' using errcode = '22023';
  end if;
  if p_changes ? 'body' and jsonb_typeof(p_changes -> 'body') <> 'string' then
    raise exception 'body must be text' using errcode = '22023';
  end if;

  select * into v_q from public.audit_questions where id = p_question_id for update;
  if v_q.id is null then
    raise exception 'Question not found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_object_agg(k, to_jsonb(v_q) -> k), '{}'::jsonb) into v_before
  from jsonb_object_keys(p_changes) k;

  v_new := public.apply_fix_locked('audit_questions', p_question_id::text, p_version, p_changes,
                                   coalesce(v_uid::text, 'admin'), 'admin', p_note);
  if v_new = p_version then
    return v_new;   -- the values were already these: no new version, nothing to log
  end if;

  select * into v_q from public.audit_questions where id = p_question_id;
  select coalesce(jsonb_object_agg(k, to_jsonb(v_q) -> k), '{}'::jsonb) into v_after
  from jsonb_object_keys(p_changes) k;

  -- Live row: same change, same transaction, its own locked version.
  if v_q.live_bank_question_id is not null then
    select ap.live_bank_paper_id into v_live_paper from public.audit_papers ap where ap.id = v_q.paper_id;
    select bq.paper_id, bq.version into v_bank_paper, v_bank_version
    from public.bank_questions bq where bq.id = v_q.live_bank_question_id for update;
    if v_bank_paper is not null then
      if v_live_paper is not null and v_bank_paper <> v_live_paper then
        raise exception 'The live copy of this question belongs to another paper; nothing was saved'
          using errcode = '55000';
      end if;
      perform pg_advisory_xact_lock(hashtext(v_bank_paper));
      select jsonb_object_agg(k,
               case when k = 'options' then to_jsonb(public.approval_flatten_options(p_changes -> 'options'))
                    else p_changes -> k end)
        into v_bank_changes
      from jsonb_object_keys(p_changes) k;
      perform public.apply_fix_locked('bank_questions', v_q.live_bank_question_id, v_bank_version, v_bank_changes,
                                      coalesce(v_uid::text, 'admin'), 'admin', p_note);
    end if;
  end if;

  select string_agg(k, ',' order by k) into v_fields from jsonb_object_keys(p_changes) k;
  insert into public.audit_review_log (actor_user_id, paper_id, question_id, action, field, before, after, note)
  values (v_uid, v_q.paper_id, p_question_id, p_action, v_fields, v_before,
          v_after || jsonb_build_object('version', v_new) || coalesce(p_extra, '{}'::jsonb), p_note);
  return v_new;
end;
$function$;

revoke all on function public.approval_apply_question_change(uuid, integer, jsonb, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.approval_set_question_state(p_question_id uuid, p_state text, p_note text default null)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_q public.audit_questions;
  v_state_before text;
  v_approval text;
  v_bank text;
  v_late boolean := false;
  v_new_id text;
  v_top text;
  v_n integer := 0;
  v_is_stem boolean;
  v_marks numeric;
  v_parent_live text;
begin
  if p_state not in ('pass', 'set_aside', 'reopen') then
    raise exception 'state must be pass, set_aside or reopen' using errcode = '22023';
  end if;
  select * into v_q from public.audit_questions where id = p_question_id for update;
  if v_q.id is null then
    raise exception 'Question not found' using errcode = 'P0002';
  end if;
  if v_q.kind <> 'question' then
    raise exception 'Only questions can be passed or set aside' using errcode = '22023';
  end if;
  select ap.approval_state, ap.live_bank_paper_id into v_approval, v_bank
  from public.audit_papers ap where ap.id = v_q.paper_id for update;
  if v_approval = 'approved' and p_state = 'pass' then
    v_late := true;
  elsif v_approval is not null and v_approval is distinct from 'awaiting' then
    raise exception 'Questions can be set aside or reopened only while the paper waits for approval; after approval a question can only be passed'
      using errcode = '55000';
  end if;
  if v_late and v_q.live_bank_question_id is null and v_q.live_placeholder_ord is not null
     and (v_q.figure ->> 'path') is null
     and exists (select 1 from public.audit_figures f where f.question_id = v_q.id and f.status = 'active') then
    raise exception 'This question has a picture that is not staged for the site yet' using errcode = '55000';
  end if;
  if p_state = 'set_aside' and nullif(btrim(p_note), '') is null then
    raise exception 'Say why the question is set aside' using errcode = '22023';
  end if;

  v_state_before := public.approval_question_state(v_q.kind, v_q.question_passed, v_q.set_aside_at);

  if p_state = 'pass' then
    update public.audit_questions
       set status = 'passed', question_passed = true, checked_by_user = v_uid,
           set_aside_at = null, set_aside_by = null, set_aside_reason = null
     where id = p_question_id;
  elsif p_state = 'set_aside' then
    update public.audit_questions
       set question_passed = false, status = case when status = 'passed' then 'flagged' else status end,
           set_aside_at = now(), set_aside_by = v_uid, set_aside_reason = p_note
     where id = p_question_id;
  else
    update public.audit_questions
       set question_passed = false, status = case when status = 'passed' then 'flagged' else status end,
           set_aside_at = null, set_aside_by = null, set_aside_reason = null
     where id = p_question_id;
  end if;

  if p_state in ('pass', 'set_aside') then
    insert into public.content_checks (table_name, row_id, version_seen, checker_kind, actor_user_id, verdict, notes)
    values ('audit_questions', p_question_id::text, v_q.version, 'admin', v_uid,
            case when p_state = 'pass' then 'pass' else 'flag' end, p_note);
  end if;

  -- Late pass on an approved new paper: the question goes live in its
  -- placeholder's slot. Same column list and rules as admin_approve_paper
  -- (body byte-exact, no answer_key, a stem keeps marks only when none of
  -- its parts carries marks).
  if v_late and v_bank is not null and v_q.live_bank_question_id is null and v_q.live_placeholder_ord is not null then
    perform pg_advisory_xact_lock(hashtext(v_bank));
    v_top := coalesce(substring(coalesce(v_q.number_path, v_q.display_number, '') from '[[:alnum:]]+'), '0');
    loop
      v_new_id := 'MQ-' || v_bank || '-' || v_top || '-' || v_n::text;
      exit when not exists (select 1 from public.bank_questions where id = v_new_id);
      v_n := v_n + 1;
    end loop;
    v_is_stem := exists (select 1 from public.audit_questions c where c.parent_id = v_q.id);
    v_marks := case when v_is_stem and exists (select 1 from public.audit_questions c
                                                where c.parent_id = v_q.id and c.marks is not null)
                    then null else v_q.marks end;
    select p.live_bank_question_id into v_parent_live from public.audit_questions p where p.id = v_q.parent_id;

    perform set_config('shikshaq.actor', coalesce(v_uid::text, 'admin'), true);
    perform set_config('shikshaq.source', 'admin', true);
    perform set_config('shikshaq.reason', 'passed after approval', true);

    insert into public.bank_questions
      (id, paper_id, ord, number, body, marks, chapter, qtype, page, figure, options, display_number,
       instructions, suggested_time_minutes, chapter_from_paper, alternative_group, alternative_label,
       section_label, syllabus_ref, parent_question_id)
    values
      (v_new_id, v_bank, v_q.live_placeholder_ord, v_q.display_number, v_q.body, v_marks, v_q.chapter, v_q.qtype,
       case when (v_q.source ->> 'page') ~ '^[0-9]{1,6}$' then (v_q.source ->> 'page')::integer end,
       v_q.figure ->> 'path',
       public.approval_flatten_options(v_q.options),
       v_q.display_number, v_q.instructions, v_q.suggested_time_minutes, coalesce(v_q.chapter_from_paper, false),
       v_q.alternative_group, v_q.alternative_label, v_q.section_label, v_q.syllabus_ref, v_parent_live);

    update public.audit_questions
       set live_bank_question_id = v_new_id, live_placeholder_ord = null
     where id = p_question_id;

    -- Parts already live under this stem now nest under it.
    if v_is_stem then
      update public.bank_questions bq
         set parent_question_id = v_new_id
       where bq.id in (select c.live_bank_question_id from public.audit_questions c
                        where c.parent_id = v_q.id and c.live_bank_question_id is not null);
    end if;

    update public.bank_papers
       set question_count = coalesce(question_count, 0) + case when v_is_stem then 0 else 1 end,
           marks = coalesce(marks, 0) + coalesce(v_marks, 0)
     where id = v_bank;

    perform set_config('shikshaq.actor', '', true);
    perform set_config('shikshaq.source', '', true);
    perform set_config('shikshaq.reason', '', true);
  end if;

  insert into public.audit_review_log (actor_user_id, paper_id, question_id, action, before, after, note)
  values (v_uid, v_q.paper_id, p_question_id,
          case p_state when 'pass' then 'admin_pass' when 'set_aside' then 'admin_set_aside' else 'admin_reopen' end,
          jsonb_build_object('state', v_state_before),
          jsonb_build_object('state', case p_state when 'pass' then 'passed' when 'set_aside' then 'set_aside' else 'open' end)
            || case when v_new_id is not null
                    then jsonb_build_object('went_live', true, 'live_bank_question_id', v_new_id,
                                            'slot', v_q.live_placeholder_ord)
                    else '{}'::jsonb end,
          p_note);

  return case p_state when 'pass' then 'passed' when 'set_aside' then 'set_aside' else 'open' end;
end;
$function$;

revoke all on function public.approval_set_question_state(uuid, text, text) from public, anon, authenticated;

create or replace function public.admin_set_question_state(p_question_id uuid, p_state text, p_note text default null)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return public.approval_set_question_state(p_question_id, p_state, p_note);
end;
$function$;

-- ---------------------------------------------------------------------------
create or replace function public.hod_set_question_state(p_question_id uuid, p_state text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_q public.audit_questions;
  v_source text;
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
  select ap.source into v_source from public.audit_papers ap where ap.id = v_q.paper_id;
  if v_source = 'live_copy' then
    raise exception 'This is a live Maths copy. It is frozen and is not part of the HOD desk.' using errcode = '55000';
  end if;
  if p_state in ('pass', 'set_aside')
     and v_q.review_bucket not in ('escalated', 'admin')
     and v_q.set_aside_at is null then
    raise exception 'This question is still with the student checkers.' using errcode = '55000';
  end if;
  return public.approval_set_question_state(p_question_id, p_state, p_note);
end;
$$;

create or replace function public.hod_edit_question(p_question_id uuid, p_version integer, p_changes jsonb, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_q public.audit_questions;
  v_source text;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  select * into v_q from public.audit_questions where id = p_question_id;
  if v_q.id is null then
    raise exception 'That question could not be found.' using errcode = 'P0002';
  end if;
  select ap.source into v_source from public.audit_papers ap where ap.id = v_q.paper_id;
  if v_source = 'live_copy' then
    raise exception 'This is a live Maths copy. It is frozen and is not part of the HOD desk.' using errcode = '55000';
  end if;
  if v_q.live_bank_question_id is not null then
    raise exception 'This question is already live. Ask an admin to change it.' using errcode = '55000';
  end if;
  return public.approval_apply_question_change(p_question_id, p_version, p_changes, p_note, 'admin_edit', null);
end;
$$;

revoke all on function public.hod_set_question_state(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hod_set_question_state(uuid, text, text) to authenticated;
revoke all on function public.hod_edit_question(uuid, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.hod_edit_question(uuid, integer, jsonb, text) to authenticated;
