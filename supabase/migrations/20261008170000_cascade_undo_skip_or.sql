-- Cascade fixes for undo, skip-for-later and OR alternatives (8 Oct 2026).
--
-- A system sweep after 20261008140000 (undo), 20261008150000 (OR) and
-- 20261008160000 (skip for later) found effects that had not been followed
-- through. This migration closes them. Nothing here changes a table.
--
--  1. Undone rows stop counting. The first undo migration moved the verifier
--     counters onto audit_review_log_counted / content_checks_counted. Seven
--     more readers still read the raw tables, so an undone pass still counted
--     in the admin Checkers list, the approval queue, paper progress, the AI
--     backfill, the HOD's Escalated list and the 7 day idle return. They now
--     read the counted views. admin_checker_day_log counts only the rows that
--     stand, but its list of events is history and keeps every row; each event
--     now says whether it was undone.
--  2. checker_settle_current used a 24 hour window for skips. It now uses the
--     rule verifier_next_in_paper uses (a skip by this verifier since the
--     assignment began, no window), and a paper whose only remaining questions
--     are skipped stays open for that verifier. verifier_close_finished and
--     checker_next_question already agree with that and are untouched.
--  3. Publish paths carry alternative_group / alternative_label to the library:
--     apply_live_copy_paper_to_live, english_rescue_publish_question,
--     english_rescue_publish_split_half and apply_new_ocr_fixes_to_live.
--     english_place_stimulus inserts reading passages, not questions, and
--     admin_undo_revision restores a whole stored row, so neither needed it.
--  4. A paper whose class is unknown can go to ANY verifier (owner decision).
--     distribute_unassigned_papers treated it as Class 12; now it is eligible
--     for everyone, matching verifier_can_take. A verifier with no grade still
--     counts as 12.
--  5. History readers that return JSON now say whether an event was undone
--     (history_events, admin_question_full_history, admin_checker_day_log), and
--     hod_action_history gains an `undone` column. The other readers that
--     return a fixed table (admin_activity_feed, admin_checker_log,
--     admin_question_history) are left alone: adding a column to them means
--     dropping and re-creating them under the admin screens being reworked.
--
-- Patches to live functions are done in place (pg_get_functiondef + replace);
-- every patch is counted and the migration raises if one did not apply or
-- applied the wrong number of times. CREATE OR REPLACE keeps each function's
-- grants; the last block states them again and the verify block before it
-- checks that anon can execute none of them.

-- ---------------------------------------------------------------- 1. counters

-- Only the READS move to the views (from / join); the insert in
-- verifier_return_idle keeps writing the real table.
do $$
declare
  f text;
  r regprocedure;
  src text;
  new_src text;
begin
  foreach f in array array[
    'public.admin_checker_list()',
    'public.admin_approval_queue()',
    'public.ai_backfill_confidence()',
    'public.admin_paper_progress()',
    'public.hod_escalations()',
    'public.verifier_return_idle()'
  ] loop
    r := to_regprocedure(f);
    if r is null then
      raise exception 'missing function: %', f;
    end if;
    src := pg_get_functiondef(r);
    new_src := regexp_replace(src, '(\m(?:from|join)\s+)(?:public\.)?audit_review_log\M', '\1public.audit_review_log_counted', 'gi');
    new_src := regexp_replace(new_src, '(\m(?:from|join)\s+)(?:public\.)?content_checks\M', '\1public.content_checks_counted', 'gi');
    if new_src = src and position('_counted' in src) = 0 then
      raise exception 'patch did not apply: % reads neither table', f;
    end if;
    if new_src <> src then
      execute new_src;
    end if;
  end loop;
end $$;

