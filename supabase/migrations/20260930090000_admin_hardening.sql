-- NOT APPLIED. Written 2026-09-30 for review, a rollback probe and then apply.
-- Probe: supabase/probes/20260930_admin_hardening_probe.sql (BEGIN ... ROLLBACK).
--
-- ADMIN HARDENING. Every function body below was fetched from the LIVE
-- database with pg_get_functiondef on 2026-09-30 and changed as little as
-- possible. Signatures, SECURITY DEFINER and search_path = public are kept;
-- the live ACL of all of them is {postgres, service_role, authenticated}
-- (nothing to anon, nothing to PUBLIC) and is re-asserted at the end.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1. LOG LINES. admin_english_rescue_publish_paper and
--    admin_reapply_paper_to_live used to leave no trace of WHO pressed the
--    button (the inner functions log the checker who passed each question,
--    never the admin). Each now writes
--      * one paper-level audit_review_log row (question_id null,
--        actor_user_id = auth.uid()), action
--        'admin_english_rescue_publish' / 'admin_reapply_paper_to_live', and
--      * when live rows actually changed, one bank_question_revisions summary
--        row (table bank_papers, action 'live_apply', source 'admin',
--        actor_user_id = auth.uid()). bank_question_revisions.action has a
--        CHECK constraint that this migration deliberately does NOT widen, so
--        the summary uses the existing 'live_apply' and the audit log action
--        name is what tells the two apart. admin_undo_revision refuses a
--        field-less live_apply ("cannot be auto-undone"), which is right.
-- 2. SERVER-SIDE VALIDATION in admin_edit_bank_question,
--    admin_edit_bank_paper, admin_add_bank_question and
--    admin_set_bank_question_figure. Validation only ever REJECTS (errcode
--    22023, a plain sentence). It never trims, re-cases or otherwise alters
--    what is stored: the question text standing constraint holds.
--      body            not null, not blank
--      marks           null or 0..100 (paper marks: 0..1000, live max is 426)
--      qtype           null, or one of the values that exist live today plus
--                      the pipeline enum names
--      page            null or a whole number 1..9999
--      time fields     whole minutes 1..600 (paper), numeric 0..600 (question)
--      figure          null or a plain file name (letters, digits . _ / -),
--                      no '..', at most 300 characters; all 1,983 live
--                      values already conform
--      numbers         at most 40 characters
--      ord clash       a friendly 22023 instead of a raw 23505
--    A null p_field used to slip past the allow-list (null = ANY is null);
--    it is now rejected.
--    FOUND IN REHEARSAL: the live admin_edit_bank_question / _paper passed
--    every value as text, so marks, page, time and true/false edits failed
--    with 42804 (0 such edits ever logged). The value is now cast to the
--    column's own type (format_type from pg_attribute).
-- 3. DIRECT TABLE WRITES CLOSED. authenticated held INSERT/UPDATE/DELETE on
--    bank_papers and the "admins write papers" / "admins write questions"
--    ALL policies let any admin session rewrite live rows around every log
--    line above. Nothing in src/, scripts/ or api/ writes either table from a
--    client (grep, 2026-09-30); scripts/import-bank.ts uses the service role,
--    which is unaffected. INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and
--    TRIGGER are revoked from anon, authenticated and PUBLIC, column-level
--    grants included, and both ALL policies are dropped.
--    ONE DEVIATION, on purpose: the ALL policy on bank_papers was also the
--    only thing letting an admin session SELECT hidden papers (the public
--    policy is is_published only). Dropping it silently would blind admins,
--    so a SELECT-only "admins read all papers" policy replaces it. Every
--    other SELECT policy is untouched, bank_questions stays SELECT-revoked
--    and public read of published papers is unchanged. The migration ends
--    with a self-check that raises (and so rolls back) if any write
--    privilege survives.
-- 4. checker_leaderboard, checker_queue_facets and checker_question_context
--    were READ (pg_get_functiondef, 2026-09-30) and need no change: the first
--    two begin with is_paper_checker() (checker or admin) and the third with
--    checker_authorize_question(). None returns data to a signed-in user who
--    is neither. Not touched here.
-- 5. admin_question_history now also returns paper-level audit_review_log
--    rows (question_id null, same paper) marked scope = 'paper', and the
--    paper-level admin summary rows above. The bank_question_revisions join
--    by row_id = the live question id was ALREADY in the live function; the
--    audit's claim that it was missing was stale. The return type gains two
--    columns (scope, event_kind), which needs DROP + CREATE; the old client
--    keeps working because it ignores unknown fields.
-- 6. LOG TIDINESS. public.log_action_catalog(action pk, kind, meaning): a
--    lookup that labels every action with ai / checker / admin / pipeline /
--    system, seeded from every action value that exists live in
--    audit_review_log and bank_question_revisions plus the ones added here.
--    There is deliberately NO CHECK constraint on audit_review_log.action:
--    the laptop pipeline writes new names and must never fail on a log line.
--    An action missing from the catalog just falls back to the actor's kind.
--    RLS on, every privilege revoked from public, anon and authenticated;
--    only SECURITY DEFINER functions read it.
--
-- ACTOR NAMING SCHEME (also in docs/GUARDRAILS.md)
--    human           actor_user_id = auth.users id; the name comes from
--                    profiles / auth.users, never from the free-text actor
--    ai:<name>       automated model or pipeline step, e.g. ai:empty-paper-hide
--    system:<name>   database-side automation, e.g. system:chokepoint,
--                    system:english_rescue
--    A row with actor_user_id null and no ai:/system: prefix is a legacy
--    row and shows as "system" or "rule".
--
-- ROLLBACK (nothing here touches data, so rollback is only shape)
--    * Functions: re-run the CREATE OR REPLACE from the migrations that
--      defined them: 20260928170000_admin_paper_edit.sql (admin_edit_bank_*,
--      admin_add_bank_question, admin_set_bank_question_figure, after the
--      20260928200000 ord fix), 20260928190000_english_rescue_publish.sql
--      (admin_english_rescue_publish_paper) and 20260928000000 /
--      20260929120000 (admin_reapply_paper_to_live, admin_question_history;
--      drop the function first because its return type changed).
--      Re-issue: revoke all on function ... from public, anon;
--                grant execute on function ... to authenticated;
--    * Writes:  grant insert, update, delete on public.bank_papers to authenticated;
--               grant insert, update, delete on public.bank_questions to authenticated;  -- only if ever wanted
--               drop policy "admins read all papers" on public.bank_papers;
--               create policy "admins write papers" on public.bank_papers
--                 for all to authenticated using (public.is_admin()) with check (public.is_admin());
--               create policy "admins write questions" on public.bank_questions
--                 for all to authenticated using (public.is_admin()) with check (public.is_admin());
--    * Catalog: drop table public.log_action_catalog;  (after restoring the
--      old admin_question_history, which does not read it)

