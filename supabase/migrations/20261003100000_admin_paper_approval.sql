-- 20261003100000_admin_paper_approval.sql
--
-- B1 of workflow/QUEUE_20261002.md: the admin paper-approval flow (owner,
-- 2026-10-02 evening). New papers are never published by the pipeline any
-- more. A paper whose AI checks pass is queued; an admin reviews it, may edit
-- it, and approves it for launch. Approval is instant, logged and reversible.
--
-- What this adds
--   1. Columns.
--      audit_papers: approval_state ('awaiting' | 'approved' | 'rejected',
--        null = not in the approval flow), approval_kind ('new' | 'retro'),
--        queued_at, approved_at/_by, rejected_at/_by, approval_note, and
--        publish_meta: the bank_papers fields (school label, board, class,
--        subject ...) the pipeline resolves with school_names.py when it
--        queues a paper. SQL cannot re-derive those labels, so approval of a
--        'new' paper refuses until they are staged.
--      audit_questions: set_aside_at/_by/_reason (a question that ends "set
--        aside" instead of passed) and live_placeholder_ord (the slot a
--        set-aside question keeps on the live paper, shown as a card with no
--        text).
--   2. question_hold_flags() gains 'answer_text' (a row that is a printed
--      answer/solution, not a question).
--   3. bank_paper_questions(p_paper_id, p_with_placeholders default false):
--      the public paper read. Held rows (set aside, or not passed and
--      carrying a hold flag) are NEVER returned with text. With
--      p_with_placeholders = true they come back as {held: true, number,
--      ord} with body/options/figure/marks all null; without it they are
--      left out exactly as before, so the live bundle that predates this
--      keeps working unchanged while the new frontend opts in.
--      The rule now applies to every subject that is visible at all
--      (Mathematics, or not needs_review). Measured 2026-10-02 on live:
--      0 currently visible non-Maths rows become held; non-Maths
--      needs_review papers still return nothing, as before.
--      bank_paper_visible_counts() follows the same rule.
--   4. Admin functions (SECURITY DEFINER, search_path public, pg_temp,
--      is_admin() first, revoked from PUBLIC, anon AND authenticated by
--      name, granted back to authenticated exactly like every existing
--      admin_* function; a non-admin caller gets 42501):
--        admin_approval_queue()
--        admin_paper_review(uuid)
--        admin_set_question_state(uuid, text, text)
--        admin_approve_paper(uuid, text)
--        admin_reject_paper(uuid, text)
--        admin_unpublish_paper(text, text)
--        admin_edit_question(uuid, int, jsonb, text)
--        admin_revert_question(uuid, int, text)
--        admin_question_full_history(uuid)
--        admin_paper_full_history(uuid)
--        admin_checker_list()
--        admin_checker_day_log(text, date, date)
--      admin_paper_queue() and admin_question_history(uuid) already exist
--      with other return shapes and live callers (checker-api.ts,
--      team-dashboard-api.ts), so the new ones carry new names instead of
--      breaking the live admin pages.
--   5. queue_paper_for_approval(uuid, text, jsonb): service role only (the
--      pipeline queues; no browser role can).
--   6. view question_review_state: admin-only (rows only when is_admin()).
--   7. Internal helpers, closed to all three roles.
--
-- Rules kept
--   * Question text is copied byte-exact. Approval never edits a body; an
--     admin edit is the only path that changes one, and it is a new version.
--   * answer_key is never copied to bank_questions and never returned.
--   * Every write leaves one audit_review_log row (actor_user_id, action,
--     before/after, note). Content changes also land in content_versions via
--     the existing triggers, through apply_fix_locked (optimistic lock).
--   * History functions resolve names server-side (profiles.full_name, else
--     the email's local part, else "An admin"); no user id, email, path or
--     json blob reaches the browser through them.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. columns

alter table public.audit_papers
  add column if not exists approval_state text,
  add column if not exists approval_kind text,
  add column if not exists queued_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid references auth.users(id) on delete set null,
  add column if not exists approval_note text,
  add column if not exists publish_meta jsonb;

alter table public.audit_papers drop constraint if exists audit_papers_approval_state_check;
alter table public.audit_papers add constraint audit_papers_approval_state_check
  check (approval_state is null or approval_state in ('awaiting', 'approved', 'rejected'));
alter table public.audit_papers drop constraint if exists audit_papers_approval_kind_check;
alter table public.audit_papers add constraint audit_papers_approval_kind_check
  check (approval_kind is null or approval_kind in ('new', 'retro'));

create index if not exists audit_papers_approval_awaiting_idx
  on public.audit_papers (queued_at) where approval_state = 'awaiting';

alter table public.audit_questions
  add column if not exists set_aside_at timestamptz,
  add column if not exists set_aside_by uuid references auth.users(id) on delete set null,
  add column if not exists set_aside_reason text,
  add column if not exists live_placeholder_ord integer;

comment on column public.audit_papers.approval_state is
  'Admin approval flow: awaiting | approved | rejected; null = not in the flow. Written only by queue_paper_for_approval and the admin_* approval functions.';
comment on column public.audit_papers.publish_meta is
  'bank_papers fields staged by the pipeline at queue time (school, school_raw, is_board_paper, year, exam, cls, subject, board, has_school, incomplete_note). Required before a new paper can be approved.';
comment on column public.audit_questions.set_aside_at is
  'Set when a question ends set aside instead of passed. A set-aside question is never published with text; on a live paper it shows as a placeholder card.';
comment on column public.audit_questions.live_placeholder_ord is
  'bank_questions.ord slot kept for a set-aside question when its paper was approved; bank_paper_questions returns a text-free placeholder there.';

-- ---------------------------------------------------------------------------
-- 2. log vocabulary: every action this flow writes, plus pipeline actions
--    already in audit_review_log that had no catalog row (so history never
--    shows a raw code; anything still uncatalogued is reported as 'other').

insert into public.log_action_catalog (action, kind, meaning) values
  ('admin_approve',              'admin',    'An admin approved the paper for launch'),
  ('admin_reject',               'admin',    'An admin sent the paper back'),
  ('admin_unpublish',            'admin',    'An admin took the paper off the site'),
  ('admin_revert',               'admin',    'An admin restored an earlier version of a question'),
  ('admin_pass',                 'admin',    'An admin passed the question'),
  ('admin_set_aside',            'admin',    'An admin set the question aside'),
  ('admin_reopen',               'admin',    'An admin reopened the question'),
  ('queued_for_approval',        'pipeline', 'The paper passed its checks and joined the approval queue'),
  ('ai_fix',                     'ai',       'An AI check corrected the question'),
  ('autofill_metadata',          'ai',       'AI checks filled in the chapter or other details'),
  ('locate_page',                'pipeline', 'The pipeline looked for the question on the scanned pages'),
  ('pdf_mismatch_flag',          'pipeline', 'The pipeline found the scan may not match this paper'),
  ('publish',                    'pipeline', 'The pipeline published the paper'),
  ('route_back_unverified_page', 'pipeline', 'The pipeline sent the question to an admin because its page was not confirmed')
on conflict (action) do nothing;

-- ---------------------------------------------------------------------------
-- 3. hold flags: add 'answer_text'

create or replace function public.question_hold_flags()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $function$
  select array[
    'figure_missing',
    'snippet_unaligned',
    'possible_duplicate',
    'page_furniture',
    'short_body',
    'unbalanced_math_delim',
    'ocr_junk',
    'answer_text'
  ]::text[];
$function$;

revoke all on function public.question_hold_flags() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. internal helpers (closed to every browser role)

-- audit_questions.options (jsonb: strings or {text,label} objects) to
-- bank_questions.options (text[]). Same rule as publish.flatten_options:
-- "(label) text", text byte-exact, no label added when the text already
-- starts with its own label.
create or replace function public.approval_flatten_options(p_options jsonb)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $function$
  select case
    when p_options is null or jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) = 0 then null
    else (
      select array_agg(
        case
          when jsonb_typeof(t.e) = 'object' then
            case
              when coalesce(btrim(t.e ->> 'label'), '') <> ''
                   and coalesce(t.e ->> 'text', '') !~ '^\s*\(?[A-Za-z0-9]{1,4}[.)]'
                then '(' || btrim(t.e ->> 'label') || ') ' || coalesce(t.e ->> 'text', '')
              else coalesce(t.e ->> 'text', '')
            end
          when jsonb_typeof(t.e) = 'string' then t.e #>> '{}'
          else t.e::text
        end
        order by t.i)
      from jsonb_array_elements(p_options) with ordinality as t(e, i)
    )
  end;