-- The day log: counts and per-day totals leave out undone rows, the event list
-- keeps every row and marks the undone ones.
create or replace function public.admin_checker_day_log(p_actor_key text, p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_email constant text := '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+';
  v_uuid constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_to date := coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date);
  v_from date;
  v_uid uuid;
  v_key text;
  v_start timestamptz;
  v_end timestamptz;
  v_who jsonb;
  v_days jsonb;
  v_total integer;
  v_person boolean;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if nullif(btrim(p_actor_key), '') is null then
    raise exception 'Choose a person' using errcode = '22023';
  end if;
  v_from := coalesce(p_from, v_to - 29);
  if v_from > v_to then
    raise exception 'The start date is after the end date' using errcode = '22023';
  end if;
  if v_to - v_from > 89 then
    v_from := v_to - 89;
  end if;
  if btrim(p_actor_key) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_uid := btrim(p_actor_key)::uuid;
  end if;
  v_key := coalesce(v_uid::text, lower(btrim(p_actor_key)));
  if v_uid is null and v_key not in ('ai:sonnet', 'ai:haiku', 'student:unknown', 'admin:unknown', 'pipeline') then
    raise exception 'Unknown person' using errcode = '22023';
  end if;
  v_start := v_from::timestamp at time zone 'Asia/Kolkata';
  v_end := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';
  v_who := public.history_actor_from_key(v_key);
  v_person := v_who ->> 'kind' in ('admin', 'student');

  with raw as (
    -- a person: their own rows, through the actor index
    select 'log'::text as src, l.id, l.at, case when c.action is not null then l.action else 'other' end as code,
           (l.undone_at is not null) as undone
    from public.audit_review_log l
    left join public.log_action_catalog c on c.action = l.action
    where v_uid is not null and l.actor_user_id = v_uid and l.at >= v_start and l.at < v_end
    union all
    -- a pseudo-actor: rows with no person, keyed the same way as everywhere else
    select 'log', l.id, l.at, case when c.action is not null then l.action else 'other' end,
           (l.undone_at is not null)
    from public.audit_review_log l
    left join public.log_action_catalog c on c.action = l.action
    left join public.audit_questions q on c.kind = 'ai' and q.id = l.question_id
    where v_uid is null and l.actor_user_id is null and l.at >= v_start and l.at < v_end
      and (v_key not like 'ai:%' or c.kind = 'ai')
      and public.history_actor_key(null, null,
            case when c.kind = 'ai' then concat_ws(' ', l.note, q.checked_by) end) = v_key
    union all
    select 'rev', r.id, r.created_at, case when c.action is not null then r.action else 'other' end,
           false
    from public.bank_question_revisions r
    left join public.log_action_catalog c on c.action = r.action
    where r.created_at >= v_start and r.created_at < v_end
      and public.history_actor_key(r.actor_user_id, r.actor, null) = v_key
    union all
    select 'check', k.id, k.created_at, 'check_' || k.verdict,
           (k.undone_at is not null)
    from public.content_checks k
    where k.created_at >= v_start and k.created_at < v_end
      and k.checker_kind not in ('student', 'admin')
      and public.history_actor_key(k.actor_user_id, k.checker_kind, k.model) = v_key
  ),
  coded as (
    select r.*, (r.at at time zone 'Asia/Kolkata')::date as day, public.history_action_bucket(r.code) as bucket
    from raw r
  ),
  -- Counts and totals: the rows that stand. An undone pass is not a pass.
  day_counts as (
    select cd.day,
           jsonb_build_object(
             'passed', count(*) filter (where cd.bucket = 'passed' and not cd.undone),
             'fixed', count(*) filter (where cd.bucket = 'fixed' and not cd.undone),
             'set_aside', count(*) filter (where cd.bucket = 'set_aside' and not cd.undone),
             'flagged', count(*) filter (where cd.bucket = 'flagged' and not cd.undone),
             'edited', count(*) filter (where cd.bucket = 'edited' and not cd.undone),
             'approved', count(*) filter (where cd.bucket = 'approved' and not cd.undone),
             'other', count(*) filter (where cd.bucket = 'other' and not cd.undone)) as counts,
           count(*) filter (where not cd.undone) as n
    from coded cd
    group by cd.day
  ),
  -- The event list is history: every row, undone ones included.
  top_rows as (
    select cd.* from coded cd order by cd.at desc, cd.id desc limit 5000
  ),
  ev as (
    select t.day, t.at, t.id,
           jsonb_build_object(
             'at', t.at,
             'actor_name', v_who ->> 'name',
             'actor_kind', v_who ->> 'kind',
             'action', t.code,
             'bucket', t.bucket,
             'undone', t.undone,
             'changes', case when t.src = 'log' then public.history_changes(l.field, l.before, l.after)
                             when t.src = 'rev' then public.history_changes(r.field, r.before, r.after)
                             else '[]'::jsonb end,
             'note', case when v_person and nullif(btrim(coalesce(l.note, r.reason, k.notes)), '') is not null
                          then regexp_replace(regexp_replace(left(coalesce(l.note, r.reason, k.notes), 500),
                                                             v_email, '[email]', 'g'),
                                              v_uuid, '[id]', 'gi') end,
             'question_number', coalesce(qa.display_number, qb.display_number),
             'confidence', k.confidence,
             'version', case when t.src = 'check' then k.version_seen
                             when (l.after ->> 'version') ~ '^[0-9]{1,9}$' then (l.after ->> 'version')::integer end,
             'paper_audit_id', ap.id,
             'paper_title', coalesce(
                 case when ap.id is not null then
                   coalesce(nullif(btrim(ap.title), ''),
                            concat_ws(' ', coalesce(ap.publish_meta ->> 'school', ap.school),
                                      coalesce(ap.publish_meta ->> 'subject', ap.subject),
                                      coalesce(ap.publish_meta ->> 'cls', ap.class),
                                      coalesce(ap.publish_meta ->> 'exam', ap.exam_type),
                                      nullif(coalesce(ap.publish_meta ->> 'year', ap.year), 'year-unknown'))) end,
                 case when bp.id is not null then concat_ws(' ', bp.school, bp.subject, bp.cls, bp.exam, bp.year) end)
           ) as e
    from top_rows t
    left join public.audit_review_log l on t.src = 'log' and l.id = t.id
    left join public.bank_question_revisions r on t.src = 'rev' and r.id = t.id
    left join public.content_checks k on t.src = 'check' and k.id = t.id
    left join public.audit_questions qa on qa.id = case
        when t.src = 'log' then l.question_id
        when t.src = 'rev' then r.audit_question_id
        when t.src = 'check' and k.table_name = 'audit_questions' then k.row_id::uuid end
    left join lateral (
      select q2.display_number, q2.paper_id
      from public.audit_questions q2
      where qa.id is null and q2.kind = 'question'
        and q2.live_bank_question_id = case
          when t.src = 'rev' and r.table_name = 'bank_questions' then r.row_id
          when t.src = 'check' and k.table_name = 'bank_questions' then k.row_id end
      order by q2.updated_at desc limit 1
    ) qb on true
    left join public.audit_papers ap on ap.id = coalesce(l.paper_id, r.audit_paper_id, qa.paper_id, qb.paper_id)
    left join public.bank_questions bq on ap.id is null and t.src = 'rev' and r.table_name = 'bank_questions' and bq.id = r.row_id
    left join public.bank_papers bp on ap.id is null and bp.id = case
        when t.src = 'rev' and r.table_name = 'bank_papers' then r.row_id
        else bq.paper_id end
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'day', d.day,
           'total', d.n,
           'counts', d.counts,
           'events', coalesce(x.evs, '[]'::jsonb)) order by d.day desc), '[]'::jsonb),
         coalesce(sum(d.n), 0)::integer
    into v_days, v_total
  from day_counts d
  left join (select ev.day, jsonb_agg(ev.e order by ev.at desc, ev.id desc) as evs from ev group by ev.day) x
    on x.day = d.day;

  return jsonb_build_object(
    'actor', jsonb_build_object('name', v_who ->> 'name', 'role', v_who ->> 'kind'),
    'from', v_from,
    'to', v_to,
    'total_events', v_total,
    'truncated', v_total > 5000,
    'days', v_days);
