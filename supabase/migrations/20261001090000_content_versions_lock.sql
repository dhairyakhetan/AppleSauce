-- 20261001090000_content_versions_lock.sql
--
-- Round 24 item B (owner 2026-09-30): every question and paper gets a version
-- number, a full history of its content, a content fingerprint per version,
-- a lock so two writers (AI, a student checker, an admin) can never silently
-- overwrite each other, and a revert to any specific version.
--
-- What this adds
--   1. `version integer not null default 1` on bank_questions, bank_papers,
--      audit_questions, audit_papers. ADD COLUMN with a constant default is a
--      catalog-only change: no row is rewritten and no UPDATE trigger fires
--      (audit_papers_apply_to_live in particular stays untouched).
--   2. content_version_fields: the ONE list of which columns count as content
--      per table. Lease, status and timestamp columns are deliberately out, so
--      a checker opening a question does not mint a version.
--   3. content_versions: one row per version of a row -- the full snapshot of
--      its content fields, the sha256 of that snapshot, who and why.
--   4. Triggers, built from content_version_fields so the list lives once:
--      content_version (BEFORE INSERT, BEFORE UPDATE OF version + the content
--      columns): on insert the version is 1 (or carries on after a delete); on
--      update it is pinned to OLD.version, +1 only when the content snapshot
--      actually changed, so callers cannot set it themselves. Lease and status
--      updates never reach it.
--      content_version_log (AFTER INSERT / DELETE, AFTER UPDATE WHEN the
--      version moved) writes the history row. Who/why come from
--      transaction-local settings shikshaq.actor / .source / .reason / .op,
--      else auth.uid(). A clash on the history key raises: silent gaps in the
--      history would defeat its purpose.
--   5. apply_fix_locked(): the ONLY writer the new AI flow uses. Optimistic
--      lock: the caller names the version it read; if the row moved on (or no
--      version was named) it raises and writes nothing. Service side only.
--   6. admin_revert_to_version(): admin only; writes a chosen version's
--      snapshot back, which becomes a new version (history is never
--      rewritten). Refuses when the row no longer exists (deleted rows go back
--      through admin_undo_revision, which already handles that).
--   7. admin_content_versions(): admin only; the history for the admin debug
--      toggle and the question-history panel.
--   8. content_checks + admin_content_checks(): every look at a question (AI,
--      student, admin) with the version it saw, verdict, confidence, G1-G8.
--
-- No upfront backfill: an existing row's starting state is written the first
-- time it changes (op='backfill', by the log trigger). Rehearsed 2026-09-30:
-- a full backfill took 51 s and 133 MB on a 258 MB database, and the project
-- is on the 500 MB free plan. This way history grows only with real edits,
-- and the tables are locked for about 0.2 s.
--
-- Security (CLAUDE.md "the trap"): every new function is revoked from PUBLIC,
-- anon AND authenticated by name, then granted back only where meant.
-- content_versions and content_version_fields have RLS on, no policies, no
-- grants: only SECURITY DEFINER functions and the service role read them
-- (snapshots include bank_questions.answer_key, which is never exposed).
--
-- Visible side effect: bank_papers is table-granted to anon, so its new
-- `version` column appears in select('*') for everyone. It is an integer with
-- no content in it; nothing else becomes readable.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. version columns

alter table public.bank_questions  add column if not exists version integer not null default 1;
alter table public.bank_papers     add column if not exists version integer not null default 1;
alter table public.audit_questions add column if not exists version integer not null default 1;
alter table public.audit_papers    add column if not exists version integer not null default 1;

-- ---------------------------------------------------------------------------
-- 2. which columns are content

create table if not exists public.content_version_fields (
  table_name text primary key
    check (table_name in ('bank_questions', 'bank_papers', 'audit_questions', 'audit_papers')),
  fields text[] not null
);

