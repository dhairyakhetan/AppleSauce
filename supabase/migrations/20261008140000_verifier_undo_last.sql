-- A rewind button for verifiers.
--
-- Owner, 8 Oct 2026: "there should be a rewind (or previous) button here for
-- verifiers - so if they click on something by mistake, they can go back".
--
-- verifier_undo_last(paper) undoes the caller's own most recent action on that
-- paper: Looks right, Fix it, Ask the HOD or Skip. It refuses (errcode 22023,
-- with a sentence a verifier can read) when
--   * the caller no longer holds the paper,
--   * the paper has gone for approval or been published,
--   * the action is more than 30 minutes old,
--   * anyone else (another verifier, the HOD, an admin, the pipeline, an AI
--     check) has touched that question since,
--   * the HOD has already answered an escalation,
--   * the last step is one that cannot be undone here (a split).
-- Repeating it walks back through the caller's earlier actions, each inside
-- its own 30 minutes.
--
-- What each undo does
--   Looks right  the question goes back to "to verify", leased to the caller
--                again; the pass no longer counts anywhere.
--   Fix it       the exact previous text, number and marks are put back from
--                the stored previous version (content_versions), never
--                rebuilt; that is a new version, so history is not rewritten.
--                Then as for Looks right.
--   Ask the HOD  the escalation is withdrawn (the question leaves the HOD's
--                Escalated list) as long as the HOD has not acted on it.
--   Skip         the skip mark is removed, so the question is back in its
--                normal place.
--
-- History is append-only: the original audit_review_log row stays and gets
-- undone_at / undone_by; a new 'verifier_undo' row says what happened. The
-- same two columns go on content_checks. Every counter reads the log and the
-- checks through audit_review_log_counted / content_checks_counted, which
-- leave out undone rows, so an undone pass or fix is not in the trust meter,
-- in anyone's totals, in the HOD's team table or in paper progress. The
-- history pages (activity feed, day log, question history) keep reading the
-- real tables and show both lines.
--
-- Counter functions are patched in place (pg_get_functiondef + regexp_replace
-- of the two table names); the migration refuses to run if one did not change.
-- checker_pass_locked / checker_fix_locked now also write the question's
-- previous status and checker into the log row, so an undo can put them back.
--
-- Every new or replaced function: revoked from public, anon AND authenticated,
-- then granted to authenticated (service_role for the internal AI helper).

-- ---------------------------------------------------------------- columns

alter table public.audit_review_log
  add column if not exists undone_at timestamptz,
  add column if not exists undone_by uuid references auth.users(id) on delete set null;

alter table public.content_checks
  add column if not exists undone_at timestamptz,
  add column if not exists undone_by uuid references auth.users(id) on delete set null;

comment on column public.audit_review_log.undone_at is
  'Set when the person who took this action undid it (verifier_undo_last). The row stays; counters read audit_review_log_counted, which leaves it out.';
comment on column public.content_checks.undone_at is
  'Set when the person who made this check undid it (verifier_undo_last). Counters read content_checks_counted, which leaves it out.';

-- The rows that count. security_invoker so a role needs the table's own
-- privileges (none for anon or authenticated); only definer functions read it.
create or replace view public.audit_review_log_counted
  with (security_invoker = true) as
  select * from public.audit_review_log where undone_at is null;

create or replace view public.content_checks_counted
  with (security_invoker = true) as
  select * from public.content_checks where undone_at is null;

revoke all on public.audit_review_log_counted from public, anon, authenticated;
revoke all on public.content_checks_counted from public, anon, authenticated;
grant select on public.audit_review_log_counted to service_role;
grant select on public.content_checks_counted to service_role;

-- ---------------------------------------------------------------- the undo