end;
$function$;

-- ---------------------------------------------------------------- 2. skip rule in checker_settle_current

-- One rule for a skip, everywhere: this verifier skipped the question since the
-- assignment began (no day window), the same test verifier_next_in_paper uses.
-- A paper whose only remaining questions are skipped stays open for them (the
-- skipped questions wait on the paper) and the search moves on to the next
-- paper. A paper is closed only when nothing is left (done) or what is left is
-- held by someone else (returned), exactly as before.
create or replace function public.checker_settle_current(p_uid uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_a public.checker_assignments;
  v_left_for_me int;
  v_left_skipped int;
  v_left_at_all int;
begin
  for v_a in
    select * from public.checker_assignments
    where user_id = p_uid and status in ('assigned', 'queued')
    order by (status <> 'assigned'), assigned_at, id
    for update
  loop
    select count(*) filter (
             where (q.locked_until is null or q.locked_until < now() or q.locked_by = p_uid)
               and not exists (select 1 from public.audit_question_skips s
                               where s.question_id = q.id and s.user_id = p_uid
                                 and s.skipped_at >= v_a.assigned_at)),
           count(*) filter (
             where (q.locked_until is null or q.locked_until < now() or q.locked_by = p_uid)
               and exists (select 1 from public.audit_question_skips s
                           where s.question_id = q.id and s.user_id = p_uid
                             and s.skipped_at >= v_a.assigned_at)),
           count(*)
      into v_left_for_me, v_left_skipped, v_left_at_all
    from public.audit_questions q
    where q.paper_id = v_a.audit_paper_id
      and (q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question' and public.checker_question_servable(q));

    if v_left_for_me > 0 then
      if v_a.status = 'queued' then
        update public.checker_assignments set status = 'assigned', started_at = now() where id = v_a.id;
      end if;
      return v_a.audit_paper_id;
    end if;

    -- Only skipped questions are left: the paper stays open for them to come
    -- back to, and they go on to another paper.
    if v_left_skipped > 0 then
      continue;
    end if;

    update public.checker_assignments
    set status = case when v_left_at_all = 0 then 'done' else 'returned' end,
        closed_at = now(),
        closed_reason = case when v_left_at_all = 0 then 'all questions checked'
                             else 'the rest of the paper was held by someone else' end
    where id = v_a.id;
  end loop;
  return null;
end;
$function$;


-- ---------------------------------------------------------------- 3 to 5. in-place patches

-- One list of patches. Each is: the function, the order, a piece of its text
-- that must occur exactly `expected` times, and what replaces it. A function is
-- written back only after all of its patches applied.
create temp table _cascade_patch (
  fn text not null,
  ord int not null,
  anchor text not null,
  replacement text not null,
  expected int not null default 1
);

insert into _cascade_patch (fn, ord, anchor, replacement) values
  -- 3. The OR link reaches the library -------------------------------------
  ('public.apply_live_copy_paper_to_live(uuid)', 1,
   'chapter, answer_key, qtype, page, figure, options)',
   'chapter, answer_key, qtype, page, figure, options, alternative_group, alternative_label)'),
  ('public.apply_live_copy_paper_to_live(uuid)', 2,
   'v_q.body, v_q.marks, v_q.chapter, v_q.answer_key, null, null, null, null);',
   'v_q.body, v_q.marks, v_q.chapter, v_q.answer_key, null, null, null, null, v_q.alternative_group, v_q.alternative_label);'),
  ('public.apply_live_copy_paper_to_live(uuid)', 3,
   'marks, chapter, qtype, page, figure, options)',
   'marks, chapter, qtype, page, figure, options, alternative_group, alternative_label)'),
  ('public.apply_live_copy_paper_to_live(uuid)', 4,
   'v_q.body, v_q.marks, v_parent.chapter, null, null, null, null);',
   'v_q.body, v_q.marks, v_parent.chapter, null, null, null, null, v_q.alternative_group, v_q.alternative_label);'),
  -- Pass 2 (rows already live): an OR link made on a live paper reaches the
  -- library. Written only when the checked copy HAS a link and it differs from
  -- the live row, so a copy with none can never blank a link the library holds.
  ('public.apply_live_copy_paper_to_live(uuid)', 5,
   'if v_q.answer_key is distinct from (v_before->>''answer_key'') then',
   'if nullif(btrim(coalesce(v_q.alternative_group, '''')), '''') is not null
       and v_q.alternative_group is distinct from (v_before->>''alternative_group'') then
      update public.bank_questions set alternative_group = v_q.alternative_group
        where id = v_q.live_bank_question_id and paper_id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
      values (''bank_questions'', v_q.live_bank_question_id, ''live_apply'', ''alternative_group'',
              to_jsonb(v_before->>''alternative_group''), to_jsonb(v_q.alternative_group), v_actor, v_actor_user_id, v_source,
              p_audit_paper_id, v_q.id);
    end if;

    if nullif(btrim(coalesce(v_q.alternative_label, '''')), '''') is not null
       and v_q.alternative_label is distinct from (v_before->>''alternative_label'') then
      update public.bank_questions set alternative_label = v_q.alternative_label
        where id = v_q.live_bank_question_id and paper_id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
      values (''bank_questions'', v_q.live_bank_question_id, ''live_apply'', ''alternative_label'',
              to_jsonb(v_before->>''alternative_label''), to_jsonb(v_q.alternative_label), v_actor, v_actor_user_id, v_source,
              p_audit_paper_id, v_q.id);
    end if;

    if v_q.answer_key is distinct from (v_before->>''answer_key'') then'),

  ('public.english_rescue_publish_question(uuid)', 1,
   'chapter, qtype, page, figure, options, instructions)',
   'chapter, qtype, page, figure, options, instructions, alternative_group, alternative_label)'),
  ('public.english_rescue_publish_question(uuid)', 2,
   'v_q.chapter, v_q.qtype, null, null, v_options, v_q.instructions);',
   'v_q.chapter, v_q.qtype, null, null, v_options, v_q.instructions, v_q.alternative_group, v_q.alternative_label);'),

  ('public.english_rescue_publish_split_half(uuid)', 1,
   'marks, chapter, qtype, page, figure, options)',
   'marks, chapter, qtype, page, figure, options, alternative_group, alternative_label)'),
  ('public.english_rescue_publish_split_half(uuid)', 2,
   'v_parent.chapter, v_parent.qtype, null, null, null);',
   'v_parent.chapter, v_parent.qtype, null, null, null, v_q.alternative_group, v_q.alternative_label);'),

  -- Pipeline papers already live: same guarded pattern as the other fields.
  ('public.apply_new_ocr_fixes_to_live(uuid)', 1,
   'if v_q.answer_key is not null and v_q.answer_key is distinct from (v_before->>''answer_key'') then',
   'if nullif(btrim(coalesce(v_q.alternative_group, '''')), '''') is not null
       and v_q.alternative_group is distinct from (v_before->>''alternative_group'') then
      update public.bank_questions set alternative_group = v_q.alternative_group
        where id = v_q.live_bank_question_id and paper_id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
      values (''bank_questions'', v_q.live_bank_question_id, ''live_apply'', ''alternative_group'',
              to_jsonb(v_before->>''alternative_group''), to_jsonb(v_q.alternative_group), v_actor, v_actor_user_id, v_source,
              p_audit_paper_id, v_q.id);
      v_written := v_written + 1;
    end if;

    if nullif(btrim(coalesce(v_q.alternative_label, '''')), '''') is not null
       and v_q.alternative_label is distinct from (v_before->>''alternative_label'') then
      update public.bank_questions set alternative_label = v_q.alternative_label
        where id = v_q.live_bank_question_id and paper_id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
      values (''bank_questions'', v_q.live_bank_question_id, ''live_apply'', ''alternative_label'',
              to_jsonb(v_before->>''alternative_label''), to_jsonb(v_q.alternative_label), v_actor, v_actor_user_id, v_source,
              p_audit_paper_id, v_q.id);
      v_written := v_written + 1;
    end if;

    if v_q.answer_key is not null and v_q.answer_key is distinct from (v_before->>''answer_key'') then'),

  -- 4. An unknown class is eligible for every verifier ---------------------
  -- The paper's grade stays null when its class is unknown (it used to be
  -- forced to 12), and "p.grade <= d.grade" becomes "unknown or <=". A
  -- verifier with no grade still counts as 12.
  ('public.distribute_unassigned_papers()', 1,
   'coalesce(public.class_grade(ap.class), 12) as grade,',
   'public.class_grade(ap.class) as grade,'),
  ('public.distribute_unassigned_papers()', 2,
   'public.subject_family(ap.subject), coalesce(public.class_grade(ap.class), 12)',
   'public.subject_family(ap.subject), public.class_grade(ap.class)'),
  ('public.distribute_unassigned_papers()', 3,
   'dp.grade <= d.grade',
   '(dp.grade is null or dp.grade <= d.grade)'),
  ('public.distribute_unassigned_papers()', 4,
   'where p.grade <= d.grade and d.papers < public.verifier_paper_cap();',
   'where (p.grade is null or p.grade <= d.grade) and d.papers < public.verifier_paper_cap();'),
  ('public.distribute_unassigned_papers()', 5,
   'where p.grade <= d.grade and d.papers < public.verifier_paper_cap() and (d.load',
   'where (p.grade is null or p.grade <= d.grade) and d.papers < public.verifier_paper_cap() and (d.load'),

  -- 5. An undone check is marked in a question's full history --------------
  ('public.admin_question_full_history(uuid)', 1,
   '''version_seen'', k.version_seen,',
   '''version_seen'', k.version_seen,
           ''undone'', k.undone_at is not null,');

do $$
declare
  f text;
  src text;
  p record;
  n int;
begin
  for f in select distinct fn from _cascade_patch order by fn loop
    if to_regprocedure(f) is null then
      raise exception 'missing function: %', f;
    end if;
    src := pg_get_functiondef(to_regprocedure(f));
    for p in select * from _cascade_patch where fn = f order by ord loop
      n := (length(src) - length(replace(src, p.anchor, ''))) / length(p.anchor);
      if n <> p.expected then
        raise exception 'patch did not apply: % anchor occurs % times, expected %: %', f, n, p.expected, left(p.anchor, 70);
      end if;
      src := replace(src, p.anchor, p.replacement);
    end loop;
    execute src;
  end loop;
end $$;

drop table _cascade_patch;

-- ---------------------------------------------------------------- 5. history readers

-- history_events: each event now says whether it was undone. The extra key is
-- inside the jsonb, so the signature (and every caller) is unchanged.
create or replace function public.history_events(p_audit_paper_id uuid, p_question_id uuid)
returns table(at timestamptz, seq bigint, ev jsonb)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_email constant text := '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+';
  v_uuid constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_live_paper text;
begin
  select ap.live_bank_paper_id into v_live_paper from public.audit_papers ap where ap.id = p_audit_paper_id;

  -- Each source is read through its own index (question_id, paper_id,
  -- row_id, audit_question_id); no OR across them.
  return query
  with qs as (
    select q.id, q.display_number, q.live_bank_question_id, q.checked_by
    from public.audit_questions q
    where q.paper_id = p_audit_paper_id
      and (p_question_id is null or q.id = p_question_id)
  ),
  log_rows as (
    select l.id, l.at, l.actor_user_id, l.action, l.field, l.before, l.after, l.note, l.question_id, l.undone_at
    from public.audit_review_log l
    where p_question_id is not null and l.question_id = p_question_id
    union all
    select l.id, l.at, l.actor_user_id, l.action, l.field, l.before, l.after, l.note, l.question_id, l.undone_at
    from public.audit_review_log l
    where l.paper_id = p_audit_paper_id
      and (p_question_id is null
           or (l.question_id is null
               and l.action in ('admin_approve', 'admin_reject', 'admin_unpublish', 'queued_for_approval')))
  ),
  log_ev as (
    select lr.id, lr.at, lr.action, (c.action is not null) as known, lr.field, lr.before, lr.after, lr.note,
           (lr.undone_at is not null) as undone,
           lr.question_id,
           public.history_actor(lr.actor_user_id, null,
             case when c.kind = 'ai'
                  then concat_ws(' ', lr.note,
                                 (select qs.checked_by from qs where qs.id = lr.question_id)) end) as who
    from log_rows lr
    left join public.log_action_catalog c on c.action = lr.action
  ),
  rev_ids as (
    select r.id from public.bank_question_revisions r
    where r.table_name = 'bank_questions'
      and r.row_id in (select qs.live_bank_question_id from qs where qs.live_bank_question_id is not null)
    union
    select r.id from public.bank_question_revisions r
    where r.audit_question_id in (select qs.id from qs)
    union
    select r.id from public.bank_question_revisions r
    where p_question_id is null and v_live_paper is not null
      and r.table_name = 'bank_papers' and r.row_id = v_live_paper
  ),
  rev_rows as (
    select r.id, r.created_at as at, r.action, (c.action is not null) as known, r.field, r.before, r.after,
           r.reason, r.actor, r.actor_user_id,
           coalesce(r.audit_question_id, (select qs.id from qs where qs.live_bank_question_id = r.row_id limit 1)) as question_id
    from public.bank_question_revisions r
    left join public.log_action_catalog c on c.action = r.action
    where r.id in (select rev_ids.id from rev_ids)
  ),
  -- A person's pass / fix / set-aside is already its own log line; their
  -- check row is not repeated here (it stays in checks[]).
  check_rows as (
    select k.id, k.created_at as at, k.verdict, k.checker_kind, k.model, k.actor_user_id, k.confidence,
           k.version_seen, k.notes, qs.id as question_id, k.undone_at
    from public.content_checks k
    join qs on k.table_name = 'audit_questions' and k.row_id = qs.id::text
    where k.checker_kind not in ('admin', 'student')
    union all
    select k.id, k.created_at, k.verdict, k.checker_kind, k.model, k.actor_user_id, k.confidence,
           k.version_seen, k.notes, qs.id, k.undone_at
    from public.content_checks k
    join qs on k.table_name = 'bank_questions' and k.row_id = qs.live_bank_question_id
    where k.checker_kind not in ('admin', 'student')
  )
  select e.at, e.seq, jsonb_build_object(
           'at', e.at,
           'actor_name', e.who ->> 'name',
           'actor_kind', e.who ->> 'kind',
           'action', e.action,
           'undone', e.undone,
           'changes', e.changes,
           'note', case when e.who ->> 'kind' in ('admin', 'student') and nullif(btrim(e.note), '') is not null
                        then regexp_replace(regexp_replace(left(e.note, 500), v_email, '[email]', 'g'),
                                            v_uuid, '[id]', 'gi') end,
           'question_number', (select qs.display_number from qs where qs.id = e.question_id),
           'confidence', e.confidence,
           'version', e.version)
  from (
    select le.at, le.id as seq, le.who, case when le.known then le.action else 'other' end as action,
           public.history_changes(le.field, le.before, le.after) as changes,
           le.note, le.question_id, null::numeric as confidence,
           case when (le.after ->> 'version') ~ '^[0-9]{1,9}$' then (le.after ->> 'version')::integer end as version,
           le.undone
    from log_ev le
    union all
    select rr.at, rr.id, public.history_actor(rr.actor_user_id, rr.actor, null),
           case when rr.known then rr.action else 'other' end,
           public.history_changes(rr.field, rr.before, rr.after),
           rr.reason, rr.question_id, null::numeric, null::integer,
           false
    from rev_rows rr
    union all
    select cr.at, cr.id,
           public.history_actor(cr.actor_user_id,
             case cr.checker_kind when 'student' then 'checker' else cr.checker_kind end,
             cr.model),
           'check_' || cr.verdict, '[]'::jsonb, cr.notes, cr.question_id, cr.confidence, cr.version_seen,
           (cr.undone_at is not null)
    from check_rows cr
  ) e;
end;
$function$;

-- hod_action_history: one more column, `undone`. A returns-table function
-- cannot gain a column in place, so it is dropped and created again with the
-- same arguments (its one client, src/lib/hod-api.ts, reads columns by name).
drop function if exists public.hod_action_history(uuid, text, integer, timestamptz);

create function public.hod_action_history(
  p_actor uuid default null, p_role text default null, p_limit integer default 200, p_before timestamptz default null
)
returns table(at timestamptz, actor_id uuid, actor_name text, actor_role text, action text, meaning text,
              paper_id uuid, paper_label text, question_id uuid, question_number text, note text, undone boolean)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    with l as (
      select x.*,
             case when exists (select 1 from public.admins ad where ad.id = x.actor_user_id) then 'admin'
                  when exists (select 1 from public.paper_hods h where h.user_id = x.actor_user_id) then 'hod'
                  else 'verifier' end as role
      from public.audit_review_log x
      where x.actor_user_id is not null
        and (p_actor is null or x.actor_user_id = p_actor)
        and (p_before is null or x.at < p_before)
      order by x.at desc
      limit greatest(1, least(coalesce(p_limit, 200), 1000)) * 3
    )
    select l.at, l.actor_user_id, public.history_actor_from_key(l.actor_user_id::text) ->> 'name', l.role,
           l.action, c.meaning, l.paper_id,
           case when ap.id is null then null
                else concat_ws(' ', ap.subject, case when ap.class is not null then 'Class ' || ap.class end, ap.school, ap.year) end,
           l.question_id, q.display_number, l.note,
           (l.undone_at is not null)
    from l
    left join public.log_action_catalog c on c.action = l.action
    left join public.audit_papers ap on ap.id = l.paper_id
    left join public.audit_questions q on q.id = l.question_id
    where p_role is null or l.role = p_role
    order by l.at desc
    limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$function$;

-- ---------------------------------------------------------------- verify

do $$
declare
  f text;
  src text;
begin
  -- 1. the counters read the views; verifier_return_idle still writes the table
  foreach f in array array[
    'public.admin_checker_list()',
    'public.admin_approval_queue()',
    'public.ai_backfill_confidence()',
    'public.admin_paper_progress()',
    'public.hod_escalations()',
    'public.verifier_return_idle()'
  ] loop
    src := pg_get_functiondef(to_regprocedure(f));
    if position('_counted' in src) = 0
       or src ~* '(from|join)\s+(public\.)?(audit_review_log|content_checks)\M' then
      raise exception 'patch did not apply: % still reads a raw table', f;
    end if;
  end loop;
  src := pg_get_functiondef('public.verifier_return_idle()'::regprocedure);
  if src !~* 'insert\s+into\s+public\.audit_review_log\M' then
    raise exception 'patch broke verifier_return_idle: its insert must keep writing audit_review_log';
  end if;

  src := pg_get_functiondef('public.admin_checker_day_log(text, date, date)'::regprocedure);
  if position('not cd.undone' in src) = 0 or position('''undone'', t.undone' in src) = 0 then
    raise exception 'patch did not apply: admin_checker_day_log';
  end if;

  -- 2. one skip rule, no day window
  src := pg_get_functiondef('public.checker_settle_current(uuid)'::regprocedure);
  if position('24 hours' in src) > 0 or position('s.skipped_at >= v_a.assigned_at' in src) = 0
     or position('v_left_skipped' in src) = 0 then
    raise exception 'patch did not apply: checker_settle_current';
  end if;

  -- 3. the publish paths carry the OR link
  foreach f in array array[
    'public.apply_live_copy_paper_to_live(uuid)',
    'public.english_rescue_publish_question(uuid)',
    'public.english_rescue_publish_split_half(uuid)',
    'public.apply_new_ocr_fixes_to_live(uuid)'
  ] loop
    src := pg_get_functiondef(to_regprocedure(f));
    if position('v_q.alternative_label' in src) = 0 then
      raise exception 'patch did not apply: % does not carry alternative_label', f;
    end if;
  end loop;
  src := pg_get_functiondef('public.apply_live_copy_paper_to_live(uuid)'::regprocedure);
  if (length(src) - length(replace(src, 'alternative_group, alternative_label)', ''))) / length('alternative_group, alternative_label)') <> 2 then
    raise exception 'patch did not apply: apply_live_copy_paper_to_live must carry the link in both inserts';
  end if;

  -- 4. an unknown class is eligible for every verifier
  src := pg_get_functiondef('public.distribute_unassigned_papers()'::regprocedure);
  if position('coalesce(public.class_grade(ap.class)' in src) > 0
     or position('(dp.grade is null or dp.grade <= d.grade)' in src) = 0
     or (length(src) - length(replace(src, '(p.grade is null or p.grade <= d.grade)', ''))) / length('(p.grade is null or p.grade <= d.grade)') <> 2 then
    raise exception 'patch did not apply: distribute_unassigned_papers';
  end if;
  if position('coalesce(vp.grade, 12)' in src) = 0 then
    raise exception 'distribute_unassigned_papers lost the rule that a verifier with no grade counts as 12';
  end if;

  -- 5. history readers say whether a row was undone
  src := pg_get_functiondef('public.history_events(uuid, uuid)'::regprocedure);
  if position('''undone'', e.undone' in src) = 0 then
    raise exception 'patch did not apply: history_events';
  end if;
  src := pg_get_functiondef('public.admin_question_full_history(uuid)'::regprocedure);
  if position('''undone'', k.undone_at is not null' in src) = 0 then
    raise exception 'patch did not apply: admin_question_full_history';
  end if;
  if pg_get_function_result('public.hod_action_history(uuid, text, integer, timestamptz)'::regprocedure) not like '%undone boolean%' then
    raise exception 'patch did not apply: hod_action_history';
  end if;

  -- no raw table is read by a counter that should leave out undone rows
  -- (the history pages above deliberately keep reading the real tables)
end $$;

-- ---------------------------------------------------------------- grants

-- CREATE OR REPLACE kept each function's grants; this states them again, and
-- the checks after it fail the migration if anon could execute any of them.
do $$
declare
  f text;
begin
  -- called from the browser by an admin, a verifier or the HOD
  foreach f in array array[
    'public.admin_checker_list()',
    'public.admin_checker_day_log(text, date, date)',
    'public.admin_approval_queue()',
    'public.admin_paper_progress()',
    'public.admin_question_full_history(uuid)',
    'public.hod_escalations()',
    'public.hod_action_history(uuid, text, integer, timestamptz)',
    'public.verifier_return_idle()',
    'public.distribute_unassigned_papers()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  -- internal: the pipeline (service key) and the definer functions only
  foreach f in array array[
    'public.ai_backfill_confidence()',
    'public.checker_settle_current(uuid)',
    'public.apply_live_copy_paper_to_live(uuid)',
    'public.apply_new_ocr_fixes_to_live(uuid)',
    'public.english_rescue_publish_question(uuid)',
    'public.english_rescue_publish_split_half(uuid)',
    'public.history_events(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- hod_action_history was dropped and created again: give service_role back what it had
  grant execute on function public.hod_action_history(uuid, text, integer, timestamptz) to service_role;
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.admin_checker_list()',
    'public.admin_checker_day_log(text, date, date)',
    'public.admin_approval_queue()',
    'public.admin_paper_progress()',
    'public.admin_question_full_history(uuid)',
    'public.hod_escalations()',
    'public.hod_action_history(uuid, text, integer, timestamptz)',
    'public.verifier_return_idle()',
    'public.distribute_unassigned_papers()',
    'public.ai_backfill_confidence()',
    'public.checker_settle_current(uuid)',
    'public.apply_live_copy_paper_to_live(uuid)',
    'public.apply_new_ocr_fixes_to_live(uuid)',
    'public.english_rescue_publish_question(uuid)',
    'public.english_rescue_publish_split_half(uuid)',
    'public.history_events(uuid, uuid)'
  ] loop
    if has_function_privilege('anon', to_regprocedure(f), 'EXECUTE') then
      raise exception 'anon can execute %', f;
    end if;
  end loop;
  foreach f in array array[
    'public.ai_backfill_confidence()',
    'public.checker_settle_current(uuid)',
    'public.apply_live_copy_paper_to_live(uuid)',
    'public.apply_new_ocr_fixes_to_live(uuid)',
    'public.english_rescue_publish_question(uuid)',
    'public.english_rescue_publish_split_half(uuid)',
    'public.history_events(uuid, uuid)'
  ] loop
    if has_function_privilege('authenticated', to_regprocedure(f), 'EXECUTE') then
      raise exception 'authenticated can execute the internal function %', f;
    end if;
  end loop;
end $$;
