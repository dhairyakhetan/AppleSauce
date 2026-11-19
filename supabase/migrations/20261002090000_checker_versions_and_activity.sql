-- 20261002090000_checker_versions_and_activity.sql
--
-- NOT APPLIED. Written 2026-10-02 for site PR D; live apply needs the owner's yes.
-- Rehearsed against live inside one transaction that raised at the end (nothing kept).
--
-- Site PR D (owner 2026-10-02, "Build it now. Merging stays your click."):
--
--   1. checker_next_question() also returns `version` (audit_questions.version,
--      from 20261001090000_content_versions_lock.sql). The return type changes,
--      so the function is dropped and recreated; the body is the live body
--      (read back with pg_get_functiondef on 2026-10-02) plus that one column.
--      The deployed client ignores unknown fields, so applying this before the
--      site merges breaks nothing.
--
--   2. checker_fix_locked() / checker_pass_locked(): the checker's save and
--      "Looks right", with the version the checker SAW. If the row has moved on
--      (an AI pass, an admin, another checker) the call raises 40001 and writes
--      nothing. A fix goes through apply_fix_locked(), so the change is a new
--      content_versions row (actor 'checker', the checker's user id, a reason),
--      and the version before it stays in history.
--      p_printed_typo = true is the owner's round-24 rule: a student checker
--      MAY correct a typo printed on the paper. It must change the words, it is
--      logged as action 'checker_printed_typo' (audit_review_log) and verdict
--      'printed_typo' (content_checks), and the printed original is the
--      previous version in content_versions, revertable by an admin.
--      Every pass and fix also writes one content_checks row (checker_kind
--      'student', or 'admin' when an admin uses the checker) with version_seen.
--      The old checker_fix_question / checker_pass_question stay as they are so
--      the deployed site keeps working until PR D merges; a later migration can
--      revoke them once nothing calls them.
--
--   3. admin_activity_feed(): one newest-first list of who checked or edited
--      what, merged from audit_review_log, content_versions and content_checks.
--      Actor ids and labels ('ai:sonnet', 'system', 'checker') only: no names,
--      no emails (anything shaped like an email in a free-text note is masked).
--      No snapshots, so no question text and no answer_key.
--
--   4. admin_version_history(): admin_content_versions() for the history panel,
--      but the snapshot never carries answer_key (only has_answer_key), and
--      each row says whether it is the row's current version.
--
--   5. log_action_catalog gains 'checker_printed_typo'.
--
-- SECURITY (CLAUDE.md "the trap"): every new function is revoked from PUBLIC,
-- anon AND authenticated by name, then granted to authenticated only; each one
-- checks is_paper_checker() / is_admin() itself.
--
-- ROLLBACK
--   drop function public.checker_fix_locked(uuid, integer, text, text, numeric, boolean, text);
--   drop function public.checker_pass_locked(uuid, integer);
--   drop function public.admin_activity_feed(integer, timestamptz, text);
--   drop function public.admin_version_history(text, text);
--   delete from public.log_action_catalog where action = 'checker_printed_typo';
--   drop index public.audit_review_log_people_at_idx;
--   drop index public.audit_review_log_at_idx;
--   checker_next_question: drop it and re-run its definition from
--   20260929140000_auto_return_and_lease_timing.sql (the live body without
--   `version`), then revoke from public, anon, authenticated; grant to authenticated.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. checker_next_question + version

drop function if exists public.checker_next_question();

create function public.checker_next_question()
 returns table(id uuid, paper_id uuid, ord integer, display_number text, number_path text, body text,
               options jsonb, marks numeric, instructions text, flag_reasons text[], flag_detail text,
               source jsonb, subject text, school text, cls text, exam text, year text, version integer)
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_subjects text[];
  v_classes text[];
  v_id uuid;
  v_claimed_id uuid;
  v_tried uuid[] := array[]::uuid[];
  v_attempt int := 0;
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select p.subjects, p.classes into v_subjects, v_classes
  from public.paper_checker_prefs p where p.user_id = v_uid;
  if not found then
    select pc.subjects, pc.classes into v_subjects, v_classes
    from public.paper_checkers pc where pc.user_id = v_uid;
  end if;

  loop
    v_attempt := v_attempt + 1;
    exit when v_attempt > 5;

    with candidates as (
      select aq.id, aq.paper_id, aq.ord, aq.locked_by, aq.locked_until, aq.source,
             ap.subject as p_subject, ap.source as p_source, ap.year as p_year,
             ap.created_at as p_created_at
      from public.audit_questions aq
      join public.audit_papers ap on ap.id = aq.paper_id
      where aq.kind = 'question'
        and aq.review_bucket = 'kid'
        and aq.question_passed = false
        and ap.source in ('live_copy', 'new_ocr')
        and btrim(coalesce(aq.body, '')) <> ''
        and (aq.locked_until is null or aq.locked_until < now() or aq.locked_by = v_uid)
        and not (aq.id = any(v_tried))
        and not (coalesce(ap.subject, '') ilike 'English%'
                 or coalesce(aq.source ->> 'pipeline', '') = 'english_w14')
        and (v_subjects is null or array_length(v_subjects, 1) is null or ap.subject = any(v_subjects))
        and (v_classes is null or array_length(v_classes, 1) is null or ap.class = any(v_classes))
        and not exists (
          select 1 from public.audit_question_skips s
          where s.question_id = aq.id and s.user_id = v_uid and s.skipped_at > now() - interval '24 hours'
        )
    ),
    paper_ids as (
      select distinct c0.paper_id from candidates c0
    ),
    paper_open_counts as (
      select p.paper_id,
        (select count(*) from public.audit_questions r
          join public.audit_papers rp on rp.id = r.paper_id
          where r.paper_id = p.paper_id
            and r.kind = 'question'
            and r.review_bucket = 'kid'
            and r.question_passed = false
            and btrim(coalesce(r.body, '')) <> ''
            and not (coalesce(rp.subject, '') ilike 'English%'
                     or coalesce(r.source ->> 'pipeline', '') = 'english_w14')
        ) as open_count
      from paper_ids p
    ),
    skipped_papers as (
      select distinct aq2.paper_id
      from public.audit_question_skips s2
      join public.audit_questions aq2 on aq2.id = s2.question_id
      join paper_ids p2 on p2.paper_id = aq2.paper_id
      where s2.user_id = v_uid and s2.skipped_at > now() - interval '30 minutes'
    )
    select c.id into v_id
    from candidates c
    left join paper_open_counts poc on poc.paper_id = c.paper_id
    left join skipped_papers sp on sp.paper_id = c.paper_id
    order by
      case when c.locked_by = v_uid and c.locked_until > now() then 0 else 1 end,
      case when sp.paper_id is not null then 1 else 0 end,
      case when c.source ->> 'rescue_decision' = 'ai_doubt' then 1 else 0 end,
      case when c.p_source = 'live_copy' then 0 else 1 end,
      coalesce(poc.open_count, 0),
      case when c.p_year ~ '^\d+$' then c.p_year::int else 0 end desc,
      c.p_created_at, c.ord
    limit 1;

    if v_id is null then
      return;
    end if;

    update public.audit_questions
    set locked_by = v_uid, locked_until = now() + interval '10 minutes', leased_at = now()
    where public.audit_questions.id = v_id
      and (public.audit_questions.locked_until is null
           or public.audit_questions.locked_until < now()
           or public.audit_questions.locked_by = v_uid)
      and public.audit_questions.review_bucket = 'kid'
      and not public.audit_questions.question_passed
      and btrim(coalesce(public.audit_questions.body, '')) <> ''
    returning public.audit_questions.id into v_claimed_id;

    if v_claimed_id is not null then
      exit;
    end if;

    v_tried := v_tried || v_id;
    v_id := null;
  end loop;

  if v_claimed_id is null then
    return;
  end if;

  return query
    select aq.id, aq.paper_id, aq.ord, aq.display_number, aq.number_path,
           aq.body, aq.options, aq.marks, aq.instructions,
           aq.flag_reasons, aq.flag_detail, aq.source,
           ap.subject, ap.school, ap.class, ap.exam_type, ap.year,
           aq.version
    from public.audit_questions aq
    join public.audit_papers ap on ap.id = aq.paper_id
    where aq.id = v_claimed_id;
end;
$function$;

revoke all on function public.checker_next_question() from public, anon, authenticated;
grant execute on function public.checker_next_question() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. the checker's save and pass, under the version lock

create or replace function public.checker_fix_locked(
  p_question_id uuid,
  p_expected_version integer,
  p_body text,
  p_display_number text,
  p_marks numeric,
  p_printed_typo boolean default false,
  p_typo_note text default null)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_before public.audit_questions;
  v_current integer;
  v_changes jsonb;
  v_new integer;
  v_typo boolean := coalesce(p_printed_typo, false);
  v_note text := nullif(left(btrim(coalesce(p_typo_note, '')), 500), '');
begin
  v_before := public.checker_authorize_question(p_question_id);

  -- The row lock and the version comparison happen together, so nothing can
  -- slip in between them.
  select aq.version into v_current from public.audit_questions aq where aq.id = p_question_id for update;
  if p_expected_version is null or v_current is distinct from p_expected_version then
    raise exception 'stale question: you saw version %, it is now at version %',
      coalesce(p_expected_version::text, 'none'), v_current using errcode = '40001';
  end if;

  if btrim(coalesce(p_body, v_before.body, '')) = '' then
    raise exception 'This question has no words; it cannot be passed' using errcode = '22023';
  end if;
  if v_typo and (p_body is null or p_body = v_before.body) then
    raise exception 'A printed typo fix must change the words' using errcode = '22023';
  end if;

  -- Only the fields the checker sent (null keeps the stored value byte for byte).
  v_changes := jsonb_strip_nulls(jsonb_build_object(
    'body', p_body, 'display_number', p_display_number, 'marks', p_marks));

  v_new := v_current;
  if v_changes <> '{}'::jsonb then
    v_new := public.apply_fix_locked(
      'audit_questions', p_question_id::text, v_current, v_changes,
      'checker', 'checker',
      case when v_typo then 'printed typo corrected by a checker' || coalesce(': ' || v_note, '')
           else 'checker fix' end);
  end if;

  -- Status and lease columns are not content: no new version from this.
  update public.audit_questions
  set status = 'passed', question_passed = true, checked_by_user = auth.uid(),
      locked_by = null, locked_until = null
  where id = p_question_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
  values (null, auth.uid(), v_before.paper_id, p_question_id,
          case when v_typo then 'checker_printed_typo' else 'checker_fix' end, null,
          jsonb_build_object('body', v_before.body, 'display_number', v_before.display_number,
                             'marks', v_before.marks, 'version', v_current),
          jsonb_build_object('body', p_body, 'display_number', p_display_number,
                             'marks', p_marks, 'version', v_new),
          v_note);

  insert into public.content_checks
    (table_name, row_id, version_seen, checker_kind, actor_user_id, verdict, proposed_changes, applied_version, notes)
  values ('audit_questions', p_question_id::text, v_current,
          case when public.is_admin() then 'admin' else 'student' end, auth.uid(),
          case when v_typo then 'printed_typo' else 'fix' end,
          v_changes, case when v_new is distinct from v_current then v_new end, v_note);

  return v_new;
end;
$function$;

revoke all on function public.checker_fix_locked(uuid, integer, text, text, numeric, boolean, text) from public, anon, authenticated;
grant execute on function public.checker_fix_locked(uuid, integer, text, text, numeric, boolean, text) to authenticated;

create or replace function public.checker_pass_locked(p_question_id uuid, p_expected_version integer)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_before public.audit_questions;
  v_current integer;
begin
  v_before := public.checker_authorize_question(p_question_id);

  select aq.version into v_current from public.audit_questions aq where aq.id = p_question_id for update;
  if p_expected_version is null or v_current is distinct from p_expected_version then
    raise exception 'stale question: you saw version %, it is now at version %',
      coalesce(p_expected_version::text, 'none'), v_current using errcode = '40001';
  end if;

  if btrim(coalesce(v_before.body, '')) = '' then
    raise exception 'This question has no words; it cannot be passed' using errcode = '22023';
  end if;

  update public.audit_questions
  set status = 'passed', question_passed = true, checked_by_user = auth.uid(),
      locked_by = null, locked_until = null
  where id = p_question_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after)
  values (null, auth.uid(), v_before.paper_id, p_question_id, 'checker_pass', null,
          jsonb_build_object('status', v_before.status, 'question_passed', v_before.question_passed, 'version', v_current),
          jsonb_build_object('status', 'passed', 'question_passed', true, 'version', v_current));

  insert into public.content_checks
    (table_name, row_id, version_seen, checker_kind, actor_user_id, verdict)
  values ('audit_questions', p_question_id::text, v_current,
          case when public.is_admin() then 'admin' else 'student' end, auth.uid(), 'pass');

  return v_current;
