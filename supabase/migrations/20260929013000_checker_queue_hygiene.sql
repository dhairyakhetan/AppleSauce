-- Paper checker (Kid Mode): queue hygiene. Measured against the live kid
-- queue on 2026-09-28 (read-only SELECTs, project uvtifolnsneitetzohtn):
-- 840 questions waiting.
--
-- 1. "My subjects" filters never filtered.
--    a) checker_set_preferences() UPDATEs paper_checkers WHERE user_id =
--       auth.uid(). An admin (the owner) is a checker through is_admin() and
--       has NO paper_checkers row (paper_checkers has 0 rows today), so the
--       update touched nothing, the page still showed the pick as saved, and
--       checker_next_question kept serving every subject. The "Which papers?"
--       prompt also reopened on every visit.
--    b) The picker offered the site's facet values ('Maths', '10'); the queue
--       holds audit values ('Mathematics', 'X'). Fixed in the client
--       (src/lib/checker-facets.ts) from checker_queue_facets() below.
--    Fix: preferences live in their own table keyed by user, so they save
--    for admins too, without making an admin a row in the checker allowlist
--    (which would leave them a checker after losing admin). `chosen_at`
--    tells "chose All" (two nulls) apart from "never chose".
--
-- 2. Blank questions reached students. 104 of the 840 had an empty body
--    (96 of them the empty member of an ocr_fused group whose words sit on
--    another row). "Looks right" on one passed an empty question. Now:
--    checker_next_question never serves a blank body, and pass / fix refuse
--    to mark a blank body as passed (errcode 22023). The rows themselves
--    are NOT moved here; see the proposed data SQL at the end.
--
-- 2a. A reload stranded the checker's own leased question for 10 minutes
--    (it was excluded as "locked"). Their own lease is now served first.
--
-- 2b. After a split the first half (same id, back in the queue) still said
--    "Split them", and a second split was refused. It now drops 'ocr_fused'.
--
-- 3. "Today" counted from midnight UTC, which is 05:30 in Kolkata. A
--    student checking at 1 a.m. saw their count from the day before. Both
--    counters now use the Asia/Kolkata day.
--
-- 4. checker_queue_facets(): what is really waiting, by subject and class,
--    for the picker (counts, and no value that cannot match).
--
-- Every function below is the live definition (pg_get_functiondef,
-- 2026-09-28) with only the marked change. Grants follow CLAUDE.md's trap:
-- revoke from public AND anon AND authenticated by role name, then grant
-- execute to authenticated only; each body checks is_paper_checker().

begin;

-- ============================================================
-- 1. Preferences table
-- ============================================================
create table if not exists public.paper_checker_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  subjects text[],
  classes text[],
  chosen_at timestamptz not null default now()
);

comment on table public.paper_checker_prefs is
  'Paper checker subject/class picks (D41). Separate from paper_checkers so an admin (a checker through is_admin(), with no allowlist row) can save picks too. Reached only through checker_get_preferences / checker_set_preferences.';

alter table public.paper_checker_prefs enable row level security;
revoke all on public.paper_checker_prefs from public, anon, authenticated;

-- Carry over any picks already saved on the allowlist (0 rows on 2026-09-28).
insert into public.paper_checker_prefs (user_id, subjects, classes)
select pc.user_id, pc.subjects, pc.classes
from public.paper_checkers pc
where pc.subjects is not null or pc.classes is not null
on conflict (user_id) do nothing;

-- get: adds `chosen`, so the return type changes: DROP first.
drop function if exists public.checker_get_preferences();
create function public.checker_get_preferences()
returns table (subjects text[], classes text[], chosen boolean)
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select p.subjects, p.classes, true
    from public.paper_checker_prefs p
    where p.user_id = auth.uid()
    union all
    select pc.subjects, pc.classes, (pc.subjects is not null or pc.classes is not null)
    from public.paper_checkers pc
    where pc.user_id = auth.uid()
      and not exists (select 1 from public.paper_checker_prefs p2 where p2.user_id = auth.uid())
    limit 1;
end;
$function$;

revoke all on function public.checker_get_preferences() from public, anon, authenticated;
grant execute on function public.checker_get_preferences() to authenticated;