-- Fail fast rather than queue behind a long admin or pipeline transaction on
-- the live tables (every later request would queue behind this one).
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 6. log_action_catalog

create table if not exists public.log_action_catalog (
  action  text primary key,
  kind    text not null check (kind in ('ai', 'checker', 'admin', 'pipeline', 'system')),
  meaning text not null
);

alter table public.log_action_catalog enable row level security;
revoke all on table public.log_action_catalog from public;
revoke all on table public.log_action_catalog from anon;
revoke all on table public.log_action_catalog from authenticated;

insert into public.log_action_catalog (action, kind, meaning) values
  -- audit_review_log, as found live 2026-09-30
  ('created',                       'ai',       'Question row created by the pipeline'),
  ('ai_flagged',                    'ai',       'The computer flagged the question for review'),
  ('ai_verdict',                    'ai',       'The computer check produced or changed a verdict'),
  ('ai_pass',                       'ai',       'The computer passed the question'),
  ('ai_escalate',                   'ai',       'The computer sent the question to an admin'),
  ('checker_pass',                  'checker',  'A checker marked the question as right'),
  ('checker_fix',                   'checker',  'A checker fixed the question'),
  ('checker_skip',                  'checker',  'A checker skipped the question'),
  ('checker_split',                 'checker',  'A checker split the question in two'),
  ('checker_ask_help',              'checker',  'A checker asked for help'),
  ('auto_fix',                      'pipeline', 'Automatic reading fix by the pipeline'),
  ('flag_fix',                      'pipeline', 'Flag raised or cleared by a pipeline fix'),
  ('reclassify',                    'pipeline', 'Question moved between review piles'),
  ('discard_mark',                  'pipeline', 'A stray mark was discarded'),
  ('correct_pdf_match',             'pipeline', 'Source PDF matched to the paper by content'),
  ('gap_flag',                      'pipeline', 'Gap audit flagged a possible missing question'),
  ('gap_audit_pass',                'pipeline', 'Gap audit found nothing missing'),
  ('gap_audit_renderer_note',       'pipeline', 'Gap audit note about how the paper renders'),
  ('live_match_loop_resolve',       'pipeline', 'Live paper match loop resolved'),
  ('search_no_match_broad_resolve', 'pipeline', 'Broad search resolved a paper with no direct match'),
  ('match_v2_conflict',             'pipeline', 'Second matcher disagreed with the first'),
  ('load',                          'pipeline', 'Paper loaded into the audit tables'),
  ('marks_from_picture',            'pipeline', 'Marks read from the picture of the question'),
  ('picture_check_hide',            'pipeline', 'Paper hidden after the picture check'),
  ('revert_header',                 'pipeline', 'Paper header change reverted'),
  ('restore',                       'pipeline', 'Audit row restored'),
  ('admin_resolve_escalation',      'admin',    'An admin accepted an escalated question'),
  -- bank_question_revisions (also written to audit_review_log for skips)
  ('admin_edit',                    'admin',    'An admin edited a live field'),
  ('admin_hide',                    'admin',    'An admin hid a paper'),
  ('admin_restore',                 'admin',    'An admin restored a hidden paper'),
  ('admin_undo',                    'admin',    'An admin undid an earlier revision'),
  ('admin_add',                     'admin',    'An admin added a question'),
  ('admin_delete',                  'admin',    'An admin deleted a question'),
  ('admin_merge',                   'admin',    'An admin merged two questions'),
  ('admin_split',                   'admin',    'An admin split a question'),
  ('admin_reorder',                 'admin',    'An admin reordered questions'),
  ('live_apply',                    'system',   'The draft was copied onto the live paper'),
  ('live_clear',                    'system',   'The paper was marked complete (needs_review cleared)'),
  ('auto_return',                   'system',   'A paper hidden only for being empty came back'),
  -- added by this migration
  ('admin_english_rescue_publish',  'admin',    'An admin published the hidden English questions of a paper'),
  ('admin_reapply_paper_to_live',   'admin',    'An admin re-applied a paper''s draft onto the live paper')