$function$;

-- A person's display name: full_name, else the email's local part, else a
-- role word. Never the full email.
create or replace function public.history_person_name(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce(
    (select coalesce(nullif(btrim(p.full_name), ''),
                     nullif(split_part(coalesce(nullif(btrim(p.email), ''), u.email::text, ''), '@', 1), ''))
     from (select p_uid as id) x
     left join public.profiles p on p.id = x.id
     left join auth.users u on u.id = x.id),
    case when exists (select 1 from public.admins a where a.id = p_uid) then 'An admin' else 'A student checker' end);
$function$;

-- One stable key per actor, so a person and the AI / pipeline pseudo-actors
-- share one id type: a person is their uuid as text; otherwise 'ai:sonnet',
-- 'ai:haiku', 'student:unknown', 'admin:unknown' or 'pipeline'. p_actor is a
-- free actor string (a uuid as text, 'ai:haiku', 'checker', 'system:...');
-- p_hint is extra text searched for a model name (only passed for AI rows).
-- Plain SQL with no search_path so the planner can inline it; it uses
-- built-in operators only.
create or replace function public.history_actor_key(p_uid uuid, p_actor text, p_hint text default null)
returns text
language sql
immutable
as $function$
  select case
    when p_uid is not null then p_uid::text
    when p_actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then lower(p_actor)
    when lower(coalesce(p_actor, '') || ' ' || coalesce(p_hint, '')) like '%sonnet%' then 'ai:sonnet'
    when lower(coalesce(p_actor, '') || ' ' || coalesce(p_hint, '')) like '%haiku%' then 'ai:haiku'
    when p_actor in ('checker', 'student') then 'student:unknown'
    when p_actor = 'admin' then 'admin:unknown'
    else 'pipeline'
  end;
$function$;

-- The key as words: {"name": ..., "kind": admin|student|ai|pipeline}.
create or replace function public.history_actor_from_key(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid;
begin
  if p_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_uid := p_key::uuid;
    return jsonb_build_object(
      'name', public.history_person_name(v_uid),
      'kind', case when exists (select 1 from public.admins a where a.id = v_uid) then 'admin' else 'student' end);
  end if;
  return case p_key
    when 'ai:sonnet' then jsonb_build_object('name', 'AI check (Sonnet)', 'kind', 'ai')
    when 'ai:haiku' then jsonb_build_object('name', 'AI check (Haiku)', 'kind', 'ai')
    when 'student:unknown' then jsonb_build_object('name', 'A student checker', 'kind', 'student')
    when 'admin:unknown' then jsonb_build_object('name', 'An admin', 'kind', 'admin')
    else jsonb_build_object('name', 'Pipeline (automatic)', 'kind', 'pipeline')
  end;
end;
$function$;

-- Who did it, as words: {"name": ..., "kind": admin|student|ai|pipeline}.
create or replace function public.history_actor(p_uid uuid, p_actor text, p_hint text default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select public.history_actor_from_key(public.history_actor_key(p_uid, p_actor, p_hint));
$function$;

-- Which tally a history line counts toward on the day log.
create or replace function public.history_action_bucket(p_code text)
returns text
language sql
immutable
as $function$
  select case
    when p_code in ('checker_pass', 'admin_pass', 'ai_pass', 'gap_audit_pass', 'check_pass') then 'passed'
    when p_code in ('checker_fix', 'checker_printed_typo', 'ai_fix', 'auto_fix', 'check_fix', 'check_printed_typo',
                    'admin_resolve_escalation', 'marks_from_picture') then 'fixed'
    when p_code = 'admin_set_aside' then 'set_aside'
    when p_code in ('ai_flagged', 'ai_escalate', 'gap_flag', 'checker_ask_help', 'check_flag', 'check_escalate',
                    'pdf_mismatch_flag') then 'flagged'
    when p_code in ('admin_edit', 'admin_revert', 'checker_split', 'admin_split', 'admin_merge', 'admin_add',
                    'admin_delete', 'admin_reorder', 'admin_undo') then 'edited'
    when p_code = 'admin_approve' then 'approved'
    else 'other'
  end;
$function$;

-- The readable fields a history line may show a before/after for. Anything
-- else (paths, scores, sources, flags, ids) never reaches the screen.
create or replace function public.history_readable_fields()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $function$
  select array['body', 'display_number', 'marks', 'options', 'instructions', 'section_label', 'chapter',
               'alternative_label', 'alternative_group', 'suggested_time_minutes',
               'is_published', 'needs_review', 'school', 'subject', 'cls', 'class', 'board', 'year',
               'exam', 'exam_type', 'title', 'general_instructions', 'allowed_time_minutes']::text[];
$function$;

-- [{field, before, after}] for the readable fields that changed.
create or replace function public.history_changes(p_field text, p_before jsonb, p_after jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $function$
  select case
    -- {field: value, ...} objects on both sides (checker fixes, admin edits
    -- whose field column is a comma list): diff the readable keys
    when jsonb_typeof(p_before) = 'object' and jsonb_typeof(coalesce(p_after, '{}'::jsonb)) = 'object' then
      coalesce((
        select jsonb_agg(jsonb_build_object('field', f, 'before', p_before -> f, 'after', p_after -> f) order by o)
        from unnest(public.history_readable_fields()) with ordinality as t(f, o)
        where (p_before ? f or coalesce(p_after, '{}'::jsonb) ? f)
          and (p_before -> f) is distinct from (p_after -> f)), '[]'::jsonb)
    -- one named field with scalar values
    when p_field = any (public.history_readable_fields())
         and p_before is distinct from p_after
         and (p_before is not null or p_after is not null)
         and coalesce(jsonb_typeof(p_after), '') <> 'object'
      then jsonb_build_array(jsonb_build_object('field', p_field, 'before', p_before, 'after', p_after))
    -- whole-row inserts, paths, scores, flags: nothing a person reads
    else '[]'::jsonb
  end;
$function$;

-- Every history line for one question (p_question_id) or a whole paper
-- (p_question_id null). One jsonb per line (seq breaks ties in time):
--   {at, actor_name, actor_kind, action, changes, note, question_number,
--    confidence, version}
-- note is only a person's own note (admin/student); script and AI notes are
-- jargon and are dropped. action is a catalog code, 'check_<verdict>', or
-- 'other'.
drop function if exists public.history_events(uuid, uuid);
create or replace function public.history_events(p_audit_paper_id uuid, p_question_id uuid)
returns table (at timestamptz, seq bigint, ev jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
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
    select l.id, l.at, l.actor_user_id, l.action, l.field, l.before, l.after, l.note, l.question_id
    from public.audit_review_log l
    where p_question_id is not null and l.question_id = p_question_id
    union all
    select l.id, l.at, l.actor_user_id, l.action, l.field, l.before, l.after, l.note, l.question_id
    from public.audit_review_log l
    where l.paper_id = p_audit_paper_id
      and (p_question_id is null
           or (l.question_id is null
               and l.action in ('admin_approve', 'admin_reject', 'admin_unpublish', 'queued_for_approval')))
  ),
  log_ev as (
    select lr.id, lr.at, lr.action, (c.action is not null) as known, lr.field, lr.before, lr.after, lr.note,
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
           k.version_seen, k.notes, qs.id as question_id
    from public.content_checks k
    join qs on k.table_name = 'audit_questions' and k.row_id = qs.id::text
    where k.checker_kind not in ('admin', 'student')
    union all
    select k.id, k.created_at, k.verdict, k.checker_kind, k.model, k.actor_user_id, k.confidence,
           k.version_seen, k.notes, qs.id
    from public.content_checks k
    join qs on k.table_name = 'bank_questions' and k.row_id = qs.live_bank_question_id
    where k.checker_kind not in ('admin', 'student')
  )
  select e.at, e.seq, jsonb_build_object(
           'at', e.at,
           'actor_name', e.who ->> 'name',
           'actor_kind', e.who ->> 'kind',
           'action', e.action,
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
           case when (le.after ->> 'version') ~ '^[0-9]{1,9}$' then (le.after ->> 'version')::integer end as version
    from log_ev le
    union all
    select rr.at, rr.id, public.history_actor(rr.actor_user_id, rr.actor, null),
           case when rr.known then rr.action else 'other' end,
           public.history_changes(rr.field, rr.before, rr.after),
           rr.reason, rr.question_id, null::numeric, null::integer
    from rev_rows rr
    union all
    select cr.at, cr.id,
           public.history_actor(cr.actor_user_id,
             case cr.checker_kind when 'student' then 'checker' else cr.checker_kind end,
             cr.model),
           'check_' || cr.verdict, '[]'::jsonb, cr.notes, cr.question_id, cr.confidence, cr.version_seen
    from check_rows cr
  ) e;
end;
$function$;

-- One question's state, shared by the queue, the review page and approval.
--   'passed' | 'set_aside' | 'open' for kind = 'question'; 'section' otherwise.
create or replace function public.approval_question_state(p_kind text, p_passed boolean, p_set_aside_at timestamptz)
returns text
language sql
immutable
set search_path = public, pg_temp
as $function$
  select case
    when p_kind <> 'question' then 'section'
    when coalesce(p_passed, false) then 'passed'
    when p_set_aside_at is not null then 'set_aside'
    else 'open'
  end;
$function$;

revoke all on function public.approval_flatten_options(jsonb) from public, anon, authenticated;
revoke all on function public.history_person_name(uuid) from public, anon, authenticated;
revoke all on function public.history_actor(uuid, text, text) from public, anon, authenticated;
revoke all on function public.history_actor_key(uuid, text, text) from public, anon, authenticated;
revoke all on function public.history_actor_from_key(text) from public, anon, authenticated;
revoke all on function public.history_action_bucket(text) from public, anon, authenticated;
revoke all on function public.history_readable_fields() from public, anon, authenticated;
revoke all on function public.history_changes(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.history_events(uuid, uuid) from public, anon, authenticated;
revoke all on function public.approval_question_state(text, boolean, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. the public paper read: held rows become text-free placeholders

drop function if exists public.bank_paper_questions(text);
drop function if exists public.bank_paper_questions(text, boolean);

create function public.bank_paper_questions(p_paper_id text, p_with_placeholders boolean default false)
returns table(
  id text, paper_id text, number text, body text, marks numeric, chapter text,
  qtype text, page integer, figure text, options text[], display_number text,
  instructions text, suggested_time_minutes numeric, chapter_from_paper boolean,
  alternative_group text, alternative_label text, section_label text,
  parent_question_id text, held boolean, ord integer
)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    insert into public.read_events (user_id, kind, target_id, ip_hash)
    values (v_uid, 'paper', p_paper_id,
      encode(extensions.digest(coalesce(
        current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''
      ), 'sha256'), 'hex'));
  end if;

  return query
    with live_rows as (
      select q.id, q.paper_id, q.number, q.body, q.marks, q.chapter, q.qtype, q.page, q.figure,
             q.options, q.display_number, q.instructions, q.suggested_time_minutes,
             q.chapter_from_paper, q.alternative_group, q.alternative_label, q.section_label,
             q.parent_question_id, q.ord,
             (coalesce(d.status, '') <> 'passed'
              and (d.set_aside_at is not null
                   or coalesce(d.flag_reasons, '{}'::text[]) && public.question_hold_flags())) as is_held
      from public.bank_questions q
      join public.bank_papers p on p.id = q.paper_id
      left join lateral (
        select a.status, a.flag_reasons, a.set_aside_at
        from public.audit_questions a
        where a.live_bank_question_id = q.id
          and a.kind = 'question'
        order by a.updated_at desc
        limit 1
      ) d on true
      where q.paper_id = p_paper_id
        and p.is_published
        and (p.subject = 'Mathematics' or not p.needs_review)
    ),
    -- set-aside questions of an approved paper that never got a live row:
    -- only their slot and printed number exist on the site
    slot_rows as (
      select 'held-' || p.id || '-' || a.live_placeholder_ord::text as id, p.id as paper_id,
             a.display_number as number, a.live_placeholder_ord as ord
      from public.audit_questions a
      join public.audit_papers ap on ap.id = a.paper_id
      join public.bank_papers p on p.id = ap.live_bank_paper_id
      where ap.live_bank_paper_id = p_paper_id
        and ap.approval_state = 'approved'
        and p.is_published
        and (p.subject = 'Mathematics' or not p.needs_review)
        and a.kind = 'question'
        and a.live_bank_question_id is null
        and a.live_placeholder_ord is not null
    ),
    all_rows as (
      select lr.id, lr.paper_id, lr.number, lr.body, lr.marks, lr.chapter, lr.qtype, lr.page, lr.figure,
             lr.options, lr.display_number, lr.instructions, lr.suggested_time_minutes,
             lr.chapter_from_paper, lr.alternative_group, lr.alternative_label, lr.section_label,
             lr.parent_question_id, lr.ord, lr.is_held
      from live_rows lr
      union all
      select sr.id, sr.paper_id, sr.number, null, null, null, null, null, null,
             null, sr.number, null, null, null, null, null, null, null, sr.ord, true
      from slot_rows sr
    ),
    numbered as (
      select ar.*,
             case when not ar.is_held
                  then row_number() over (partition by ar.is_held order by ar.ord) end as vis_n
      from all_rows ar
    ),
    cut as (
      select max(n.ord) filter (where n.vis_n <= 2) as last_free_ord from numbered n
    )
    select n.id, n.paper_id,
           case when n.is_held then coalesce(n.display_number, n.number) else n.number end,
           case when n.is_held then null else n.body end,
           case when n.is_held then null else n.marks end,
           case when n.is_held then null else n.chapter end,
           case when n.is_held then null else n.qtype end,
           case when n.is_held then null else n.page end,
           case when n.is_held then null else n.figure end,
           case when n.is_held then null else n.options end,
           n.display_number,
           case when n.is_held then null else n.instructions end,
           case when n.is_held then null else n.suggested_time_minutes end,
           case when n.is_held then null else n.chapter_from_paper end,
           case when n.is_held then null else n.alternative_group end,
           case when n.is_held then null else n.alternative_label end,
           case when n.is_held then null else n.section_label end,
           case when n.is_held then null else n.parent_question_id end,
           n.is_held,
           n.ord
    from numbered n cross join cut
    where (not n.is_held or coalesce(p_with_placeholders, false))
      and (v_uid is not null
           or (not n.is_held and n.vis_n <= 2)
           or (n.is_held and n.ord < cut.last_free_ord))
    order by n.ord;
end;
$function$;

revoke all on function public.bank_paper_questions(text, boolean) from public, anon, authenticated;
grant execute on function public.bank_paper_questions(text, boolean) to anon, authenticated;

create or replace function public.bank_paper_visible_counts(p_paper_id text default null)
returns table(paper_id text, visible integer)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p.id,
         (count(q.id) filter (
            where (p.subject <> 'Mathematics' and p.needs_review)
               or not (coalesce(d.status, '') <> 'passed'
                       and (d.set_aside_at is not null
                            or coalesce(d.flag_reasons, '{}'::text[]) && public.question_hold_flags()))
         ))::integer
  from public.bank_papers p
  left join public.bank_questions q on q.paper_id = p.id
  left join lateral (
    select a.status, a.flag_reasons, a.set_aside_at
    from public.audit_questions a
    where a.live_bank_question_id = q.id
      and a.kind = 'question'
    order by a.updated_at desc
    limit 1
  ) d on true
  where p.is_published
    and (p_paper_id is null or p.id = p_paper_id)
  group by p.id;
$function$;

revoke all on function public.bank_paper_visible_counts(text) from public, anon, authenticated;
grant execute on function public.bank_paper_visible_counts(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. queueing (pipeline / service role only)

create or replace function public.queue_paper_for_approval(
  p_audit_paper_id uuid, p_kind text default null, p_publish_meta jsonb default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_p public.audit_papers;
  v_kind text;
begin
  select * into v_p from public.audit_papers where id = p_audit_paper_id for update;
  if v_p.id is null then
    raise exception 'Paper not found' using errcode = 'P0002';
  end if;
  if v_p.source <> 'new_ocr' then
    raise exception 'Only pipeline papers (new_ocr) join the approval queue' using errcode = '22023';
  end if;
  if v_p.approval_state = 'approved' then
    raise exception 'This paper is already approved' using errcode = '55000';
  end if;
  v_kind := coalesce(p_kind, case when v_p.live_bank_paper_id is null then 'new' else 'retro' end);
  if v_kind not in ('new', 'retro') then
    raise exception 'kind must be new or retro' using errcode = '22023';
  end if;
  if v_kind = 'new' and v_p.live_bank_paper_id is not null then
    raise exception 'This paper is already live; queue it as retro' using errcode = '22023';
  end if;
  if v_kind = 'retro' and v_p.live_bank_paper_id is null then
    raise exception 'A retro approval needs a paper that is already live' using errcode = '22023';
  end if;
  if p_publish_meta is not null and jsonb_typeof(p_publish_meta) <> 'object' then
    raise exception 'publish_meta must be an object' using errcode = '22023';
  end if;

  update public.audit_papers
     set approval_state = 'awaiting', approval_kind = v_kind, queued_at = now(),
         rejected_at = null, rejected_by = null,
         publish_meta = coalesce(p_publish_meta, publish_meta)
   where id = p_audit_paper_id;

  insert into public.audit_review_log (actor_user_id, paper_id, question_id, action, before, after)
  values (null, p_audit_paper_id, null, 'queued_for_approval',
          jsonb_build_object('approval_state', v_p.approval_state),
          jsonb_build_object('approval_state', 'awaiting', 'kind', v_kind));
  return v_kind;
end;
$function$;

revoke all on function public.queue_paper_for_approval(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. the approval queue

create or replace function public.admin_approval_queue()
returns table(
  audit_paper_id uuid, title text, board text, class text, subject text, school text, year text,
  exam_type text, questions_total integer, passed integer, open integer, set_aside integer,
  ai_summary jsonb, queued_at timestamptz, kind text, live_bank_paper_id text, is_live boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    with papers as (
      select ap.* from public.audit_papers ap where ap.approval_state = 'awaiting'
    ),
    qrows as (
      select q.paper_id as pid, q.review_bucket,
             public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) as st,
             (select k.verdict from public.content_checks k
               where k.table_name = 'audit_questions' and k.row_id = q.id::text
                 and k.checker_kind in ('haiku_paddle', 'haiku_pdf', 'sonnet')
               order by k.created_at desc, k.id desc limit 1) as ai_verdict,
             exists (select 1 from public.content_checks k
                      where k.table_name = 'audit_questions' and k.row_id = q.id::text
                        and k.checker_kind = 'student') as student_checked
      from public.audit_questions q
      where q.paper_id in (select papers.id from papers) and q.kind = 'question'
    ),
    counts as (
      select r.pid,
             count(*)::integer as total,
             (count(*) filter (where r.st = 'passed'))::integer as n_passed,
             (count(*) filter (where r.st = 'open'))::integer as n_open,
             (count(*) filter (where r.st = 'set_aside'))::integer as n_set_aside,
             jsonb_build_object(
               'pass', count(*) filter (where r.ai_verdict = 'pass'),
               'fix', count(*) filter (where r.ai_verdict in ('fix', 'printed_typo')),
               'student', count(*) filter (where r.review_bucket = 'kid' or r.student_checked
                                                or r.ai_verdict in ('flag', 'escalate'))) as ai
      from qrows r
      group by r.pid
    )
    select pa.id,
           coalesce(nullif(btrim(pa.title), ''),
                    concat_ws(' ', coalesce(pa.publish_meta ->> 'school', pa.school),
                              coalesce(pa.publish_meta ->> 'subject', pa.subject),
                              coalesce(pa.publish_meta ->> 'cls', pa.class),
                              coalesce(pa.publish_meta ->> 'exam', pa.exam_type),
                              nullif(coalesce(pa.publish_meta ->> 'year', pa.year), 'year-unknown'))),
           coalesce(pa.publish_meta ->> 'board', pa.board),
           coalesce(pa.publish_meta ->> 'cls', pa.class),
           coalesce(pa.publish_meta ->> 'subject', pa.subject),
           coalesce(pa.publish_meta ->> 'school', pa.school),
           coalesce(pa.publish_meta ->> 'year', pa.year),
           coalesce(pa.publish_meta ->> 'exam', pa.exam_type),
           coalesce(c.total, 0), coalesce(c.n_passed, 0), coalesce(c.n_open, 0), coalesce(c.n_set_aside, 0),
           coalesce(c.ai, jsonb_build_object('pass', 0, 'fix', 0, 'student', 0)),
           pa.queued_at, pa.approval_kind, pa.live_bank_paper_id,
           exists (select 1 from public.bank_papers bp where bp.id = pa.live_bank_paper_id and bp.is_published)
    from papers pa
    left join counts c on c.pid = pa.id
    order by pa.queued_at, pa.id;
end;
$function$;

revoke all on function public.admin_approval_queue() from public, anon, authenticated;
grant execute on function public.admin_approval_queue() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. one paper, everything the review page needs

create or replace function public.admin_paper_review(p_audit_paper_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_p public.audit_papers;
  v_rows jsonb;
  v_counts jsonb;
  v_pages jsonb;
  v_live boolean;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_p from public.audit_papers where id = p_audit_paper_id;
  if v_p.id is null then
    raise exception 'Paper not found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id,
           'ord', q.ord,
           'kind', q.kind,
           'parent_id', q.parent_id,
           'section_label', q.section_label,
           'number_path', q.number_path,
           'display_number', q.display_number,
           'instructions', q.instructions,
           'body', q.body,
           'options', q.options,
           'marks', q.marks,
           'figure', q.figure,
           'figure_path', q.figure ->> 'path',
           'has_picture', (q.figure ->> 'path') is not null
                          or exists (select 1 from public.audit_figures f where f.question_id = q.id and f.status = 'active'),
           'page', case when (q.source ->> 'page') ~ '^[0-9]{1,6}$' then (q.source ->> 'page')::integer end,
           'status', q.status,
           'state', public.approval_question_state(q.kind, q.question_passed, q.set_aside_at),
           'question_passed', q.question_passed,
           'version', q.version,
           'flag_reasons', to_jsonb(q.flag_reasons),
           'review_bucket', q.review_bucket,
           'set_aside_reason', q.set_aside_reason,
           'live_bank_question_id', q.live_bank_question_id,
           'live_placeholder_ord', q.live_placeholder_ord
         ) order by q.ord, q.id), '[]'::jsonb)
    into v_rows
  from public.audit_questions q
  where q.paper_id = p_audit_paper_id;

  select jsonb_build_object(
           'total', count(*) filter (where q.kind = 'question'),
           'passed', count(*) filter (where public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'passed'),
           'open', count(*) filter (where public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open'),
           'set_aside', count(*) filter (where public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'set_aside'))
    into v_counts
  from public.audit_questions q
  where q.paper_id = p_audit_paper_id;

  select coalesce(jsonb_agg(jsonb_build_object('page', pg.page, 'object_path', pg.object_path) order by pg.page), '[]'::jsonb)
    into v_pages
  from public.audit_paper_pages pg
  where pg.audit_paper_id = p_audit_paper_id;

  select bp.is_published into v_live from public.bank_papers bp where bp.id = v_p.live_bank_paper_id;

  return jsonb_build_object(
    'paper', jsonb_build_object(
      'audit_paper_id', v_p.id,
      'title', coalesce(nullif(btrim(v_p.title), ''),
                        concat_ws(' ', coalesce(v_p.publish_meta ->> 'school', v_p.school),
                                  coalesce(v_p.publish_meta ->> 'subject', v_p.subject),
                                  coalesce(v_p.publish_meta ->> 'cls', v_p.class),
                                  coalesce(v_p.publish_meta ->> 'exam', v_p.exam_type),
                                  nullif(coalesce(v_p.publish_meta ->> 'year', v_p.year), 'year-unknown'))),
      'board', coalesce(v_p.publish_meta ->> 'board', v_p.board),
      'class', coalesce(v_p.publish_meta ->> 'cls', v_p.class),
      'subject', coalesce(v_p.publish_meta ->> 'subject', v_p.subject),
      'school', coalesce(v_p.publish_meta ->> 'school', v_p.school),
      'year', coalesce(v_p.publish_meta ->> 'year', v_p.year),
      'exam_type', coalesce(v_p.publish_meta ->> 'exam', v_p.exam_type),
      'max_marks', v_p.max_marks,
      'allowed_time_minutes', v_p.allowed_time_minutes,
      'instructions', v_p.instructions,
      'page_count', v_p.page_count,
      'status', v_p.status,
      'version', v_p.version,
      'approval_state', v_p.approval_state,
      'kind', v_p.approval_kind,
      'queued_at', v_p.queued_at,
      'approved_at', v_p.approved_at,
      'approved_by_name', case when v_p.approved_by is not null then public.history_person_name(v_p.approved_by) end,
      'rejected_at', v_p.rejected_at,
      'rejected_by_name', case when v_p.rejected_by is not null then public.history_person_name(v_p.rejected_by) end,
      'approval_note', v_p.approval_note,
      'details_staged', v_p.publish_meta is not null,
      'live_bank_paper_id', v_p.live_bank_paper_id,
      'is_live', coalesce(v_live, false)),
    'counts', v_counts,
    'open', coalesce((v_counts ->> 'open')::integer, 0),
    'pages', v_pages,
    'rows', v_rows);
end;
$function$;

revoke all on function public.admin_paper_review(uuid) from public, anon, authenticated;
grant execute on function public.admin_paper_review(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. resolve one question: pass, set aside, or reopen (while the paper waits)
--
-- Late pass (owner, 2026-10-02): after the paper is approved a question can
-- still be passed, and it goes live at once. It takes the slot its
-- placeholder held (live_placeholder_ord), so the placeholder disappears,
-- the back-link is set and the line is logged. Set aside and reopen stay
-- refused once the paper is approved.

create or replace function public.admin_set_question_state(p_question_id uuid, p_state text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
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
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
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
  elsif v_approval is distinct from 'awaiting' then
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

revoke all on function public.admin_set_question_state(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_question_state(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. approve

create or replace function public.admin_approve_paper(p_audit_paper_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_p public.audit_papers;
  v_meta jsonb;
  v_open integer;
  v_unstaged integer;
  v_bank text;
  v_published integer;
  v_placeholders integer;
  v_marks numeric;
  v_try integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_p from public.audit_papers where id = p_audit_paper_id for update;
  if v_p.id is null then
    raise exception 'Paper not found' using errcode = 'P0002';
  end if;
  if v_p.approval_state is distinct from 'awaiting' then
    raise exception 'This paper is not waiting for approval (%)', coalesce(v_p.approval_state, 'not in the queue')
      using errcode = '55000';
  end if;

  select count(*) into v_open
  from public.audit_questions q
  where q.paper_id = p_audit_paper_id
    and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open';
  if v_open > 0 then
    raise exception '% question(s) on this paper are still open. Pass or set aside each one first.', v_open
      using errcode = '55000';
  end if;

  -- Retro: the paper is already live. Approval is a record, nothing moves.
  if v_p.approval_kind = 'retro' or v_p.live_bank_paper_id is not null then
    update public.audit_papers
       set approval_state = 'approved', approved_at = now(), approved_by = v_uid, approval_note = p_note
     where id = p_audit_paper_id;
    insert into public.audit_review_log (actor_user_id, paper_id, question_id, action, before, after, note)
    values (v_uid, p_audit_paper_id, null, 'admin_approve',
            jsonb_build_object('approval_state', 'awaiting'),
            jsonb_build_object('approval_state', 'approved', 'kind', 'retro',
                               'live_bank_paper_id', v_p.live_bank_paper_id),
            p_note);
    return v_p.live_bank_paper_id;
  end if;

  -- New: the paper goes live now.
  v_meta := v_p.publish_meta;
  if v_meta is null or coalesce(v_meta ->> 'school', '') = '' or coalesce(v_meta ->> 'cls', '') = ''
     or coalesce(v_meta ->> 'subject', '') = '' or coalesce(v_meta ->> 'board', '') = '' then
    raise exception 'The paper details (school, class, subject, board) are not staged yet; the pipeline stages them when it queues the paper'
      using errcode = '55000';
  end if;

  -- A picture must already sit in the public figures bucket (figure.path):
  -- the database cannot copy storage objects.
  select count(*) into v_unstaged
  from public.audit_questions q
  where q.paper_id = p_audit_paper_id and q.kind = 'question' and q.question_passed
    and (q.figure ->> 'path') is null
    and exists (select 1 from public.audit_figures f where f.question_id = q.id and f.status = 'active');
  if v_unstaged > 0 then
    raise exception '% question(s) have a picture that is not staged for the site yet', v_unstaged
      using errcode = '55000';
  end if;

  loop
    v_try := v_try + 1;
    v_bank := substr(md5(gen_random_uuid()::text), 1, 6);
    exit when not exists (select 1 from public.bank_papers where id = v_bank)
          and not exists (select 1 from public.bank_questions where paper_id = v_bank);
    if v_try > 50 then
      raise exception 'Could not find a free paper id';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtext(v_bank));

  create temporary table if not exists approval_leaves (
    audit_id uuid primary key, passed boolean not null, is_stem boolean not null, bank_ord integer not null,
    bank_id text, parent_audit_id uuid, keep_marks boolean not null
  ) on commit drop;
  delete from pg_temp.approval_leaves;

  -- Leaves (questions that are not a parent of another row, publish.py's
  -- rule) and, since the owner's 2026-10-02 answer, stems too: a parent
  -- with printed lead-in text is its own row, in ord order before its
  -- parts, and its parts point at it through parent_question_id (the
  -- sub-part nesting BankPaper.tsx already renders). A stem with no text
  -- at all has nothing to show and is skipped; its parts stay top level.
  -- A stem keeps its marks only when none of its parts carries marks, so
  -- a total is never shown or counted twice. Dense ord over passed +
  -- set-aside rows so a set-aside question keeps its slot. Ids follow
  -- publish.py: MQ-<paper>-<printed n>-<m>.
  insert into pg_temp.approval_leaves (audit_id, passed, is_stem, bank_ord, bank_id, parent_audit_id, keep_marks)
  select l.id, l.question_passed, l.is_stem, l.bank_ord,
         case when l.question_passed
              then 'MQ-' || v_bank || '-' || l.top_n || '-' ||
                   (row_number() over (partition by l.top_n order by l.ord, l.id) - 1)::text end,
         l.parent_id,
         not l.is_stem or not l.kids_have_marks
  from (
    select q.id, q.ord, q.question_passed, q.parent_id, s.is_stem, s.kids_have_marks,
           (row_number() over (order by q.ord, q.id) - 1)::integer as bank_ord,
           coalesce(substring(coalesce(q.number_path, q.display_number, '') from '[[:alnum:]]+'), '0') as top_n
    from public.audit_questions q
    cross join lateral (
      select exists (select 1 from public.audit_questions c where c.parent_id = q.id) as is_stem,
             exists (select 1 from public.audit_questions c where c.parent_id = q.id and c.marks is not null) as kids_have_marks
    ) s
    where q.paper_id = p_audit_paper_id
      and q.kind = 'question'
      and (q.question_passed or q.set_aside_at is not null)
      and (not s.is_stem
           or nullif(btrim(coalesce(q.body, '')), '') is not null
           or nullif(btrim(coalesce(q.instructions, '')), '') is not null)
  ) l;

  select count(*) filter (where passed and not is_stem), count(*) filter (where not passed)
    into v_published, v_placeholders
  from pg_temp.approval_leaves;
  if v_published = 0 then
    raise exception 'No passed question to publish on this paper' using errcode = '55000';
  end if;

  select coalesce(sum(q.marks), 0) into v_marks
  from pg_temp.approval_leaves a join public.audit_questions q on q.id = a.audit_id
  where a.passed and a.keep_marks;

  perform set_config('shikshaq.actor', coalesce(v_uid::text, 'admin'), true);
  perform set_config('shikshaq.source', 'admin', true);
  perform set_config('shikshaq.reason', 'approved for launch', true);

  insert into public.bank_papers
    (id, school_raw, school, is_board_paper, year, exam, cls, subject, board, question_count, marks,
     is_published, has_school, needs_review, allowed_time_minutes, general_instructions, incomplete_note)
  values
    (v_bank,
     coalesce(nullif(v_meta ->> 'school_raw', ''), v_p.school),
     v_meta ->> 'school',
     coalesce((v_meta ->> 'is_board_paper')::boolean, false),
     nullif(v_meta ->> 'year', ''),
     coalesce(nullif(v_meta ->> 'exam', ''), v_p.exam_type),
     v_meta ->> 'cls',
     v_meta ->> 'subject',
     v_meta ->> 'board',
     v_published,
     v_marks,
     true,
     coalesce((v_meta ->> 'has_school')::boolean, true),
     false,
     v_p.allowed_time_minutes,
     nullif(v_p.instructions, ''),
     nullif(v_meta ->> 'incomplete_note', ''));

  -- Body byte-exact. answer_key is deliberately not in this column list.
  insert into public.bank_questions
    (id, paper_id, ord, number, body, marks, chapter, qtype, page, figure, options, display_number,
     instructions, suggested_time_minutes, chapter_from_paper, alternative_group, alternative_label,
     section_label, syllabus_ref, parent_question_id)
  select a.bank_id, v_bank, a.bank_ord, q.display_number, q.body,
         case when a.keep_marks then q.marks end,
         q.chapter, q.qtype,
         case when (q.source ->> 'page') ~ '^[0-9]{1,6}$' then (q.source ->> 'page')::integer end,
         q.figure ->> 'path',
         public.approval_flatten_options(q.options),
         q.display_number, q.instructions, q.suggested_time_minutes, coalesce(q.chapter_from_paper, false),
         q.alternative_group, q.alternative_label, q.section_label, q.syllabus_ref,
         (select p.bank_id from pg_temp.approval_leaves p where p.audit_id = a.parent_audit_id and p.passed)
  from pg_temp.approval_leaves a
  join public.audit_questions q on q.id = a.audit_id
  where a.passed;

  update public.audit_questions q
     set live_bank_question_id = case when a.passed then a.bank_id end,
         live_placeholder_ord = case when a.passed then null else a.bank_ord end
  from pg_temp.approval_leaves a
  where q.id = a.audit_id;

  update public.audit_papers
     set live_bank_paper_id = v_bank, approval_state = 'approved', approved_at = now(),
         approved_by = v_uid, approval_note = p_note
   where id = p_audit_paper_id;

  perform set_config('shikshaq.actor', '', true);
  perform set_config('shikshaq.source', '', true);
  perform set_config('shikshaq.reason', '', true);

  insert into public.audit_review_log (actor_user_id, paper_id, question_id, action, before, after, note)
  values (v_uid, p_audit_paper_id, null, 'admin_approve',
          jsonb_build_object('approval_state', 'awaiting'),
          jsonb_build_object('approval_state', 'approved', 'kind', 'new', 'live_bank_paper_id', v_bank,
                             'questions_published', v_published, 'placeholders', v_placeholders,
                             'stems', (select count(*) from pg_temp.approval_leaves where passed and is_stem)),
          p_note);

  return v_bank;
end;
$function$;

revoke all on function public.admin_approve_paper(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_approve_paper(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. reject

create or replace function public.admin_reject_paper(p_audit_paper_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_p public.audit_papers;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_p from public.audit_papers where id = p_audit_paper_id for update;
  if v_p.id is null then
    raise exception 'Paper not found' using errcode = 'P0002';
  end if;
  if v_p.approval_state is distinct from 'awaiting' then
    raise exception 'This paper is not waiting for approval (%)', coalesce(v_p.approval_state, 'not in the queue')
      using errcode = '55000';
  end if;

  update public.audit_papers
     set approval_state = 'rejected', rejected_at = now(), rejected_by = v_uid, approval_note = p_note
   where id = p_audit_paper_id;

  insert into public.audit_review_log (actor_user_id, paper_id, question_id, action, before, after, note)
  values (v_uid, p_audit_paper_id, null, 'admin_reject',
          jsonb_build_object('approval_state', 'awaiting'),
          jsonb_build_object('approval_state', 'rejected'),
          p_note);
end;
$function$;

revoke all on function public.admin_reject_paper(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_reject_paper(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. unpublish (reversible: the bank_question_revisions row is the same
--     shape admin_hide_bank_paper writes, so admin_restore_bank_paper /
--     admin_undo_revision put it back)

create or replace function public.admin_unpublish_paper(p_bank_paper_id text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_published boolean;
  v_audit uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select bp.is_published into v_published from public.bank_papers bp where bp.id = p_bank_paper_id for update;
  if v_published is null then
    raise exception 'Paper not found' using errcode = 'P0002';
  end if;
  if not v_published then
    raise exception 'This paper is already off the site' using errcode = '55000';
  end if;

  select ap.id into v_audit
  from public.audit_papers ap
  where ap.live_bank_paper_id = p_bank_paper_id
  order by (ap.approval_state is not null) desc, ap.created_at desc
  limit 1;

  perform set_config('shikshaq.actor', coalesce(v_uid::text, 'admin'), true);
  perform set_config('shikshaq.source', 'admin', true);
  perform set_config('shikshaq.reason', coalesce(nullif(p_note, ''), 'unpublished by an admin'), true);
  update public.bank_papers set is_published = false where id = p_bank_paper_id;
  perform set_config('shikshaq.actor', '', true);
  perform set_config('shikshaq.source', '', true);
  perform set_config('shikshaq.reason', '', true);

  insert into public.bank_question_revisions
    (table_name, row_id, action, field, before, after, actor, actor_user_id, source, reason, audit_paper_id)
  values ('bank_papers', p_bank_paper_id, 'admin_hide', 'is_published', to_jsonb(true), to_jsonb(false),
          coalesce(v_uid::text, 'admin'), v_uid, 'admin', p_note, v_audit);

  insert into public.audit_review_log (actor_user_id, paper_id, question_id, action, field, before, after, note)
  values (v_uid, v_audit, null, 'admin_unpublish', 'is_published', to_jsonb(true), to_jsonb(false), p_note);
end;
$function$;

revoke all on function public.admin_unpublish_paper(text, text) from public, anon, authenticated;
grant execute on function public.admin_unpublish_paper(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. edit and revert: one internal path, a new version each time, the live
--     row updated in the same transaction

create or replace function public.approval_apply_question_change(
  p_question_id uuid, p_version integer, p_changes jsonb, p_note text, p_action text, p_extra jsonb default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
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
  if not public.is_admin() then
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

create or replace function public.admin_edit_question(
  p_question_id uuid, p_version integer, p_changes jsonb, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return public.approval_apply_question_change(p_question_id, p_version, p_changes, p_note, 'admin_edit', null);
end;
$function$;

revoke all on function public.admin_edit_question(uuid, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_edit_question(uuid, integer, jsonb, text) to authenticated;

create or replace function public.admin_revert_question(p_question_id uuid, p_to_version integer, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_q public.audit_questions;
  v_snap jsonb;
  v_changes jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_q from public.audit_questions where id = p_question_id;
  if v_q.id is null then
    raise exception 'Question not found' using errcode = 'P0002';
  end if;
  select v.snapshot into v_snap from public.content_versions v
  where v.table_name = 'audit_questions' and v.row_id = p_question_id::text
    and v.version = p_to_version and v.op <> 'delete'
  order by v.id desc limit 1;
  if v_snap is null then
    if p_to_version = v_q.version then
      return v_q.version;
    end if;
    raise exception 'Version % of this question was not found', p_to_version using errcode = 'P0002';
  end if;

  select jsonb_object_agg(f, v_snap -> f) into v_changes
  from unnest(array['body', 'display_number', 'marks', 'options', 'instructions', 'section_label', 'chapter',
                    'alternative_group', 'alternative_label', 'suggested_time_minutes']) f
  where v_snap ? f and (v_snap -> f) is distinct from (to_jsonb(v_q) -> f);
  if v_changes is null then
    return v_q.version;   -- already identical to that version
  end if;

  return public.approval_apply_question_change(p_question_id, v_q.version, v_changes, p_note, 'admin_revert',
                                               jsonb_build_object('restored_version', p_to_version));
end;
$function$;

revoke all on function public.admin_revert_question(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.admin_revert_question(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 14. history, as people

create or replace function public.admin_question_full_history(p_question_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_q public.audit_questions;
  v_versions jsonb;
  v_events jsonb;
  v_checks jsonb;
  v_readable constant text[] := array['body', 'display_number', 'marks', 'options', 'instructions',
                                      'section_label', 'chapter', 'alternative_label'];
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_q from public.audit_questions where id = p_question_id;
  if v_q.id is null then
    raise exception 'Question not found' using errcode = 'P0002';
  end if;

  -- Versions, oldest first. A row nobody has changed has no history rows:
  -- its current state is version 1, made by the pipeline when it loaded.
  with vs as (
    select v.id, v.version, v.op, v.snapshot, v.actor, v.actor_user_id, v.source, v.reason,
           case when v.op = 'backfill' and v.version = 1 then v_q.created_at else v.created_at end as created_at
    from public.content_versions v
    where v.table_name = 'audit_questions' and v.row_id = p_question_id::text and v.op <> 'delete'
  ),
  one_per_version as (
    select distinct on (vs.version) vs.* from vs order by vs.version, vs.id desc
  ),
  with_current as (
    select o.version, o.op, o.snapshot, o.actor, o.actor_user_id, o.reason, o.created_at from one_per_version o
    union all
    select v_q.version, 'insert', public.content_snapshot('audit_questions', to_jsonb(v_q)), 'system', null, null, v_q.created_at
    where not exists (select 1 from one_per_version o where o.version = v_q.version)
  ),
  ordered as (
    select w.*, lag(w.snapshot) over (order by w.version) as prev from with_current w
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'version', o.version,
           'is_current', o.version = v_q.version,
           'restored_from_version', (select (l.after ->> 'restored_version')::integer
                                       from public.audit_review_log l
                                      where l.question_id = p_question_id and l.action = 'admin_revert'
                                        and l.after ->> 'version' = o.version::text
                                      order by l.at desc limit 1),
           'created_at', o.created_at,
           'actor_name', w.who ->> 'name',
           'actor_kind', w.who ->> 'kind',
           'note', case when w.who ->> 'kind' in ('admin', 'student') then nullif(btrim(o.reason), '') end,
           'body', o.snapshot -> 'body',
           'options', o.snapshot -> 'options',
           'marks', o.snapshot -> 'marks',
           'display_number', o.snapshot -> 'display_number',
           'instructions', o.snapshot -> 'instructions',
           'section_label', o.snapshot -> 'section_label',
           'changes', case when o.prev is null then '[]'::jsonb else coalesce((
               select jsonb_agg(jsonb_build_object('field', f, 'before', o.prev -> f, 'after', o.snapshot -> f) order by n)
               from unnest(v_readable) with ordinality as t(f, n)
               where (o.prev -> f) is distinct from (o.snapshot -> f)), '[]'::jsonb) end
         ) order by o.version), '[]'::jsonb)
    into v_versions
  from ordered o
  cross join lateral (select case
                               when o.op = 'backfill' then jsonb_build_object('name', 'Pipeline (automatic)', 'kind', 'pipeline')
                               else public.history_actor(o.actor_user_id, o.actor, null) end as who) w;

  select coalesce(jsonb_agg(h.ev order by h.at desc, h.seq desc), '[]'::jsonb) into v_events
  from public.history_events(v_q.paper_id, p_question_id) h;

  select coalesce(jsonb_agg(jsonb_build_object(
           'at', k.created_at,
           'checker_kind', case when k.checker_kind in ('haiku_paddle', 'haiku_pdf') then 'haiku'
                                else k.checker_kind end,
           'model', k.model,
           'verdict', k.verdict,
           'confidence', k.confidence,
           'version_seen', k.version_seen,
           'actor_name', public.history_actor(k.actor_user_id,
                           case k.checker_kind when 'student' then 'checker' when 'admin' then 'admin' else k.checker_kind end,
                           k.model) ->> 'name')
         order by k.created_at desc, k.id desc), '[]'::jsonb)
    into v_checks
  from public.content_checks k
  where (k.table_name = 'audit_questions' and k.row_id = p_question_id::text)
     or (k.table_name = 'bank_questions' and v_q.live_bank_question_id is not null and k.row_id = v_q.live_bank_question_id);

  return jsonb_build_object(
    'question_id', v_q.id,
    'question_number', v_q.display_number,
    'current_version', v_q.version,
    'state', public.approval_question_state(v_q.kind, v_q.question_passed, v_q.set_aside_at),
    'versions', v_versions,
    'events', v_events,
    'checks', v_checks);
end;
$function$;

revoke all on function public.admin_question_full_history(uuid) from public, anon, authenticated;
grant execute on function public.admin_question_full_history(uuid) to authenticated;

create or replace function public.admin_paper_full_history(p_audit_paper_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_events jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.audit_papers ap where ap.id = p_audit_paper_id) then
    raise exception 'Paper not found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(x.ev order by x.at desc, x.seq desc), '[]'::jsonb) into v_events
  from (select h.at, h.seq, h.ev from public.history_events(p_audit_paper_id, null) h
        order by h.at desc, h.seq desc limit 2000) x;
  return jsonb_build_object('audit_paper_id', p_audit_paper_id, 'events', v_events);
end;
$function$;

revoke all on function public.admin_paper_full_history(uuid) from public, anon, authenticated;
grant execute on function public.admin_paper_full_history(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 15. question_review_state: admin-only (no rows unless is_admin())

create or replace view public.question_review_state as
  select q.id as question_id,
         q.paper_id,
         case
           when c.confidence is null then 'none'
           when c.confidence >= 0.9 then 'high'
           when c.confidence >= 0.75 then 'medium'
           else 'low'
         end as confidence_band,
         (q.checked_by_user is not null
          or exists (select 1 from public.content_checks k
                      where k.table_name = 'audit_questions' and k.row_id = q.id::text
                        and k.checker_kind in ('student', 'admin'))) as human_checked,
         case
           when q.question_passed then 'approved'
           when q.set_aside_at is not null or q.status = 'red' then 'rejected'
           else 'pending'
         end as final_verdict,
         (q.question_passed and q.set_aside_at is null and q.live_bank_question_id is null) as in_transit,
         exists (select 1 from public.bank_questions bq join public.bank_papers bp on bp.id = bq.paper_id
                  where bq.id = q.live_bank_question_id and bp.is_published) as published
  from public.audit_questions q
  left join lateral (
    select k.confidence from public.content_checks k
    where k.table_name = 'audit_questions' and k.row_id = q.id::text and k.confidence is not null
    order by k.created_at desc, k.id desc limit 1
  ) c on true
  where q.kind = 'question'
    and public.is_admin();

revoke all on public.question_review_state from public, anon, authenticated;
grant select on public.question_review_state to authenticated;

-- ---------------------------------------------------------------------------
-- 16. a checker's log, day by day (owner, 2026-10-02: "an admin page to see a
--     checker's log day wise in good english language visually")
--
-- Every actor who appears in audit_review_log, content_checks (AI looks
-- only; a person's own looks are already their log lines) or
-- bank_question_revisions, keyed by history_actor_key(): a person by their
-- uuid as text, the AI and the pipeline as pseudo-actors ('ai:sonnet',
-- 'ai:haiku', 'pipeline', ...). Names and roles come from the same helpers
-- as the paper and question history, so the wording matches.

create or replace function public.admin_checker_list()
returns table(actor_key text, name text, role text, first_at timestamptz, last_at timestamptz,
              total_actions integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- Group first, key second: only the AI log lines need a per-row look at
  -- their note and question; everything else collapses to a handful of
  -- groups before history_actor_key() runs.
  return query
    with keyed as (
      select l.actor_user_id::text as k, min(l.at) as f, max(l.at) as l, count(*) as n
      from public.audit_review_log l
      where l.actor_user_id is not null
      group by l.actor_user_id
      union all
      select 'pipeline', min(l.at), max(l.at), count(*)
      from public.audit_review_log l
      left join public.log_action_catalog c on c.action = l.action
      where l.actor_user_id is null and c.kind is distinct from 'ai'
      union all
      select public.history_actor_key(null, null, concat_ws(' ', l.note, q.checked_by)), min(l.at), max(l.at), count(*)
      from public.audit_review_log l
      join public.log_action_catalog c on c.action = l.action and c.kind = 'ai'
      left join public.audit_questions q on q.id = l.question_id
      where l.actor_user_id is null
      group by 1
      union all
      select public.history_actor_key(g.actor_user_id, g.checker_kind, g.model), min(g.f), max(g.l), sum(g.n)
      from (select k.actor_user_id, k.checker_kind, k.model, min(k.created_at) as f, max(k.created_at) as l, count(*) as n
            from public.content_checks k
            where k.checker_kind not in ('student', 'admin')
            group by 1, 2, 3) g
      group by 1
      union all
      select public.history_actor_key(g.actor_user_id, g.actor, null), min(g.f), max(g.l), sum(g.n)
      from (select r.actor_user_id, r.actor, min(r.created_at) as f, max(r.created_at) as l, count(*) as n
            from public.bank_question_revisions r
            group by 1, 2) g
      group by 1
    ),
    agg as (
      select kd.k, min(kd.f) as f, max(kd.l) as l, sum(kd.n)::integer as n
      from keyed kd
      where kd.n > 0
      group by kd.k
    )
    select a.k, w.who ->> 'name', w.who ->> 'kind', a.f, a.l, a.n
    from agg a
    cross join lateral (select public.history_actor_from_key(a.k) as who) w
    order by a.l desc, a.k;
end;
$function$;

revoke all on function public.admin_checker_list() from public, anon, authenticated;
grant execute on function public.admin_checker_list() to authenticated;

-- p_from / p_to are Asia/Kolkata calendar days, inclusive. Defaults: the
-- last 30 days ending today. At most 90 days (an older p_from is moved up)
-- and the newest 5000 lines; the day counts always cover the whole range.
create or replace function public.admin_checker_day_log(p_actor_key text, p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
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
    select 'log'::text as src, l.id, l.at, case when c.action is not null then l.action else 'other' end as code
    from public.audit_review_log l
    left join public.log_action_catalog c on c.action = l.action
    where v_uid is not null and l.actor_user_id = v_uid and l.at >= v_start and l.at < v_end
    union all
    -- a pseudo-actor: rows with no person, keyed the same way as everywhere else
    select 'log', l.id, l.at, case when c.action is not null then l.action else 'other' end
    from public.audit_review_log l
    left join public.log_action_catalog c on c.action = l.action
    left join public.audit_questions q on c.kind = 'ai' and q.id = l.question_id
    where v_uid is null and l.actor_user_id is null and l.at >= v_start and l.at < v_end
      and (v_key not like 'ai:%' or c.kind = 'ai')
      and public.history_actor_key(null, null,
            case when c.kind = 'ai' then concat_ws(' ', l.note, q.checked_by) end) = v_key
    union all
    select 'rev', r.id, r.created_at, case when c.action is not null then r.action else 'other' end
    from public.bank_question_revisions r
    left join public.log_action_catalog c on c.action = r.action
    where r.created_at >= v_start and r.created_at < v_end
      and public.history_actor_key(r.actor_user_id, r.actor, null) = v_key
    union all
    select 'check', k.id, k.created_at, 'check_' || k.verdict
    from public.content_checks k
    where k.created_at >= v_start and k.created_at < v_end
      and k.checker_kind not in ('student', 'admin')
      and public.history_actor_key(k.actor_user_id, k.checker_kind, k.model) = v_key
  ),
  coded as (
    select r.*, (r.at at time zone 'Asia/Kolkata')::date as day, public.history_action_bucket(r.code) as bucket
    from raw r
  ),
  day_counts as (
    select cd.day,
           jsonb_build_object(
             'passed', count(*) filter (where cd.bucket = 'passed'),
             'fixed', count(*) filter (where cd.bucket = 'fixed'),
             'set_aside', count(*) filter (where cd.bucket = 'set_aside'),
             'flagged', count(*) filter (where cd.bucket = 'flagged'),
             'edited', count(*) filter (where cd.bucket = 'edited'),
             'approved', count(*) filter (where cd.bucket = 'approved'),
             'other', count(*) filter (where cd.bucket = 'other')) as counts,
           count(*) as n
    from coded cd
    group by cd.day
  ),
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

revoke all on function public.admin_checker_day_log(text, date, date) from public, anon, authenticated;
grant execute on function public.admin_checker_day_log(text, date, date) to authenticated;