end;
$function$;

revoke all on function public.checker_pass_locked(uuid, integer) from public, anon, authenticated;
grant execute on function public.checker_pass_locked(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. activity feed (admin): ids and labels only
--
-- audit_review_log has ~89k rows, almost all written by the pipeline with no
-- actor. Without an index on `at` the "people" view scanned and sorted all of
-- them (1.6 s in rehearsal). The partial index holds only rows a person wrote.

create index if not exists audit_review_log_people_at_idx
  on public.audit_review_log (at desc) where actor_user_id is not null;
create index if not exists audit_review_log_at_idx
  on public.audit_review_log (at desc);

create or replace function public.admin_activity_feed(
  p_limit integer default 200,
  p_before timestamptz default null,
  p_scope text default 'people')
 returns table (at timestamptz, stream text, event_id text, actor_user_id uuid, actor_label text,
                actor_kind text, action text, table_name text, row_id text, paper_id text,
                question_id text, version integer, detail text)
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_before timestamptz := coalesce(p_before, 'infinity'::timestamptz);
  v_scope text := coalesce(p_scope, 'people');
  v_email constant text := '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+';
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_scope not in ('people', 'ai', 'all') then
    raise exception 'Unknown scope %', v_scope using errcode = '22023';
  end if;

  return query
  with log_rows as (
    select l.at, 'log'::text as stream, l.id::text as event_id, l.actor_user_id,
           case when l.actor_user_id is null then coalesce(c.kind, 'pipeline') end as actor_label,
           case when l.actor_user_id is not null and c.kind is distinct from 'admin'
                     and l.action like 'checker%' then 'checker'
                when l.actor_user_id is not null then coalesce(c.kind, 'person')
                else coalesce(c.kind, 'pipeline') end as actor_kind,
           l.action, 'audit_questions'::text as table_name, l.question_id::text as row_id,
           l.paper_id::text as paper_id, l.question_id::text as question_id,
           case when (l.after ->> 'version') ~ '^[0-9]{1,9}$' then (l.after ->> 'version')::integer end as version,
           regexp_replace(left(coalesce(l.note, l.field, ''), 200), v_email, '[email]', 'g') as detail
    from public.audit_review_log l
    left join public.log_action_catalog c on c.action = l.action
    where l.at < v_before
      and case v_scope
            -- every checker/admin function logs auth.uid(), so a person's row
            -- always has an actor; this is what the partial index below serves
            when 'people' then l.actor_user_id is not null
            when 'ai' then c.kind = 'ai'
            else true end
    order by l.at desc
    limit v_limit
  ), version_rows as (
    select v.created_at as at, 'version'::text, v.id::text, v.actor_user_id,
           case when v.actor_user_id is null then v.actor end,
           (case when v.actor like 'ai:%' then 'ai'
                 when v.actor like 'system%' then 'system'
                 when v.actor = 'checker' or v.source = 'checker' then 'checker'
                 when v.source = 'admin' or v.op = 'revert' then 'admin'
                 when v.actor_user_id is not null then 'person'
                 else 'system' end),
           'version_' || v.op, v.table_name, v.row_id,
           case when v.table_name in ('audit_questions', 'bank_questions') then v.snapshot ->> 'paper_id' else v.row_id end,
           case when v.table_name in ('audit_questions', 'bank_questions') then v.row_id end,
           v.version,
           regexp_replace(left(coalesce(v.reason, v.source, ''), 200), v_email, '[email]', 'g')
    from public.content_versions v
    where v.created_at < v_before
      and v.op <> 'backfill'
      and case v_scope
            when 'people' then v.actor_user_id is not null or v.actor = 'checker' or v.source in ('checker', 'admin')
            when 'ai' then v.actor like 'ai:%'
            else true end
    order by v.created_at desc
    limit v_limit
  ), check_rows as (
    select k.created_at as at, 'check'::text, k.id::text, k.actor_user_id,
           case when k.actor_user_id is null then coalesce(k.model, k.checker_kind) end,
           (case k.checker_kind when 'student' then 'checker' when 'admin' then 'admin' else 'ai' end),
           'check_' || k.verdict, k.table_name, k.row_id,
           null::text,
           case when k.table_name in ('audit_questions', 'bank_questions') then k.row_id end,
           k.version_seen,
           regexp_replace(left(concat_ws(' ', case when k.confidence is not null
                                                   then 'confidence ' || round(k.confidence, 2)::text end,
                                         k.notes), 200), v_email, '[email]', 'g')
    from public.content_checks k
    where k.created_at < v_before
      and case v_scope
            when 'people' then k.checker_kind in ('student', 'admin')
            when 'ai' then k.checker_kind not in ('student', 'admin')
            else true end
    order by k.created_at desc
    limit v_limit
  )
  select * from (
    select * from log_rows
    union all select * from version_rows
    union all select * from check_rows
  ) u
  order by u.at desc, u.stream, u.event_id desc
  limit v_limit;
end;
$function$;

revoke all on function public.admin_activity_feed(integer, timestamptz, text) from public, anon, authenticated;
grant execute on function public.admin_activity_feed(integer, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. version history for the admin panel, answer_key never included

create or replace function public.admin_version_history(p_table text, p_row_id text)
 returns table (version integer, op text, content_sha256 text, snapshot jsonb, has_answer_key boolean,
                actor text, actor_user_id uuid, source text, reason text, created_at timestamptz,
                is_current boolean)
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_current integer;
  v_key_type text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_table not in ('bank_questions', 'bank_papers', 'audit_questions', 'audit_papers') then
    raise exception 'Unknown table %', p_table using errcode = '22023';
  end if;
  v_key_type := case when p_table like 'audit_%' then 'uuid' else 'text' end;
  if v_key_type = 'uuid' and p_row_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Not a row id: %', p_row_id using errcode = '22023';
  end if;
  execute format('select version from public.%I where id = $1::%s', p_table, v_key_type)
    into v_current using p_row_id;

  return query
    select v.version, v.op, v.content_sha256, v.snapshot - 'answer_key',
           coalesce(v.snapshot ->> 'answer_key', '') <> '',
           v.actor, v.actor_user_id, v.source, v.reason, v.created_at,
           (v_current is not null and v.version = v_current and v.op <> 'delete')
    from public.content_versions v
    where v.table_name = p_table and v.row_id = p_row_id
    order by v.version desc, v.id desc;
end;
$function$;

revoke all on function public.admin_version_history(text, text) from public, anon, authenticated;
grant execute on function public.admin_version_history(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. catalog

insert into public.log_action_catalog (action, kind, meaning) values
  ('checker_printed_typo', 'checker', 'A checker corrected a typo printed on the paper; the printed original is the previous version')
on conflict (action) do nothing;

commit;