insert into public.content_version_fields (table_name, fields) values
  ('bank_questions', array[
    'paper_id', 'ord', 'number', 'body', 'marks', 'chapter', 'qtype', 'page', 'figure', 'options',
    'display_number', 'instructions', 'suggested_time_minutes', 'chapter_from_paper', 'answer_key',
    'alternative_group', 'alternative_label', 'section_label', 'syllabus_ref', 'parent_question_id']),
  ('bank_papers', array[
    'school_raw', 'school', 'is_board_paper', 'year', 'exam', 'cls', 'subject', 'board',
    'question_count', 'marks', 'is_published', 'has_school', 'needs_review',
    'allowed_time_minutes', 'general_instructions', 'incomplete_note']),
  ('audit_questions', array[
    'paper_id', 'ord', 'kind', 'parent_id', 'section_label', 'number_path', 'display_number',
    'instructions', 'body', 'options', 'marks', 'suggested_time_minutes', 'chapter',
    'chapter_from_paper', 'syllabus_ref', 'qtype', 'answer_key', 'figure', 'alternative_group',
    'alternative_label', 'affordances']),
  ('audit_papers', array[
    'live_bank_paper_id', 'fingerprint', 'pdf_path', 'board', 'class', 'subject', 'school',
    'exam_type', 'year', 'title', 'max_marks', 'allowed_time_minutes', 'instructions', 'page_count'])
on conflict (table_name) do update set fields = excluded.fields;

alter table public.content_version_fields enable row level security;
revoke all on table public.content_version_fields from public, anon, authenticated;

-- Every listed field must exist, or a typo would silently drop it from history.
do $$
declare r record; v_missing text;
begin
  for r in select table_name, fields from public.content_version_fields loop
    select string_agg(f, ', ') into v_missing
    from unnest(r.fields) f
    where not exists (
      select 1 from pg_attribute a
      where a.attrelid = ('public.' || r.table_name)::regclass and a.attname = f
        and a.attnum > 0 and not a.attisdropped);
    if v_missing is not null then
      raise exception 'content_version_fields.%: no such column(s): %', r.table_name, v_missing;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. history