create or replace function public.verifier_undo_last(p_paper_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_a public.checker_assignments;
  v_paper public.audit_papers;
  v_log public.audit_review_log;
  v_q public.audit_questions;
  v_kind text;
  v_before jsonb;
  v_after jsonb;
  v_snap jsonb;
  v_status text;
  v_prev_user uuid;
  v_bucket text;
  v_restore boolean := false;
  v_body text;
  v_num text;
  v_marks numeric;
  v_result jsonb;
begin
  if v_uid is null or not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- One undo at a time per person.
  perform pg_advisory_xact_lock(hashtext('verifier_undo_last'), hashtext(v_uid::text));

  -- The caller must still hold the paper (a finished paper counts: the last
  -- answer is the one most often clicked by mistake).
  select * into v_a
  from public.checker_assignments a
  where a.audit_paper_id = p_paper_id and a.user_id = v_uid
    and a.status in ('queued', 'assigned', 'done')
  order by (a.status <> 'done') desc, a.id desc
  limit 1
  for update;
  if v_a.id is null then
    raise exception 'You no longer hold this paper, so your last answer cannot be undone here. Ask the HOD.'
      using errcode = '22023';
  end if;

  select * into v_paper from public.audit_papers p where p.id = p_paper_id for share;
  if v_paper.id is null then
    raise exception 'That paper was not found' using errcode = '22023';
  end if;
  -- paper_passed alone is NOT "gone for approval": it turns true the moment
  -- the last question is answered, which is exactly the answer to undo. A
  -- live_copy paper is different: passing it pushes it to the library at once
  -- (trg_apply_live_copy_paper_to_live), so that one cannot be taken back here.
  if v_paper.approval_state in ('awaiting', 'approved')
     or (coalesce(v_paper.paper_passed, false) and v_paper.source = 'live_copy') then
    raise exception 'This paper has already gone for approval, so answers on it can no longer be undone. Ask the HOD if something is wrong.'
      using errcode = '22023';
  end if;

  -- The caller's most recent action on this paper that has not been undone.
  select * into v_log
  from public.audit_review_log l
  where l.paper_id = p_paper_id and l.actor_user_id = v_uid and l.question_id is not null
    and l.undone_at is null and l.action <> 'verifier_undo'
    and l.at >= v_a.assigned_at
  order by l.id desc
  limit 1
  for update;
  if v_log.id is null then
    raise exception 'There is nothing to undo on this paper.' using errcode = '22023';
  end if;

  if v_log.at < now() - interval '30 minutes' then
    raise exception 'Your last answer was more than 30 minutes ago, so it can no longer be undone.'
      using errcode = '22023';
  end if;

  v_kind := case v_log.action
              when 'checker_pass' then 'pass'
              when 'checker_fix' then 'fix'
              when 'checker_printed_typo' then 'fix'
              when 'checker_ask_help' then 'ask_help'
              when 'checker_skip' then 'skip'
            end;
  if v_kind is null then
    raise exception '%',
      case when v_log.action = 'checker_split'
           then 'Splitting a question cannot be undone here. Ask the HOD if the split was a mistake.'
           else 'That step cannot be undone here. Ask the HOD if it was a mistake.' end
      using errcode = '22023';
  end if;

  select * into v_q from public.audit_questions q where q.id = v_log.question_id for update;
  if v_q.id is null then
    raise exception 'That question is no longer there' using errcode = '22023';
  end if;

  -- Anyone else, or anything else, touching the question since: refuse.
  if exists (select 1 from public.audit_review_log l2
             where l2.question_id = v_q.id and l2.id > v_log.id
               and not (l2.actor_user_id = v_uid and (l2.undone_at is not null or l2.action = 'verifier_undo'))) then
    raise exception 'Someone else has worked on that question since, so it can no longer be undone. Ask the HOD.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.content_checks k
             where k.table_name = 'audit_questions' and k.row_id = v_q.id::text
               and k.created_at > v_log.at and k.undone_at is null
               and k.actor_user_id is distinct from v_uid) then
    raise exception 'A check was run on that question since, so it can no longer be undone. Ask the HOD.'
      using errcode = '22023';
  end if;
  if v_q.locked_by is not null and v_q.locked_by <> v_uid and v_q.locked_until > now() then
    raise exception 'Someone else has that question open now, so it cannot be undone.'
      using errcode = '22023';
  end if;

  v_before := v_log.before;
  v_after := v_log.after;
  v_prev_user := case when (v_before ->> 'checked_by_user') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      then (v_before ->> 'checked_by_user')::uuid end;

  if v_kind in ('pass', 'fix') then
    if not (v_q.question_passed and v_q.checked_by_user = v_uid) then
      raise exception 'That question has changed since you answered it, so it can no longer be undone.'
        using errcode = '22023';
    end if;
    if (v_after ->> 'version') ~ '^[0-9]{1,9}$' and v_q.version is distinct from (v_after ->> 'version')::integer then
      raise exception 'The words of that question changed after your answer, so it can no longer be undone.'
        using errcode = '22023';
    end if;
    v_status := coalesce(nullif(v_before ->> 'status', ''), 'flagged');

    if v_kind = 'fix' then
      if (v_before ->> 'version') ~ '^[0-9]{1,9}$' and (v_after ->> 'version') ~ '^[0-9]{1,9}$' then
        -- Saved through the version lock: the previous words are in history.
        if (v_before ->> 'version')::integer <> (v_after ->> 'version')::integer then
          select cv.snapshot into v_snap
          from public.content_versions cv
          where cv.table_name = 'audit_questions' and cv.row_id = v_q.id::text
            and cv.version = (v_before ->> 'version')::integer and cv.op <> 'delete'
          order by cv.id desc
          limit 1;
          if v_snap is null then
            raise exception 'The earlier wording of that question is not on file, so the fix cannot be undone safely. Ask the HOD.'
              using errcode = '22023';
          end if;
          if (v_snap ->> 'body') is distinct from (v_before ->> 'body') then
            raise exception 'The earlier wording on file does not match what was logged, so the fix cannot be undone safely. Ask the HOD.'
              using errcode = '22023';
          end if;
          v_body := v_snap ->> 'body';
          v_num := v_snap ->> 'display_number';
          v_marks := (v_snap ->> 'marks')::numeric;
          v_restore := true;
        end if;
      else
        -- Saved the older way: the log row holds the previous values.
        if (v_after ->> 'body') is not null and v_q.body is distinct from (v_after ->> 'body') then
          raise exception 'The words of that question changed after your answer, so it can no longer be undone.'
            using errcode = '22023';
        end if;
        v_body := v_before ->> 'body';
        v_num := v_before ->> 'display_number';
        v_marks := (v_before ->> 'marks')::numeric;
        v_restore := true;
      end if;
    end if;

    if v_restore then
      perform set_config('shikshaq.actor', v_uid::text, true);
      perform set_config('shikshaq.source', 'verifier_undo', true);
      perform set_config('shikshaq.reason', 'a verifier undid their own fix', true);
      perform set_config('shikshaq.op', 'revert', true);
      update public.audit_questions
      set body = v_body, display_number = v_num, marks = v_marks
      where id = v_q.id;
      perform set_config('shikshaq.actor', '', true);
      perform set_config('shikshaq.source', '', true);
      perform set_config('shikshaq.reason', '', true);
      perform set_config('shikshaq.op', '', true);
    end if;

    update public.audit_questions
    set status = v_status, question_passed = false, checked_by_user = v_prev_user,
        locked_by = v_uid, locked_until = now() + interval '10 minutes', leased_at = now()
    where id = v_q.id;

    update public.content_checks
    set undone_at = now(), undone_by = v_uid
    where id = (select k.id from public.content_checks k
                where k.table_name = 'audit_questions' and k.row_id = v_q.id::text
                  and k.actor_user_id = v_uid and k.undone_at is null
                  and k.verdict in (case when v_kind = 'pass' then 'pass' else 'fix' end,
                                    case when v_kind = 'pass' then 'pass' else 'printed_typo' end)
                order by k.id desc
                limit 1);

    -- A finished paper opens again: there is a question to answer.
    if v_a.status = 'done' then
      begin
        update public.checker_assignments
        set status = 'assigned', closed_at = null, closed_reason = null
        where id = v_a.id;
      exception when unique_violation then
        raise exception 'Someone else has been given this paper, so your last answer cannot be undone.'
          using errcode = '22023';
      end;
    end if;

  elsif v_kind = 'ask_help' then
    if v_q.review_bucket <> 'escalated' or v_q.question_passed or v_q.set_aside_at is not null then
      raise exception 'The HOD has already dealt with that question, so it can no longer be taken back.'
        using errcode = '22023';
    end if;
    v_bucket := case when jsonb_typeof(v_before) = 'string' then v_before #>> '{}' end;
    if v_bucket is null or v_bucket = 'escalated' then
      v_bucket := 'kid';
    end if;
    update public.audit_questions
    set review_bucket = v_bucket, checked_by_user = null,
        locked_by = v_uid, locked_until = now() + interval '10 minutes', leased_at = now()
    where id = v_q.id;

  else -- skip
    if v_q.review_bucket <> 'kid' or v_q.question_passed or v_q.set_aside_at is not null then
      raise exception 'That question has changed since you skipped it, so it can no longer be undone.'
        using errcode = '22023';
    end if;
    delete from public.audit_question_skips s where s.question_id = v_q.id and s.user_id = v_uid;
    update public.audit_questions
    set locked_by = v_uid, locked_until = now() + interval '10 minutes', leased_at = now()
    where id = v_q.id;
  end if;

  update public.audit_review_log set undone_at = now(), undone_by = v_uid where id = v_log.id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
  values (null, v_uid, v_q.paper_id, v_q.id, 'verifier_undo', null,
          jsonb_build_object('undone_action', v_log.action, 'undone_log_id', v_log.id, 'undone_at', v_log.at),
          jsonb_build_object('restored', v_kind),
          v_log.action);

  select jsonb_build_object(
           'question_id', aq.id,
           'undone', v_kind,
           'undone_action', v_log.action,
           'question', jsonb_build_object(
             'id', aq.id, 'paper_id', aq.paper_id, 'ord', aq.ord, 'display_number', aq.display_number,
             'number_path', aq.number_path, 'body', aq.body, 'options', aq.options, 'marks', aq.marks,
             'instructions', aq.instructions, 'flag_reasons', to_jsonb(aq.flag_reasons),
             'flag_detail', aq.flag_detail, 'source', aq.source,
             'subject', ap.subject, 'school', ap.school, 'cls', ap.class, 'exam', ap.exam_type, 'year', ap.year,
             'version', aq.version,
             'page', case when (aq.source ->> 'page') ~ '^[0-9]{1,6}$' then (aq.source ->> 'page')::integer end,
             'page_path', pg.object_path,
             'snippet_path', coalesce(nullif(aq.source ->> 'snippet_object', ''),
                                      nullif(aq.source ->> 'whole_snippet_object', ''))))
    into v_result
  from public.audit_questions aq
  join public.audit_papers ap on ap.id = aq.paper_id
  left join public.audit_paper_pages pg
         on pg.audit_paper_id = aq.paper_id
        and (aq.source ->> 'page') ~ '^[0-9]{1,6}$'
        and pg.page = (aq.source ->> 'page')::integer
  where aq.id = v_q.id;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------- previous state in the log