on conflict (action) do nothing;

-- ---------------------------------------------------------------------------
-- 2. admin_edit_bank_question

create or replace function public.admin_edit_bank_question(p_question_id text, p_field text, p_value text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_before jsonb;
  v_after jsonb;
  v_num numeric;
  v_type text;
  v_allowed text[] := array[
    'number', 'body', 'marks', 'chapter', 'qtype', 'page', 'figure',
    'display_number', 'instructions', 'suggested_time_minutes',
    'chapter_from_paper', 'answer_key', 'alternative_group',
    'alternative_label', 'section_label', 'syllabus_ref'
  ];
  -- Values live on 2026-09-30 (distinct bank_questions.qtype) plus the
  -- pipeline enum names (src/lib/qtype-label.ts).
  v_qtypes text[] := array[
    'composition', 'context:dialogue', 'context:image', 'context:map', 'context:passage',
    'context:picture', 'context:poem_extract', 'context:prose_extract', 'context:quote',
    'context:table', 'context:thematic', 'Definition', 'Fill in the Blank', 'Identify',
    'long', 'Long Answer', 'long_answer', 'mcq', 'MCQ', 'short', 'Short Answer',
    'short_answer', 'sub', 'True/False',
    'fill_in_blank', 'true_false', 'definition', 'identify',
    'context_thematic', 'context_image', 'context_quote', 'context_map', 'other'
  ];
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not coalesce(p_field = any(v_allowed), false) then
    raise exception 'Field % is not editable through this function', p_field using errcode = '22023';
  end if;

  -- Validation only rejects. The value that passes is stored exactly as sent.
  if p_field = 'body' then
    if p_value is null or p_value ~ '^\s*$' then
      raise exception 'Question text cannot be blank' using errcode = '22023';
    end if;
  elsif p_field = 'marks' then
    if p_value is not null then
      begin
        v_num := p_value::numeric;
      exception when others then
        raise exception 'Marks must be a number, like 4 or 0.5' using errcode = '22023';
      end;
      if not (v_num >= 0 and v_num <= 100) then
        raise exception 'Marks must be between 0 and 100' using errcode = '22023';
      end if;
    end if;
  elsif p_field = 'qtype' then
    if p_value is not null and not (p_value = any(v_qtypes)) then
      raise exception 'Question type % is not one of the known types', p_value using errcode = '22023';
    end if;
  elsif p_field = 'page' then
    -- CASE, not OR: the cast must never run on text that is not digits.
    -- Parenthesised: PL/pgSQL reads an IF condition up to its first THEN.
    if p_value is not null and (case
         when p_value !~ '^[0-9]+$' or length(p_value) > 4 then true
         else p_value::int < 1
       end) then
      raise exception 'Page must be a whole number from 1 to 9999' using errcode = '22023';
    end if;
  elsif p_field = 'suggested_time_minutes' then
    if p_value is not null then
      begin
        v_num := p_value::numeric;
      exception when others then
        raise exception 'Suggested time must be a number of minutes' using errcode = '22023';
      end;
      if not (v_num >= 0 and v_num <= 600) then
        raise exception 'Suggested time must be between 0 and 600 minutes' using errcode = '22023';
      end if;
    end if;
  elsif p_field = 'chapter_from_paper' then
    if p_value is not null and p_value not in ('true', 'false') then
      raise exception 'Chapter from paper must be true or false' using errcode = '22023';
    end if;
  elsif p_field = 'figure' then
    if p_value is not null and (p_value !~ '^[A-Za-z0-9][A-Za-z0-9._/-]+$' or p_value like '%..%' or length(p_value) > 300) then
      raise exception 'Figure must be a plain file name' using errcode = '22023';
    end if;
  elsif p_field in ('number', 'display_number') then
    if p_value is not null and length(p_value) > 40 then
      raise exception 'A question number can be at most 40 characters' using errcode = '22023';
    end if;
  end if;

  select to_jsonb(bq.*) into v_before from public.bank_questions bq where bq.id = p_question_id;
  if v_before is null then
    raise exception 'Question not found';
  end if;

  -- The value travels as text; cast it to the column's own type. The live
  -- function passed text into numeric and boolean columns and failed with
  -- 42804 on every marks, page, time and switch edit (0 ever logged).
  -- A text column casts text to text: the stored value stays byte-exact.
  select format_type(a.atttypid, a.atttypmod) into v_type
  from pg_attribute a
  where a.attrelid = 'public.bank_questions'::regclass and a.attname = p_field
    and a.attnum > 0 and not a.attisdropped;
  if v_type is null then
    raise exception 'Field % does not exist', p_field using errcode = '22023';
  end if;

  execute format('update public.bank_questions set %I = $1::%s where id = $2', p_field, v_type)
    using case
      when p_field in ('marks', 'suggested_time_minutes', 'page') then p_value::numeric::text
      when p_field = 'chapter_from_paper' then p_value::boolean::text
      else p_value
    end, p_question_id;

  v_after := case
    when p_field in ('marks', 'suggested_time_minutes', 'page') then to_jsonb(p_value::numeric)
    when p_field = 'chapter_from_paper' then to_jsonb(p_value::boolean)
    else to_jsonb(p_value)
  end;

  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source)
  values ('bank_questions', p_question_id, 'admin_edit', p_field, v_before->p_field, v_after, auth.uid()::text, auth.uid(), 'admin');
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. admin_edit_bank_paper