create table if not exists public.content_versions (
  id bigserial primary key,
  table_name text not null
    check (table_name in ('bank_questions', 'bank_papers', 'audit_questions', 'audit_papers')),
  row_id text not null,
  version integer not null,
  op text not null check (op in ('backfill', 'insert', 'update', 'delete', 'revert')),
  content_sha256 text not null,
  snapshot jsonb not null,
  actor text,                -- 'ai:haiku' | 'ai:sonnet' | 'checker' | 'admin' | a user id | 'system'
  actor_user_id uuid,
  source text,               -- from shikshaq.source, e.g. 'ai-check', 'checker', 'admin', 'import'
  reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists content_versions_row_version_idx
  on public.content_versions (table_name, row_id, version, op);
create index if not exists content_versions_row_idx
  on public.content_versions (table_name, row_id, version desc);
create index if not exists content_versions_created_idx
  on public.content_versions (created_at desc);

alter table public.content_versions enable row level security;
revoke all on table public.content_versions from public, anon, authenticated;
revoke all on sequence public.content_versions_id_seq from public, anon, authenticated;

comment on table public.content_versions is
  'One row per version of a bank_/audit_ question or paper: the full snapshot of its content fields (content_version_fields), sha256 of that snapshot, who and why. A row''s state before its first recorded change is op=backfill. Read only through admin_content_versions(); snapshots include answer_key.';

-- ---------------------------------------------------------------------------
-- 4. snapshot + fingerprint helpers

create or replace function public.content_snapshot(p_table text, p_row jsonb)
 returns jsonb
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(jsonb_object_agg(f, p_row -> f), '{}'::jsonb)
  from public.content_version_fields cvf, unnest(cvf.fields) f
  where cvf.table_name = p_table;
$function$;

-- jsonb text output is canonical (keys sorted, whitespace fixed), so equal
-- content always hashes equal. No search_path: everything is pg_catalog.
create or replace function public.content_sha256(p_snapshot jsonb)
 returns text
 language sql
 immutable
as $function$
  select encode(sha256(convert_to(p_snapshot::text, 'UTF8')), 'hex');
$function$;

create or replace function public.trg_content_version()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    -- 1 for a new row; a row put back after a delete (admin_undo_revision)
    -- carries on from its last version instead of reusing old numbers.
    new.version := coalesce((select max(v.version) from public.content_versions v
                             where v.table_name = tg_table_name and v.row_id = to_jsonb(new) ->> 'id'), 0) + 1;
  elsif public.content_snapshot(tg_table_name, to_jsonb(new))
        is distinct from public.content_snapshot(tg_table_name, to_jsonb(old)) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$function$;

create or replace function public.trg_content_version_log()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_snap jsonb;
  v_op text;
  v_uid uuid;
begin
  v_snap := public.content_snapshot(tg_table_name, v_row);
  v_op := case tg_op when 'INSERT' then 'insert' when 'DELETE' then 'delete' else
            coalesce(nullif(current_setting('shikshaq.op', true), ''), 'update') end;
  begin
    v_uid := auth.uid();
  exception when others then   -- a malformed claim must not block a write
    v_uid := null;
  end;
  -- Lazy starting point: the first time an existing row changes, its state
  -- before that change is recorded as op='backfill'. (An upfront backfill of
  -- all 120k rows measured 133 MB on a 258 MB database on the 500 MB free plan.)
  if tg_op <> 'INSERT' and not exists (
       select 1 from public.content_versions v
       where v.table_name = tg_table_name and v.row_id = v_row ->> 'id') then
    insert into public.content_versions
      (table_name, row_id, version, op, content_sha256, snapshot, actor, source, reason)
    select tg_table_name, o.j ->> 'id', (o.j ->> 'version')::integer, 'backfill',
           public.content_sha256(o.s), o.s, 'system', 'backfill', 'state before its first recorded change'
    from (select to_jsonb(old) j, public.content_snapshot(tg_table_name, to_jsonb(old)) s) o;
  end if;
  insert into public.content_versions
    (table_name, row_id, version, op, content_sha256, snapshot, actor, actor_user_id, source, reason)
  values
    (tg_table_name, v_row ->> 'id', (v_row ->> 'version')::integer, v_op, public.content_sha256(v_snap), v_snap,
     coalesce(nullif(current_setting('shikshaq.actor', true), ''), v_uid::text, 'system'),
     v_uid,
     nullif(current_setting('shikshaq.source', true), ''),
     nullif(current_setting('shikshaq.reason', true), ''));
  return null;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. triggers, column lists read from content_version_fields
--    ("update of" must name version too, or SET version = 99 would slip past)

do $$
declare r record; v_cols text;
begin
  for r in select table_name, fields from public.content_version_fields loop
    select string_agg(quote_ident(f), ', ') into v_cols from unnest(r.fields || array['version']) f;
    execute format('drop trigger if exists content_version_ins on public.%I', r.table_name);
    execute format('create trigger content_version_ins before insert on public.%I '
                   'for each row execute function public.trg_content_version()', r.table_name);
    execute format('drop trigger if exists content_version_upd on public.%I', r.table_name);
    execute format('create trigger content_version_upd before update of %s on public.%I '
                   'for each row execute function public.trg_content_version()', v_cols, r.table_name);
    execute format('drop trigger if exists content_version_log_ins on public.%I', r.table_name);
    execute format('create trigger content_version_log_ins after insert on public.%I '
                   'for each row execute function public.trg_content_version_log()', r.table_name);
    execute format('drop trigger if exists content_version_log_upd on public.%I', r.table_name);
    execute format('create trigger content_version_log_upd after update on public.%I '
                   'for each row when (old.version is distinct from new.version) '
                   'execute function public.trg_content_version_log()', r.table_name);
    execute format('drop trigger if exists content_version_log_del on public.%I', r.table_name);
    execute format('create trigger content_version_log_del after delete on public.%I '
                   'for each row execute function public.trg_content_version_log()', r.table_name);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. the locked writer

-- p_changes: {"field": new value, ...} with values as JSON (a string body is
-- "text", marks is 4, options is ["a","b"]). Only content fields are allowed.
-- Returns the new version (the same version when nothing actually changed).
create or replace function public.apply_fix_locked(
  p_table text, p_row_id text, p_expected_version integer, p_changes jsonb,
  p_actor text, p_source text, p_reason text DEFAULT NULL)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_fields text[];
  v_bad text;
  v_current integer;
  v_set text;
  v_new integer;
  v_key_type text;
begin
  select fields into v_fields from public.content_version_fields where table_name = p_table;
  if v_fields is null then
    raise exception 'apply_fix_locked: unknown table %', p_table using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'apply_fix_locked: p_changes must be a non-empty object' using errcode = '22023';
  end if;
  select string_agg(k, ', ') into v_bad from jsonb_object_keys(p_changes) k where not (k = any (v_fields));
  if v_bad is not null then
    raise exception 'apply_fix_locked: not content field(s) of %: %', p_table, v_bad using errcode = '22023';
  end if;
  if p_expected_version is null or coalesce(p_actor, '') = '' or coalesce(p_source, '') = '' then
    raise exception 'apply_fix_locked: expected version, actor and source are required' using errcode = '22023';
  end if;

  v_key_type := case when p_table like 'audit_%' then 'uuid' else 'text' end;
  execute format('select version from public.%I where id = $1::%s for update', p_table, v_key_type)
    into v_current using p_row_id;
  if v_current is null then
    raise exception 'apply_fix_locked: % % not found', p_table, p_row_id using errcode = 'P0002';
  end if;
  if v_current is distinct from p_expected_version then
    raise exception 'apply_fix_locked: % % is at version %, not % -- re-read it and decide again',
      p_table, p_row_id, v_current, p_expected_version using errcode = '40001';
  end if;

  -- typed assignment through jsonb_populate_record: only the named keys are set
  select string_agg(format('%I = r.%I', k, k), ', ') into v_set from jsonb_object_keys(p_changes) k;

  perform set_config('shikshaq.actor', p_actor, true);
  perform set_config('shikshaq.source', p_source, true);
  perform set_config('shikshaq.reason', coalesce(p_reason, ''), true);
  perform set_config('shikshaq.op', 'update', true);
  execute format(
    'update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I, $1) r '
    'where t.id = $2::%3$s returning t.version', p_table, v_set, v_key_type)
    into v_new using p_changes, p_row_id;
  perform set_config('shikshaq.actor', '', true);
  perform set_config('shikshaq.source', '', true);
  perform set_config('shikshaq.reason', '', true);
  perform set_config('shikshaq.op', '', true);
  return v_new;
end;
$function$;

revoke all on function public.apply_fix_locked(text, text, integer, jsonb, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. revert to a specific version (admin)

create or replace function public.admin_revert_to_version(
  p_table text, p_row_id text, p_version integer, p_reason text DEFAULT NULL)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_snap jsonb;
  v_fields text[];
  v_set text;
  v_new integer;
  v_key_type text;
  v_current integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select fields into v_fields from public.content_version_fields where table_name = p_table;
  if v_fields is null then
    raise exception 'Unknown table %', p_table using errcode = '22023';
  end if;
  select snapshot into v_snap from public.content_versions
  where table_name = p_table and row_id = p_row_id and version = p_version and op <> 'delete'
  order by id desc limit 1;
  if v_snap is null then
    raise exception 'Version % of % % not found', p_version, p_table, p_row_id using errcode = 'P0002';
  end if;

  v_key_type := case when p_table like 'audit_%' then 'uuid' else 'text' end;
  execute format('select version from public.%I where id = $1::%s for update', p_table, v_key_type)
    into v_current using p_row_id;
  if v_current is null then
    raise exception 'This row was deleted; bring it back with admin_undo_revision first' using errcode = 'P0002';
  end if;

  -- only fields the snapshot carries: a field added to the list later is left alone
  select string_agg(format('%I = r.%I', f, f), ', ') into v_set
  from unnest(v_fields) f where v_snap ? f;
  perform set_config('shikshaq.actor', coalesce(auth.uid()::text, 'admin'), true);
  perform set_config('shikshaq.source', 'admin', true);
  perform set_config('shikshaq.reason',
    coalesce(nullif(p_reason, ''), 'revert to version ' || p_version::text), true);
  perform set_config('shikshaq.op', 'revert', true);
  execute format(
    'update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I, $1) r '
    'where t.id = $2::%3$s returning t.version', p_table, v_set, v_key_type)
    into v_new using v_snap, p_row_id;
  perform set_config('shikshaq.op', '', true);
  perform set_config('shikshaq.actor', '', true);
  perform set_config('shikshaq.source', '', true);
  perform set_config('shikshaq.reason', '', true);
  return v_new;
end;
$function$;

revoke all on function public.admin_revert_to_version(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.admin_revert_to_version(text, text, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. history read (admin)

create or replace function public.admin_content_versions(p_table text, p_row_id text)
 returns table (version integer, op text, content_sha256 text, snapshot jsonb, actor text,
                actor_user_id uuid, source text, reason text, created_at timestamptz)
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select v.version, v.op, v.content_sha256, v.snapshot, v.actor, v.actor_user_id, v.source, v.reason, v.created_at
    from public.content_versions v
    where v.table_name = p_table and v.row_id = p_row_id
    order by v.version desc, v.id desc;
end;
$function$;

revoke all on function public.admin_content_versions(text, text) from public, anon, authenticated;
grant execute on function public.admin_content_versions(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. every look at a question: which version was seen, by whom, what it found

create table if not exists public.content_checks (
  id bigserial primary key,
  table_name text not null
    check (table_name in ('bank_questions', 'bank_papers', 'audit_questions', 'audit_papers')),
  row_id text not null,
  version_seen integer not null,
  checker_kind text not null check (checker_kind in ('haiku_paddle', 'haiku_pdf', 'sonnet', 'student', 'admin')),
  model text,                 -- models.json name for AI looks, null for people
  actor_user_id uuid,
  verdict text not null check (verdict in ('pass', 'fix', 'printed_typo', 'escalate', 'flag')),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  guardrails jsonb,           -- {"G1": {"ok": true}, "G4": {"ok": false, "why": "..."}, ...}
  proposed_changes jsonb,     -- what the looker would change, as apply_fix_locked p_changes
  applied_version integer,    -- the version its change produced, when one was applied
  batch_id text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists content_checks_row_idx on public.content_checks (table_name, row_id, created_at desc);
create index if not exists content_checks_batch_idx on public.content_checks (batch_id);

alter table public.content_checks enable row level security;
revoke all on table public.content_checks from public, anon, authenticated;
revoke all on sequence public.content_checks_id_seq from public, anon, authenticated;

comment on table public.content_checks is
  'One row per look at a question or paper (two Haikus, Sonnet, a student checker, an admin): the version it saw, its verdict and confidence, guardrail results G1-G8, the change it proposed and the version that change produced. Written by the service role (AI flow) and by checker/admin functions; read through admin_content_checks().';

create or replace function public.admin_content_checks(p_table text, p_row_id text)
 returns setof public.content_checks
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select * from public.content_checks c
    where c.table_name = p_table and c.row_id = p_row_id
    order by c.created_at desc, c.id desc;
end;
$function$;

revoke all on function public.admin_content_checks(text, text) from public, anon, authenticated;
grant execute on function public.admin_content_checks(text, text) to authenticated;

-- helpers and trigger functions: nobody calls these directly
revoke all on function public.content_snapshot(text, jsonb) from public, anon, authenticated;
revoke all on function public.content_sha256(jsonb) from public, anon, authenticated;
revoke all on function public.trg_content_version() from public, anon, authenticated;
revoke all on function public.trg_content_version_log() from public, anon, authenticated;

commit;