-- A pass or fix records what the question looked like before, so an undo can
-- put the status and the checker back. Patched in place.
do $$
declare
  src text;
begin
  src := pg_get_functiondef('public.checker_pass_locked(uuid, integer)'::regprocedure);
  src := replace(src,
    '''question_passed'', v_before.question_passed, ''version'', v_current)',
    '''question_passed'', v_before.question_passed, ''version'', v_current, ''checked_by_user'', v_before.checked_by_user)');
  if position('''checked_by_user'', v_before.checked_by_user' in src) = 0 then
    raise exception 'patch did not apply: checker_pass_locked';
  end if;
  execute src;

  src := pg_get_functiondef('public.checker_fix_locked(uuid, integer, text, text, numeric, boolean, text)'::regprocedure);
  src := replace(src,
    '''marks'', v_before.marks, ''version'', v_current)',
    '''marks'', v_before.marks, ''version'', v_current, ''status'', v_before.status, ''question_passed'', v_before.question_passed, ''checked_by_user'', v_before.checked_by_user)');
  if position('''checked_by_user'', v_before.checked_by_user' in src) = 0 then
    raise exception 'patch did not apply: checker_fix_locked';
  end if;
  execute src;
end $$;

-- ---------------------------------------------------------------- counters leave out undone rows