create or replace function public.admin_edit_bank_paper(p_paper_id text, p_field text, p_value text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_before jsonb;
  v_after jsonb;
  v_num numeric;
  v_type text;
  v_allowed text[] := array[
    'school', 'year', 'exam', 'cls', 'subject', 'board',
    'marks', 'is_published', 'needs_review', 'allowed_time_minutes',
    'general_instructions', 'incomplete_note'
  ];
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not coalesce(p_field = any(v_allowed), false) then
    raise exception 'Field % is not editable through this function', p_field using errcode = '22023';
  end if;

  if p_field in ('school', 'cls', 'subject') then
    if p_value is null or p_value ~ '^\s*$' then
      raise exception 'This cannot be blank' using errcode = '22023';
    end if;
  elsif p_field = 'marks' then
    if p_value is not null then
      begin
        v_num := p_value::numeric;
      exception when others then
        raise exception 'Marks must be a number' using errcode = '22023';
      end;
      if not (v_num >= 0 and v_num <= 1000) then
        raise exception 'Paper marks must be between 0 and 1000' using errcode = '22023';
      end if;
    end if;
  elsif p_field = 'allowed_time_minutes' then
    if p_value is not null and (case
         when p_value !~ '^[0-9]+$' or length(p_value) > 3 then true
         else p_value::int < 1 or p_value::int > 600
       end) then
      raise exception 'Time allowed must be a whole number of minutes from 1 to 600' using errcode = '22023';
    end if;
  elsif p_field in ('is_published', 'needs_review') then
    if p_value is null or p_value not in ('true', 'false') then
      raise exception '% must be true or false', p_field using errcode = '22023';
    end if;
  elsif p_field in ('year', 'exam', 'board') then
    if p_value is not null and length(p_value) > 200 then
      raise exception '% is too long', p_field using errcode = '22023';
    end if;
  end if;

  select to_jsonb(bp.*) into v_before from public.bank_papers bp where bp.id = p_paper_id;
  if v_before is null then
    raise exception 'Paper not found';
  end if;

  -- The value travels as text; cast it to the column's own type. The live
  -- function passed text into numeric and boolean columns and failed with
  -- 42804 on every marks, page, time and switch edit (0 ever logged).
  -- A text column casts text to text: the stored value stays byte-exact.
  select format_type(a.atttypid, a.atttypmod) into v_type
  from pg_attribute a
  where a.attrelid = 'public.bank_papers'::regclass and a.attname = p_field
    and a.attnum > 0 and not a.attisdropped;
  if v_type is null then
    raise exception 'Field % does not exist', p_field using errcode = '22023';
  end if;

  execute format('update public.bank_papers set %I = $1::%s where id = $2', p_field, v_type)
    using case
      when p_field in ('marks', 'allowed_time_minutes') then p_value::numeric::text
      when p_field in ('is_published', 'needs_review') then p_value::boolean::text
      else p_value
    end, p_paper_id;

  v_after := case
    when p_field in ('marks', 'allowed_time_minutes') then to_jsonb(p_value::numeric)
    when p_field in ('is_published', 'needs_review') then to_jsonb(p_value::boolean)
    else to_jsonb(p_value)
  end;

  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source)
  values ('bank_papers', p_paper_id, 'admin_edit', p_field, v_before->p_field, v_after, auth.uid()::text, auth.uid(), 'admin');
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. admin_add_bank_question