create or replace function public.checker_set_preferences(p_subjects text[], p_classes text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- CHANGED: upsert into paper_checker_prefs (was an UPDATE of
  -- paper_checkers that matched no row for an admin).
  insert into public.paper_checker_prefs (user_id, subjects, classes, chosen_at)
  values (auth.uid(), nullif(p_subjects, array[]::text[]), nullif(p_classes, array[]::text[]), now())
  on conflict (user_id) do update
    set subjects = excluded.subjects, classes = excluded.classes, chosen_at = excluded.chosen_at;
end;
$function$;

revoke all on function public.checker_set_preferences(text[], text[]) from public, anon, authenticated;
grant execute on function public.checker_set_preferences(text[], text[]) to authenticated;

-- ============================================================
-- 2. Next question: new prefs table, and never a blank body
-- ============================================================
create or replace function public.checker_next_question()
returns table (
  id uuid, paper_id uuid, ord int, display_number text, number_path text,
  body text, options jsonb, marks numeric, instructions text,
  flag_reasons text[], flag_detail text, source jsonb,
  subject text, school text, cls text, exam text, year text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_q public.audit_questions;
  v_subjects text[];
  v_classes text[];
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- CHANGED: picks from paper_checker_prefs, falling back to the old
  -- columns on paper_checkers.
  select p.subjects, p.classes into v_subjects, v_classes
  from public.paper_checker_prefs p where p.user_id = v_uid;
  if not found then
    select pc.subjects, pc.classes into v_subjects, v_classes
    from public.paper_checkers pc where pc.user_id = v_uid;
  end if;

  select aq.* into v_q
  from public.audit_questions aq
  join public.audit_papers ap on ap.id = aq.paper_id
  where aq.kind = 'question'
    and aq.review_bucket = 'kid'
    and aq.question_passed = false
    and ap.source in ('live_copy', 'new_ocr')
    -- CHANGED: a blank body has nothing a student can check.
    and btrim(coalesce(aq.body, '')) <> ''
    -- CHANGED: a question this checker already holds is served again (a
    -- reload used to strand it, leased to them, for 10 minutes).
    and (aq.locked_until is null or aq.locked_until < now() or aq.locked_by = v_uid)
    and (v_subjects is null or array_length(v_subjects, 1) is null or ap.subject = any(v_subjects))
    and (v_classes is null or array_length(v_classes, 1) is null or ap.class = any(v_classes))
    and not exists (
      select 1 from public.audit_question_skips s
      where s.question_id = aq.id and s.user_id = v_uid and s.skipped_at > now() - interval '24 hours'
    )
  -- Owner 2026-09-28: English rescue rows the AI doubted go after
  -- everything else. Then D68: live papers first. Then the paper with the
  -- fewest questions still unpassed, so it clears soonest; then newest
  -- year, then paper order.
  order by
    -- CHANGED: the question this checker already holds comes back first.
    case when aq.locked_by = v_uid and aq.locked_until > now() then 0 else 1 end,
    case when aq.source->>'rescue_decision' = 'ai_doubt' then 1 else 0 end,
    case when ap.source = 'live_copy' then 0 else 1 end,
    (select count(*) from public.audit_questions r
      where r.paper_id = aq.paper_id and r.kind = 'question' and not r.question_passed),
    case when ap.year ~ '^\d+$' then ap.year::int else 0 end desc,
    ap.created_at, aq.ord
  limit 1
  for update of aq skip locked;

  if v_q.id is null then
    return;
  end if;

  update public.audit_questions
  set locked_by = v_uid, locked_until = now() + interval '10 minutes'
  where public.audit_questions.id = v_q.id;

  return query
    select aq.id, aq.paper_id, aq.ord, aq.display_number, aq.number_path,
           aq.body, aq.options, aq.marks, aq.instructions,
           aq.flag_reasons, aq.flag_detail, aq.source,
           ap.subject, ap.school, ap.class, ap.exam_type, ap.year
    from public.audit_questions aq
    join public.audit_papers ap on ap.id = aq.paper_id
    where aq.id = v_q.id;
end;
$function$;

revoke all on function public.checker_next_question() from public, anon, authenticated;
grant execute on function public.checker_next_question() to authenticated;

-- ============================================================
-- 3. Pass / fix never mark a blank body as right
-- ============================================================
create or replace function public.checker_pass_question(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_before public.audit_questions;
begin
  v_before := public.checker_authorize_question(p_question_id);

  -- CHANGED: an empty question cannot "look right".
  if btrim(coalesce(v_before.body, '')) = '' then
    raise exception 'This question has no words; it cannot be passed' using errcode = '22023';
  end if;

  update public.audit_questions
  set status = 'passed', question_passed = true, checked_by_user = auth.uid(),
      locked_by = null, locked_until = null
  where id = p_question_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after)
  values (null, auth.uid(), v_before.paper_id, p_question_id, 'checker_pass', null,
          jsonb_build_object('status', v_before.status, 'question_passed', v_before.question_passed),
          jsonb_build_object('status', 'passed', 'question_passed', true));
end;
$function$;

revoke all on function public.checker_pass_question(uuid) from public, anon, authenticated;
grant execute on function public.checker_pass_question(uuid) to authenticated;

create or replace function public.checker_fix_question(
  p_question_id uuid, p_body text, p_display_number text, p_marks numeric
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_before public.audit_questions;
begin
  v_before := public.checker_authorize_question(p_question_id);

  -- CHANGED: the body after this fix must have words. (A null p_body keeps
  -- the stored body byte for byte; the client now sends null when the words
  -- were not edited, so a marks-only fix cannot rewrite the text.)
  if btrim(coalesce(p_body, v_before.body, '')) = '' then
    raise exception 'This question has no words; it cannot be passed' using errcode = '22023';
  end if;

  update public.audit_questions
  set body = coalesce(p_body, body),
      display_number = coalesce(p_display_number, display_number),
      marks = coalesce(p_marks, marks),
      status = 'passed', question_passed = true, checked_by_user = auth.uid(),
      locked_by = null, locked_until = null
  where id = p_question_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after)
  values (null, auth.uid(), v_before.paper_id, p_question_id, 'checker_fix', null,
          jsonb_build_object('body', v_before.body, 'display_number', v_before.display_number, 'marks', v_before.marks),
          jsonb_build_object('body', p_body, 'display_number', p_display_number, 'marks', p_marks));
end;
$function$;

revoke all on function public.checker_fix_question(uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.checker_fix_question(uuid, text, text, numeric) to authenticated;

-- ============================================================
-- 3b. Split: the first half stops asking to be split
-- ============================================================
-- The first half keeps its id and goes back into the queue (neither half is
-- auto-passed). It kept 'ocr_fused', so the next checker was told "Split
-- them" again, and a second split was refused by the duplicate-split guard
-- until the first one reached live. The checker cut right before the second
-- question starts, so the first half is one question: drop 'ocr_fused' from
-- it. If more questions were fused, they are in the SECOND half, which the
-- client lets a checker split again (it carries 'split_from_<id>' and has no
-- pending split of its own). Everything else is the live definition.
create or replace function public.checker_split_question(
  p_question_id uuid, p_body_before text, p_split_at int
)
returns table (first_id uuid, second_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_q public.audit_questions;
  v_first text;
  v_second text;
  v_new_id uuid;
begin
  v_q := public.checker_authorize_question(p_question_id);

  perform pg_advisory_xact_lock(hashtext(v_q.paper_id::text));

  if p_body_before is distinct from v_q.body then
    raise exception 'stale question text, reload and retry' using errcode = '40001';
  end if;

  if exists (
    select 1 from public.audit_questions
    where split_from_id = p_question_id and live_bank_question_id is null
  ) then
    raise exception 'This question already has an unapplied split pending; resolve it before splitting again' using errcode = '40001';
  end if;

  -- length() counts characters (code points); the client converts its
  -- UTF-16 caret to the same unit (src/lib/checker-body.ts codePointOffset).
  if p_split_at is null or p_split_at <= 0 or p_split_at >= length(p_body_before) then
    raise exception 'Split point out of range';
  end if;

  v_first := left(p_body_before, p_split_at);
  v_second := substring(p_body_before from p_split_at + 1);

  -- CHANGED: a cut on whitespace must not leave a blank half. The queue no
  -- longer serves blank bodies, so a blank half would sit in 'kid' unseen.
  if btrim(v_first) = '' or btrim(v_second) = '' then
    raise exception 'Both parts of a split need some words in them' using errcode = '22023';
  end if;

  update public.audit_questions
  set ord = ord + 1
  where paper_id = v_q.paper_id and ord > v_q.ord;

  update public.audit_questions
  set body = v_first, status = 'flagged', question_passed = false,
      -- CHANGED: the first half is one question now.
      flag_reasons = array_remove(coalesce(flag_reasons, array[]::text[]), 'ocr_fused'),
      checked_by_user = auth.uid(), locked_by = null, locked_until = null
  where id = p_question_id;

  insert into public.audit_questions (
    paper_id, ord, kind, parent_id, section_label, number_path, display_number,
    body, status, question_passed, review_bucket, flag_reasons, split_from_id
  )
  values (
    v_q.paper_id, v_q.ord + 1, 'question', v_q.parent_id, v_q.section_label, null, null,
    v_second, 'flagged', false, 'kid', array['split_from_' || v_q.id::text], p_question_id
  )
  returning id into v_new_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after)
  values (null, auth.uid(), v_q.paper_id, p_question_id, 'checker_split', 'body',
          to_jsonb(p_body_before),
          jsonb_build_object('first_id', p_question_id, 'second_id', v_new_id, 'split_at', p_split_at));

  return query select p_question_id, v_new_id;
end;
$function$;

revoke all on function public.checker_split_question(uuid, text, int) from public, anon, authenticated;
grant execute on function public.checker_split_question(uuid, text, int) to authenticated;

-- ============================================================
-- 4. Counters: the Kolkata day, not the UTC day
-- ============================================================
create or replace function public.checker_checked_today_count()
returns integer
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
declare
  v_count int;
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select count(*)::int into v_count
  from public.audit_review_log
  -- CHANGED: midnight in Kolkata, not midnight UTC (05:30 IST).
  where at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
    and action in ('checker_pass', 'checker_fix', 'checker_split', 'checker_ask_help')
    and actor_user_id = auth.uid();

  return v_count;
end;
$function$;

revoke all on function public.checker_checked_today_count() from public, anon, authenticated;
grant execute on function public.checker_checked_today_count() to authenticated;

create or replace function public.checker_my_stats()
returns table (today_count bigint, total_count bigint)
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select
      -- CHANGED: midnight in Kolkata, not midnight UTC.
      count(*) filter (
        where at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
      ) as today_count,
      count(*) as total_count
    from public.audit_review_log
    where actor_user_id = auth.uid()
      and action in ('checker_pass', 'checker_fix', 'checker_split', 'checker_ask_help');
end;
$function$;

revoke all on function public.checker_my_stats() from public, anon, authenticated;
grant execute on function public.checker_my_stats() to authenticated;

-- ============================================================
-- 5. What is waiting, by subject and class (for the picker)
-- ============================================================
create or replace function public.checker_queue_facets()
returns table (subject text, cls text, waiting bigint)
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- Same eligibility as checker_next_question, minus leases and this
  -- checker's skips (those change minute to minute; this is a menu).
  return query
    select ap.subject, ap.class, count(*)
    from public.audit_questions aq
    join public.audit_papers ap on ap.id = aq.paper_id
    where aq.kind = 'question'
      and aq.review_bucket = 'kid'
      and aq.question_passed = false
      and ap.source in ('live_copy', 'new_ocr')
      and btrim(coalesce(aq.body, '')) <> ''
    group by ap.subject, ap.class;
end;
$function$;

revoke all on function public.checker_queue_facets() from public, anon, authenticated;
grant execute on function public.checker_queue_facets() to authenticated;

commit;

-- Verify after applying (CLAUDE.md: audit with has_function_privilege):
--   select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') authd
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname in ('checker_get_preferences',
--     'checker_set_preferences', 'checker_next_question', 'checker_pass_question',
--     'checker_fix_question', 'checker_checked_today_count', 'checker_my_stats',
--     'checker_queue_facets');
--   -- expect anon = false and authd = true on every row
--   select has_table_privilege('authenticated', 'public.paper_checker_prefs', 'SELECT'); -- false
--
-- ---------------------------------------------------------------------------
-- PROPOSED DATA CHANGES. Not part of this migration: data, audit_* only,
-- to be run by hand by the owner after reading the dry-run counts. Nothing
-- here touches bank_* or any body text.
--
-- A. Blank kid rows -> admin (dry run 2026-09-28: 104 rows, all new_ocr,
--    96 of them ocr_fused). After this migration they are no longer served,
--    but they still sit in the kid bucket and in its counts.
--
--   -- dry run
--   select count(*) from public.audit_questions aq
--   join public.audit_papers ap on ap.id = aq.paper_id
--   where aq.kind = 'question' and aq.review_bucket = 'kid'
--     and aq.question_passed = false and ap.source in ('live_copy', 'new_ocr')
--     and btrim(coalesce(aq.body, '')) = '';
--
--   update public.audit_questions aq
--   set review_bucket = 'admin'
--   from public.audit_papers ap
--   where ap.id = aq.paper_id
--     and aq.kind = 'question' and aq.review_bucket = 'kid'
--     and aq.question_passed = false and ap.source in ('live_copy', 'new_ocr')
--     and btrim(coalesce(aq.body, '')) = '';
--
-- B. English model answers served as questions -> admin (dry run
--    2026-09-28: 6 rows, display numbers '2(i)-Format 1..3' and
--    '3(ii)-Format 1..3', bodies are sample letters / notices, i.e. answer
--    key content, not questions a checker can judge).
--
--   select count(*) from public.audit_questions
--   where review_bucket = 'kid' and question_passed = false
--     and display_number ~ '-Format [0-9]+$';
--
--   update public.audit_questions
--   set review_bucket = 'admin'
--   where review_bucket = 'kid' and question_passed = false
--     and display_number ~ '-Format [0-9]+$';