do $$
declare
  f text;
  r regprocedure;
  src text;
  new_src text;
begin
  foreach f in array array[
    'public.checker_checked_today_count()',
    'public.checker_my_stats()',
    'public.checker_leaderboard()',
    'public.verifier_my_papers()',
    'public.hod_team()',
    'public.admin_team_stats(timestamp with time zone, timestamp with time zone)',
    'public.admin_list_checker_accounts()',
    'public.admin_list_checkers()',
    'public.ai_trust_outcomes()'
  ] loop
    r := to_regprocedure(f);
    if r is null then
      raise notice 'not defined here, skipped: %', f;
      continue;
    end if;
    src := pg_get_functiondef(r);
    new_src := regexp_replace(src, '\m(public\.)?audit_review_log\M', 'public.audit_review_log_counted', 'gi');
    new_src := regexp_replace(new_src, '\m(public\.)?content_checks\M', 'public.content_checks_counted', 'gi');
    if new_src = src and position('_counted' in src) = 0 then
      raise exception 'patch did not apply: % reads neither table', f;
    end if;
    if new_src <> src then
      execute new_src;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- history words

insert into public.log_action_catalog (action, kind, meaning) values
  ('verifier_undo', 'checker', 'A verifier undid their own last answer')
on conflict (action) do nothing;