create or replace function public.admin_add_bank_question(p_paper_id text, p_after_ord integer, p_body text, p_marks numeric, p_display_number text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_new_id text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if p_body is null or p_body ~ '^\s*$' then
    raise exception 'Question text cannot be blank' using errcode = '22023';
  end if;
  if p_marks is not null and not (p_marks >= 0 and p_marks <= 100) then
    raise exception 'Marks must be between 0 and 100' using errcode = '22023';
  end if;
  if p_after_ord is null or p_after_ord < -1 then
    raise exception 'Position is not valid' using errcode = '22023';
  end if;
  if p_display_number is not null and length(p_display_number) > 40 then
    raise exception 'A question number can be at most 40 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.bank_papers where id = p_paper_id) then
    raise exception 'Paper not found' using errcode = '22023';
  end if;

  -- Second review, MEDIUM #3: paper-scoped advisory lock.
  perform pg_advisory_xact_lock(hashtext(p_paper_id));

  v_new_id := p_paper_id || '-add-' || replace(gen_random_uuid()::text, '-', '');
  begin
    -- Two-step shift (20260928200000): see the header of that migration.
    update public.bank_questions set ord = -(ord + 1) where paper_id = p_paper_id and ord > p_after_ord;
    update public.bank_questions set ord = -ord where paper_id = p_paper_id and ord < 0;
    insert into public.bank_questions (id, paper_id, ord, body, marks, display_number)
    values (v_new_id, p_paper_id, p_after_ord + 1, p_body, p_marks, p_display_number);
  exception when unique_violation then
    raise exception 'Another question already sits at that position. Reload the paper and try again.' using errcode = '22023';
  end;

  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source)
  values ('bank_questions', v_new_id, 'admin_add', null, null,
          jsonb_build_object('paper_id', p_paper_id, 'body', p_body, 'marks', p_marks), auth.uid()::text, auth.uid(), 'admin');

  return v_new_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. admin_set_bank_question_figure

create or replace function public.admin_set_bank_question_figure(p_question_id text, p_figure_path text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_before public.bank_questions;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_figure_path is not null
     and (p_figure_path !~ '^[A-Za-z0-9][A-Za-z0-9._/-]+$' or p_figure_path like '%..%' or length(p_figure_path) > 300) then
    raise exception 'Figure must be a plain file name' using errcode = '22023';
  end if;
  select * into v_before from public.bank_questions where id = p_question_id;
  if v_before.id is null then
    raise exception 'Question not found';
  end if;

  update public.bank_questions set figure = p_figure_path where id = p_question_id;

  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source)
  values ('bank_questions', p_question_id, 'admin_edit', 'figure', to_jsonb(v_before.figure), to_jsonb(p_figure_path), auth.uid()::text, auth.uid(), 'admin');
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2b. admin_undo_revision: live body, one change. Its field undo passed the
-- old value as text into numeric/boolean columns (42804, found in rehearsal),
-- so no marks, page, time or switch edit could ever be undone. The restore
-- now casts to the column's own type, exactly like the edit functions.