-- ---------------------------------------------------------------- verify

do $$
declare
  f text;
  r regprocedure;
  src text;
begin
  -- every counter now reads the counted views and no longer the raw tables
  foreach f in array array[
    'public.checker_checked_today_count()',
    'public.checker_my_stats()',
    'public.checker_leaderboard()',
    'public.verifier_my_papers()',
    'public.hod_team()',
    'public.admin_team_stats(timestamp with time zone, timestamp with time zone)',
    'public.admin_list_checker_accounts()',
    'public.admin_list_checkers()',
    'public.ai_trust_outcomes()'
  ] loop
    r := to_regprocedure(f);
    if r is null then
      continue;
    end if;
    src := pg_get_functiondef(r);
    if position('_counted' in src) = 0
       or src ~* '(from|join)\s+(public\.)?(audit_review_log|content_checks)\M' then
      raise exception 'patch did not apply: %', f;
    end if;
  end loop;

  src := pg_get_functiondef('public.checker_pass_locked(uuid, integer)'::regprocedure);
  if position('''checked_by_user'', v_before.checked_by_user' in src) = 0 then
    raise exception 'patch did not apply: checker_pass_locked';
  end if;
  src := pg_get_functiondef('public.checker_fix_locked(uuid, integer, text, text, numeric, boolean, text)'::regprocedure);
  if position('''checked_by_user'', v_before.checked_by_user' in src) = 0 then
    raise exception 'patch did not apply: checker_fix_locked';
  end if;

  src := pg_get_functiondef('public.verifier_undo_last(uuid)'::regprocedure);
  if position('30 minutes' in src) = 0 or position('verifier_undo' in src) = 0 then
    raise exception 'patch did not apply: verifier_undo_last';
  end if;
end $$;

-- ---------------------------------------------------------------- grants

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.verifier_undo_last(uuid)',
    'public.checker_pass_locked(uuid, integer)',
    'public.checker_fix_locked(uuid, integer, text, text, numeric, boolean, text)',
    'public.checker_checked_today_count()',
    'public.checker_my_stats()',
    'public.checker_leaderboard()',
    'public.verifier_my_papers()',
    'public.hod_team()',
    'public.admin_team_stats(timestamp with time zone, timestamp with time zone)',
    'public.admin_list_checker_accounts()',
    'public.admin_list_checkers()'
  ] loop
    if to_regprocedure(f) is null then
      continue;
    end if;
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  -- The AI helper is for the pipeline (service key) and the definer functions only.
  execute 'revoke all on function public.ai_trust_outcomes() from public, anon, authenticated';
  execute 'grant execute on function public.ai_trust_outcomes() to service_role';
end $$;