create or replace function public.admin_undo_revision(p_revision_id bigint, p_force boolean DEFAULT false)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_rev public.bank_question_revisions;
  v_current_text text;
  v_current_exists boolean;
  v_current_published boolean;
  v_type text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_rev from public.bank_question_revisions where id = p_revision_id;
  if v_rev.id is null then
    raise exception 'Revision not found';
  end if;

  if v_rev.action = 'admin_edit' and v_rev.field is not null then
    if v_rev.table_name = 'bank_papers' then
      execute format('select %I::text from public.bank_papers where id = $1', v_rev.field)
        into v_current_text using v_rev.row_id;
    else
      execute format('select %I::text from public.bank_questions where id = $1', v_rev.field)
        into v_current_text using v_rev.row_id;
    end if;
    if not p_force and v_current_text is distinct from (v_rev.after #>> '{}') then
      raise exception 'This field has changed since that revision -- pass p_force to undo anyway' using errcode = '40001';
    end if;

    select format_type(a.atttypid, a.atttypmod) into v_type
    from pg_attribute a
    where a.attrelid = ('public.' || v_rev.table_name)::regclass and a.attname = v_rev.field
      and a.attnum > 0 and not a.attisdropped;
    if v_type is null then
      raise exception 'Field % does not exist', v_rev.field using errcode = '22023';
    end if;

    if v_rev.table_name = 'bank_papers' then
      execute format('update public.bank_papers set %I = $1::%s where id = $2', v_rev.field, v_type)
        using (v_rev.before #>> '{}'), v_rev.row_id;
    else
      execute format('update public.bank_questions set %I = $1::%s where id = $2', v_rev.field, v_type)
        using (v_rev.before #>> '{}'), v_rev.row_id;
    end if;
  elsif v_rev.action = 'admin_delete' and v_rev.table_name = 'bank_questions' then
    select exists(select 1 from public.bank_questions where id = v_rev.row_id) into v_current_exists;
    if v_current_exists and not p_force then
      raise exception 'A question with this id already exists -- pass p_force to overwrite' using errcode = '40001';
    end if;
    if v_current_exists then
      delete from public.bank_questions where id = v_rev.row_id;
    end if;
    insert into public.bank_questions
      select * from jsonb_populate_record(null::public.bank_questions, v_rev.before);
  elsif v_rev.action in ('admin_hide', 'admin_restore') and v_rev.table_name = 'bank_papers' then
    select is_published into v_current_published from public.bank_papers where id = v_rev.row_id;
    if not p_force and v_current_published is distinct from (v_rev.after #>> '{}')::boolean then
      raise exception 'This paper''s published state has changed since that revision -- pass p_force to undo anyway' using errcode = '40001';
    end if;
    update public.bank_papers set is_published = (v_rev.before #>> '{}')::boolean where id = v_rev.row_id;
  else
    raise exception 'This revision type cannot be auto-undone; edit the paper directly instead.';
  end if;

  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source, reason)
  values (v_rev.table_name, v_rev.row_id, 'admin_undo', v_rev.field, v_rev.after, v_rev.before, auth.uid()::text, auth.uid(), 'admin',
          'undo of revision ' || p_revision_id::text);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 1. admin_english_rescue_publish_paper

create or replace function public.admin_english_rescue_publish_paper(p_audit_paper_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_paper public.audit_papers;
  v_mark bigint;
  v_n integer;
  v_changes integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_paper from public.audit_papers where id = p_audit_paper_id;
  if v_paper.id is null then
    raise exception 'Paper not found' using errcode = '22023';
  end if;

  select coalesce(max(id), 0) into v_mark from public.bank_question_revisions;

  v_n := public.english_rescue_publish_paper(p_audit_paper_id);

  select count(*) into v_changes
  from public.bank_question_revisions r
  where r.id > v_mark and r.audit_paper_id = p_audit_paper_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note, after)
  values (null, auth.uid(), p_audit_paper_id, null, 'admin_english_rescue_publish',
          'Admin published ' || v_n::text || ' hidden English question(s); ' || v_changes::text || ' live change(s) written',
          jsonb_build_object('published', v_n, 'live_changes', v_changes, 'live_paper_id', v_paper.live_bank_paper_id));

  if v_changes > 0 and v_paper.live_bank_paper_id is not null then
    insert into public.bank_question_revisions
      (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, reason)
    values ('bank_papers', v_paper.live_bank_paper_id, 'live_apply', null, null,
            jsonb_build_object('published', v_n, 'live_changes', v_changes),
            auth.uid()::text, auth.uid(), 'admin', p_audit_paper_id,
            'admin english rescue: ' || v_n::text || ' question(s) published');
  end if;

  return v_n;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 1. admin_reapply_paper_to_live

create or replace function public.admin_reapply_paper_to_live(p_audit_paper_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_paper public.audit_papers;
  v_mark bigint;
  v_changes integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_paper from public.audit_papers where id = p_audit_paper_id;
  if v_paper.id is null then
    raise exception 'Paper not found' using errcode = '22023';
  end if;

  select coalesce(max(id), 0) into v_mark from public.bank_question_revisions;

  perform public.apply_live_copy_paper_to_live(p_audit_paper_id);

  select count(*) into v_changes
  from public.bank_question_revisions r
  where r.id > v_mark and r.audit_paper_id = p_audit_paper_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note, after)
  values (null, auth.uid(), p_audit_paper_id, null, 'admin_reapply_paper_to_live',
          case when v_paper.source <> 'live_copy' or v_paper.live_bank_paper_id is null
               then 'Admin re-applied the draft; nothing to apply (not a live copy paper)'
               else 'Admin re-applied the draft onto the live paper; ' || v_changes::text || ' live change(s) written' end,
          jsonb_build_object('live_changes', v_changes, 'live_paper_id', v_paper.live_bank_paper_id));

  if v_changes > 0 and v_paper.live_bank_paper_id is not null then
    insert into public.bank_question_revisions
      (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, reason)
    values ('bank_papers', v_paper.live_bank_paper_id, 'live_apply', null, null,
            jsonb_build_object('live_changes', v_changes),
            auth.uid()::text, auth.uid(), 'admin', p_audit_paper_id,
            'admin re-apply: ' || v_changes::text || ' live change(s)');
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5 + 6. admin_question_history: paper-level rows, scope and event_kind.
-- The return type changes, so the function is dropped and recreated.

drop function if exists public.admin_question_history(uuid);

create function public.admin_question_history(p_question_id uuid)
 returns table(
   at timestamp with time zone,
   actor_kind text,
   actor_name text,
   action text,
   detail text,
   before jsonb,
   after jsonb,
   scope text,
   event_kind text
 )
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_live_id text;
  v_audit_paper_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select aq.live_bank_question_id, aq.paper_id into v_live_id, v_audit_paper_id
  from public.audit_questions aq where aq.id = p_question_id;

  return query
  with log_rows as (
    select
      l.at as at,
      case
        when l.actor_user_id is null and l.action in ('created', 'ai_flagged', 'ai_verdict') then 'ai'
        when l.actor_user_id is null and l.action in ('live_apply', 'live_clear') then 'system'
        when l.actor_user_id is null then 'rule'
        when exists (select 1 from public.admins ad where ad.id = l.actor_user_id) then 'admin'
        else 'checker'
      end as actor_kind,
      coalesce(p.full_name, u.email::text, 'system') as actor_name,
      l.action as action,
      l.note as detail,
      l.before as before,
      l.after as after,
      case when l.question_id is null then 'paper' else 'question' end as scope
    from public.audit_review_log l
    left join public.profiles p on p.id = l.actor_user_id
    left join auth.users u on u.id = l.actor_user_id
    where l.question_id = p_question_id
       or (l.question_id is null and v_audit_paper_id is not null and l.paper_id = v_audit_paper_id)
  ),
  revision_rows as (
    select
      r.created_at as at,
      case
        when r.source = 'ai' then 'ai'
        when r.source = 'checker' then 'checker'
        when r.actor_user_id is not null
             and exists (select 1 from public.admins ad where ad.id = r.actor_user_id) then 'admin'
        else 'system'
      end as actor_kind,
      coalesce(pr.full_name, au.email::text, r.actor) as actor_name,
      case when r.action = 'live_apply' then 'published' else r.action end as action,
      coalesce(r.reason, r.field) as detail,
      r.before as before,
      r.after as after,
      case when r.audit_question_id is null and r.row_id is distinct from v_live_id
           then 'paper' else 'question' end as scope,
      r.action as raw_action
    from public.bank_question_revisions r
    left join public.profiles pr on pr.id = r.actor_user_id
    left join auth.users au on au.id = r.actor_user_id
    where r.audit_question_id = p_question_id
       or (v_live_id is not null and r.row_id = v_live_id)
       -- paper-level admin summaries written by the two functions above
       or (r.table_name = 'bank_papers' and r.field is null and r.audit_question_id is null
           and v_audit_paper_id is not null and r.audit_paper_id = v_audit_paper_id)
  ),
  merged as (
    select lr.at, lr.actor_kind, lr.actor_name, lr.action, lr.detail, lr.before, lr.after, lr.scope,
           lr.action as catalog_key
    from log_rows lr
    union all
    select rr.at, rr.actor_kind, rr.actor_name, rr.action, rr.detail, rr.before, rr.after, rr.scope,
           rr.raw_action as catalog_key
    from revision_rows rr
  )
  select m.at, m.actor_kind, m.actor_name, m.action, m.detail, m.before, m.after, m.scope,
         coalesce(c.kind, case when m.actor_kind = 'rule' then 'system' else m.actor_kind end) as event_kind
  from merged m
  left join public.log_action_catalog c on c.action = m.catalog_key
  order by m.at asc;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Function grants: revoked from PUBLIC, anon and authenticated by role name,
-- then authenticated re-granted (each function checks is_admin() itself).
-- This is the live ACL of every one of them today.

revoke all on function public.admin_edit_bank_question(text, text, text) from public, anon, authenticated;
revoke all on function public.admin_edit_bank_paper(text, text, text) from public, anon, authenticated;
revoke all on function public.admin_add_bank_question(text, integer, text, numeric, text) from public, anon, authenticated;
revoke all on function public.admin_set_bank_question_figure(text, text) from public, anon, authenticated;
revoke all on function public.admin_english_rescue_publish_paper(uuid) from public, anon, authenticated;
revoke all on function public.admin_reapply_paper_to_live(uuid) from public, anon, authenticated;
revoke all on function public.admin_question_history(uuid) from public, anon, authenticated;
revoke all on function public.admin_undo_revision(bigint, boolean) from public, anon, authenticated;

grant execute on function public.admin_edit_bank_question(text, text, text) to authenticated;
grant execute on function public.admin_edit_bank_paper(text, text, text) to authenticated;
grant execute on function public.admin_add_bank_question(text, integer, text, numeric, text) to authenticated;
grant execute on function public.admin_set_bank_question_figure(text, text) to authenticated;
grant execute on function public.admin_english_rescue_publish_paper(uuid) to authenticated;
grant execute on function public.admin_reapply_paper_to_live(uuid) to authenticated;
grant execute on function public.admin_question_history(uuid) to authenticated;
grant execute on function public.admin_undo_revision(bigint, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Close direct table writes. SELECT grants and SELECT policies stay.

revoke insert, update, delete, truncate, references, trigger on public.bank_papers from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.bank_questions from public, anon, authenticated;

-- Column-level grants are separate ACL entries; clear any that exist.
do $$
declare
  r record;
begin
  for r in
    select c.relname as tbl, a.attname as col
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('bank_papers', 'bank_questions')
      and a.attnum > 0 and not a.attisdropped
  loop
    execute format('revoke insert (%I), update (%I), references (%I) on public.%I from public, anon, authenticated',
                   r.col, r.col, r.col, r.tbl);
  end loop;
end
$$;

drop policy if exists "admins write papers" on public.bank_papers;
drop policy if exists "admins write questions" on public.bank_questions;

-- The dropped ALL policy on bank_papers was also the admins' only way to read
-- hidden papers. Keep exactly that read, and nothing else.
drop policy if exists "admins read all papers" on public.bank_papers;
create policy "admins read all papers" on public.bank_papers
  for select to authenticated using (public.is_admin());

-- Self-check: fail the whole migration if any write privilege survived.
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s %s %s', t.tbl, r.rolname, p.priv), ', ') into v_bad
  from (values ('public.bank_papers'), ('public.bank_questions')) as t(tbl)
  cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(priv)
  where has_table_privilege(r.rolname, t.tbl, p.priv);
  if v_bad is not null then
    raise exception 'admin hardening: write privileges survived: %', v_bad;
  end if;

  select string_agg(format('%s.%s %s', c.relname, a.attname, r.rolname), ', ') into v_bad
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
  where c.relnamespace = 'public'::regnamespace
    and c.relname in ('bank_papers', 'bank_questions')
    and a.attnum > 0 and not a.attisdropped
    and (has_column_privilege(r.rolname, c.oid, a.attnum, 'INSERT')
      or has_column_privilege(r.rolname, c.oid, a.attnum, 'UPDATE'));
  if v_bad is not null then
    raise exception 'admin hardening: column write privileges survived: %', v_bad;
  end if;

  -- The pipeline (service_role) and the owner must keep writing: the revoke
  -- above is for the client roles only.
  select string_agg(format('%s %s %s', t.tbl, r.rolname, p.priv), ', ') into v_bad
  from (values ('public.bank_papers'), ('public.bank_questions')) as t(tbl)
  cross join (select rolname from pg_roles where rolname in ('service_role', 'postgres')) r
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
  where not has_table_privilege(r.rolname, t.tbl, p.priv);
  if v_bad is not null then
    raise exception 'admin hardening: server-side write privileges lost: %', v_bad;
  end if;
end
$$;
