-- Paper checker (Kid Mode) + Paper admin -- W1.
--
-- Builds on the already-applied audit_* staging schema (auditor/db/001-009,
-- see UnlimitedOCR/auditor/db and CLAUDE.md's security model). This
-- migration:
--   1. adds new live columns to bank_papers/bank_questions
--      (proposed_live_migration.sql's slice, plus bank_papers.incomplete_note
--      per owner decision D29)
--   2. adds a paper_checkers allowlist table + is_paper_checker()
--   3. adds bank_question_revisions -- one row per change to a LIVE
--      question/paper field, with before/after jsonb, so any live change
--      (human or AI) can be rolled back
--   4. adds the chokepoint: apply_live_copy_paper_to_live(), fired by a
--      trigger when audit_papers.paper_passed flips true for
--      source='live_copy'. This is the ONLY path that writes bank_questions/
--      bank_papers on behalf of the review pipeline.
--   5. adds checker RPCs (SECURITY DEFINER, each checks is_paper_checker())
--   6. adds a storage.objects SELECT policy on the private 'audit-figures'
--      bucket for paper checkers and admins
--   7. adds admin RPCs (SECURITY DEFINER, each checks is_admin())
--   8. locks every new function down per CLAUDE.md's "trap": revoke from
--      PUBLIC and from anon/authenticated BY ROLE NAME (Supabase's
--      alter default privileges re-grants EXECUTE to those roles by name on
--      every new function), then grant execute to authenticated only,
--      where the function body itself checks the caller's permission.
--
-- HARD RULE preserved from the audit_* migrations: this file never grants
-- anon/authenticated direct table access to audit_* beyond what already
-- exists (still service-role only). The new checker/admin RPCs are the only
-- way authenticated users reach audit_* data, and only when
-- is_paper_checker()/is_admin() says so.
--
-- Idempotent: every object uses IF NOT EXISTS / CREATE OR REPLACE / DROP...
-- IF EXISTS so this file can be re-run safely.

begin;

-- ============================================================
-- 1. New live columns (proposed_live_migration.sql's slice + D29)
-- ============================================================

alter table public.bank_papers
  add column if not exists allowed_time_minutes integer,
  add column if not exists general_instructions text,
  add column if not exists incomplete_note text;

comment on column public.bank_papers.incomplete_note is
  'D29: shown to a reader when the paper is missing pages/questions but the readable part was published anyway. Null = paper is complete. Never invents missing content; just discloses the gap.';

alter table public.bank_questions
  add column if not exists display_number text,
  add column if not exists instructions text,
  add column if not exists suggested_time_minutes numeric,
  add column if not exists chapter_from_paper boolean not null default false,
  add column if not exists answer_key text,
  add column if not exists alternative_group text,
  add column if not exists alternative_label text,
  add column if not exists section_label text,
  add column if not exists syllabus_ref text,
  add column if not exists parent_question_id text
    references public.bank_questions (id) on delete set null;

-- bank_paper_questions() must keep the LIVE behaviour byte-for-byte
-- (owner decisions D36-D38) and only append the new columns. Confirmed by
-- reading the live definition directly (pg_get_functiondef, project
-- uvtifolnsneitetzohtn, read-only SELECT, 2026-09-28 -- see W1's log note
-- for the exact query and result): plpgsql, SECURITY DEFINER,
-- `set search_path to 'public', 'extensions'`, records a read_events row
-- for a signed-in reader (kind='paper', target_id=p_paper_id, ip_hash from
-- the x-forwarded-for header), filters `is_published and not
-- needs_review`, and limits a signed-out reader to **2** rows, not 5 (the
-- free-preview gate moved from 5 to 2 on 2026-09-18 -- src/lib/free-preview.ts
-- -- this function had already been updated live to match, and the version
-- previously committed in this migration had silently regressed that back
-- to 5; fixed here to match the confirmed-live text exactly).
--
-- A RETURNS TABLE column-list change is not something CREATE OR REPLACE can
-- do -- DROP FUNCTION first, in the same transaction, then re-create with
-- security definer restated explicitly (CREATE OR REPLACE does not inherit
-- it) and all three revoke/grant lines re-run every time, per CLAUDE.md's
-- documented trap. Dependency check performed (read-only, same session):
--   select pg_describe_object(classid, objid, objsubid), deptype
--   from pg_depend where refobjid = 'public.bank_paper_questions(text)'::regprocedure;
-- returned zero rows live -- nothing else in the database references this
-- function by OID, so the drop is safe. `bank_questions.marks` and
-- `bank_papers.marks` were also checked directly and are already `numeric`
-- live (see MEDIUM fix 8's note below) -- this function's signature did not
-- need a cast for that reason, but the new numeric columns below do line up
-- with what marks already is.
drop function if exists public.bank_paper_questions(text);

create function public.bank_paper_questions(p_paper_id text)
 returns table(
   id text, paper_id text, number text, body text, marks numeric, chapter text,
   qtype text, page integer, figure text, options text[],
   display_number text, instructions text, suggested_time_minutes numeric,
   chapter_from_paper boolean, answer_key text, alternative_group text,
   alternative_label text, section_label text
 )
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
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
    select q.id, q.paper_id, q.number, q.body, q.marks, q.chapter,
           q.qtype, q.page, q.figure, q.options,
           q.display_number, q.instructions, q.suggested_time_minutes,
           q.chapter_from_paper, q.answer_key, q.alternative_group,
           q.alternative_label, q.section_label
    from public.bank_questions q
    join public.bank_papers p on p.id = q.paper_id
    where q.paper_id = p_paper_id
      and p.is_published
      and not p.needs_review
    order by q.ord
    limit case when v_uid is null then 2 else null end;
end;
$function$;

revoke all on function public.bank_paper_questions(text) from public;
revoke all on function public.bank_paper_questions(text) from anon;
revoke all on function public.bank_paper_questions(text) from authenticated;
grant execute on function public.bank_paper_questions(text) to anon, authenticated;

-- ============================================================
-- 2. paper_checkers -- who may open Kid Mode. Admin-granted only.
-- ============================================================
create table if not exists public.paper_checkers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  active boolean not null default true,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

comment on table public.paper_checkers is
  'Allowlist of accounts (D8: real Shikshaq students the owner approves) permitted to open the paper-checker (Kid Mode) page. Admin-granted/revoked only, never self-service.';

alter table public.paper_checkers enable row level security;

-- A signed-in user may read their OWN row (so the client can decide whether
-- to show the checker nav item without a round trip through an RPC). No
-- other direct access; everything else goes through the RPCs below.
drop policy if exists "users can read their own checker row" on public.paper_checkers;
create policy "users can read their own checker row"
  on public.paper_checkers for select to authenticated
  using (user_id = auth.uid());

revoke all on public.paper_checkers from public, anon, authenticated;
grant select on public.paper_checkers to authenticated;

create index if not exists paper_checkers_active_idx on public.paper_checkers (active);

-- is_paper_checker(): mirrors is_admin()'s shape exactly (SQL, SECURITY
-- DEFINER, STABLE) so both checks compose the same way inside every new
-- RPC below. An admin is always implicitly allowed the checker RPCs too
-- (D22's admin capabilities are a superset of the checker's).
create or replace function public.is_paper_checker()
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $$
  select public.is_admin() or exists (
    select 1 from public.paper_checkers pc
    where pc.user_id = auth.uid() and pc.active
  );
$$;

revoke all on function public.is_paper_checker() from public;
revoke all on function public.is_paper_checker() from anon;
revoke all on function public.is_paper_checker() from authenticated;
grant execute on function public.is_paper_checker() to authenticated;

comment on function public.is_paper_checker() is
  'True for an active paper_checkers row OR an admin. Used by every checker RPC as the authorization check (CLAUDE.md security model: never rely on a client-side flag).';

-- ============================================================
-- 3. bank_question_revisions -- one row per LIVE-table change (chokepoint,
--    or a direct admin edit), before/after jsonb, rollback-capable.
-- ============================================================
create table if not exists public.bank_question_revisions (
  id bigserial primary key,
  table_name text not null check (table_name in ('bank_papers', 'bank_questions')),
  row_id text not null,
  -- Naming contract set by the orchestrator (owner dashboard reads these):
  -- admin_* for a direct admin edit/structural change/undo/role change,
  -- live_apply (one row per live field changed) and live_clear (one row per
  -- paper's needs_review cleared) for the chokepoint.
  action text not null check (action in (
    'admin_edit', 'admin_merge', 'admin_split', 'admin_reorder', 'admin_add',
    'admin_delete', 'admin_hide', 'admin_restore', 'admin_undo',
    'live_apply', 'live_clear'
  )),
  field text,                 -- null for whole-row actions (add/delete/merge/split)
  before jsonb,
  after jsonb,
  actor text not null,        -- 'ai:haiku' | 'ai:sonnet' | a user id (as text) | 'system:chokepoint'
  actor_user_id uuid references auth.users (id) on delete set null,
  source text not null check (source in ('checker', 'admin', 'ai', 'system')),
  reason text,
  audit_paper_id uuid,        -- the audit_papers row this came from, when source-tracked
  audit_question_id uuid,     -- the audit_questions row this came from, when applicable
  created_at timestamptz not null default now()
);

comment on table public.bank_question_revisions is
  'One row per change to a live bank_papers/bank_questions field, or a structural change (merge/split/reorder/add/delete/hide/restore). before/after are the full prior/new value for `field` (or the full row for whole-row actions) so any change can be rolled back via admin_undo_revision(). This is the ONLY table that logs writes to the live tables; audit_review_log (existing, service-role only) separately logs actions taken on the audit_* staging copy.';

create index if not exists bank_question_revisions_row_idx
  on public.bank_question_revisions (table_name, row_id);
create index if not exists bank_question_revisions_created_at_idx
  on public.bank_question_revisions (created_at desc);
create index if not exists bank_question_revisions_actor_user_idx
  on public.bank_question_revisions (actor_user_id);

alter table public.bank_question_revisions enable row level security;

drop policy if exists "admins read revisions" on public.bank_question_revisions;
create policy "admins read revisions"
  on public.bank_question_revisions for select to authenticated
  using (public.is_admin());

-- Append-only via RLS: no insert/update/delete policy for any client role.
-- Every write goes through SECURITY DEFINER functions below, which run as
-- the function owner and so bypass RLS -- the same append-only shape as
-- admin_audit_log, but written through functions instead of a direct insert
-- policy because these writes always happen alongside a live-table write in
-- the same function.
revoke all on public.bank_question_revisions from public, anon, authenticated;
grant select on public.bank_question_revisions to authenticated;
revoke all on sequence public.bank_question_revisions_id_seq from public, anon, authenticated;

-- ============================================================
-- 3a. audit_review_log gets a real actor_user_id column (Supabase auth
--     user), alongside the existing `reviewer_id` (which stays for the
--     legacy standalone auditor's name+PIN accounts, audit_reviewers --
--     D11 retires that app but its historic rows keep their meaning).
--     Contract with the owner dashboard: dashboard joins actor_user_id to
--     public.profiles.id and reads public.profiles.full_name for a display
--     name (falling back to the auth user's email when full_name is null,
--     same fallback pattern already used throughout src/, e.g.
--     admin/papers.tsx's `profile?.full_name || user?.email`).
-- ============================================================
alter table public.audit_review_log
  add column if not exists actor_user_id uuid references auth.users (id) on delete set null;

create index if not exists audit_review_log_actor_user_idx on public.audit_review_log (actor_user_id);

comment on column public.audit_review_log.actor_user_id is
  'The Shikshaq (Supabase auth) user who took this action -- paper checkers and admins. Null for legacy audit_reviewers (name+PIN) rows and for system/AI actions. Dashboard: join to public.profiles.id, display public.profiles.full_name (fallback to the auth user''s email).';

-- ============================================================
-- 4. review_bucket gets a fourth value: 'escalated' (D16/D21 -- "ask for
--    help", never "can't fix"; never turns the paper red).
-- ============================================================
alter table public.audit_questions drop constraint if exists audit_questions_review_bucket_check;
alter table public.audit_questions add constraint audit_questions_review_bucket_check
  check (review_bucket in ('kid', 'admin', 'data', 'renderer', 'none', 'escalated'));

-- checked_by: keep the legacy single-model values and accept the logging
-- contract's model-pair form ('ai:haiku+haiku', 'ai:haiku+sonnet'). The live
-- constraint (checked 2026-09-28) allowed only haiku/sonnet/gap_audit, which
-- would have refused every AI approval written in the contract's format.
alter table public.audit_questions drop constraint if exists audit_questions_checked_by_check;
alter table public.audit_questions add constraint audit_questions_checked_by_check
  check (checked_by is null or checked_by in ('haiku', 'sonnet', 'gap_audit')
         or checked_by ~ '^ai:(haiku|sonnet)(\+(haiku|sonnet))?$');

-- A short lease so two checkers can't both be handed the same question by
-- checker_next_question(). Cleared automatically once the question is no
-- longer 'flagged' by the existing audit_questions triggers -- not relied on
-- here; checker_next_question() just skips any row whose lease hasn't
-- expired.
alter table public.audit_questions
  add column if not exists locked_by uuid references auth.users (id) on delete set null,
  add column if not exists locked_until timestamptz;

create index if not exists audit_questions_lock_idx on public.audit_questions (locked_until);

comment on column public.audit_questions.locked_by is
  'Paper-checker RPC lease (checker_next_question) so two checkers are not handed the same question. Not a hard lock: an expired lease is simply ignored. Cleared to null after every action -- for a PERSISTENT record of who acted, see checked_by_user below.';

-- ============================================================
-- 4a. Persistent actor attribution (orchestrator fix #5). locked_by is
--     cleared to null by every checker RPC once it finishes, so it cannot
--     be the chokepoint's source of "who acted" -- checked_by_user is set
--     by every checker/admin RPC that changes a question and is NEVER
--     cleared. Human checker actions leave `checked_by` (the existing AI
--     column) null; checked_by_user is what identifies a human actor.
--     W3's AI actions set `checked_by` directly (e.g. 'ai:haiku+haiku' --
--     already a self-describing string) and leave checked_by_user null.
--     split_from_id records split lineage (fix #3) so the chokepoint can
--     find a split sibling's live row without parsing flag_reasons text.
-- ============================================================
alter table public.audit_questions
  add column if not exists checked_by_user uuid references auth.users (id) on delete set null,
  add column if not exists split_from_id uuid references public.audit_questions (id) on delete set null;

create index if not exists audit_questions_checked_by_user_idx on public.audit_questions (checked_by_user);
create index if not exists audit_questions_split_from_id_idx on public.audit_questions (split_from_id);

comment on column public.audit_questions.checked_by_user is
  'The Shikshaq user (paper checker or admin) who most recently acted on this question via a checker/admin RPC. Never nulled once set -- this is the chokepoint''s source for a human actor''s identity, since locked_by/locked_until are cleared after every action. Null means either untouched by a human, or (when checked_by is set) an AI action.';
comment on column public.audit_questions.split_from_id is
  'Set on the SECOND half of a split (checker_split_question / a future admin split of an audit row): the audit_questions.id this row was split from. Lets the chokepoint find the sibling''s live_bank_question_id and insert the new half immediately after it in bank_questions, without parsing flag_reasons text.';

-- ============================================================
-- 4b. checker_skip_question's "don't re-serve to the same checker for a
--     while" bookkeeping (D40). A dedicated table rather than a column on
--     audit_questions because a question can be skipped by more than one
--     checker independently and each skip has its own 24h window.
--     Service-role only, same lockdown shape as every audit_* table.
-- ============================================================
create table if not exists public.audit_question_skips (
  question_id uuid not null references public.audit_questions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  skipped_at timestamptz not null default now(),
  primary key (question_id, user_id)
);

comment on table public.audit_question_skips is
  'D40: when a checker skips a question, checker_next_question() will not hand that same question back to that same checker for 24h (skipped_at + interval). Reached only through checker_skip_question()/checker_next_question(), both SECURITY DEFINER.';

alter table public.audit_question_skips enable row level security;
revoke all on public.audit_question_skips from public, anon, authenticated;

-- ============================================================
-- 4c. Checker subjects/classes preference (D41). Empty/null means "no
--     filter" -- a brand-new checker who has not picked yet, or an admin
--     previewing Kid Mode, sees every routed question.
-- ============================================================
alter table public.paper_checkers
  add column if not exists subjects text[],
  add column if not exists classes text[];

comment on column public.paper_checkers.subjects is
  'D41: subjects this checker has chosen to check. Null or empty = no filter (sees every subject). Self-service via checker_set_preferences().';
comment on column public.paper_checkers.classes is
  'D41: classes this checker has chosen to check. Null or empty = no filter (sees every class). Self-service via checker_set_preferences().';

-- ============================================================
-- 5. The chokepoint. Applies a live_copy audit_papers row's passed/fixed
--    questions onto bank_questions, logs bank_question_revisions, and
--    clears bank_papers.needs_review once every question of that paper is
--    question_passed. Fires automatically via trigger when paper_passed
--    flips to true for source='live_copy'; also callable directly by an
--    admin (admin_reapply_paper_to_live) to retry after a partial failure.
--
--    Byte-exact per CLAUDE.md: a field is only written to bank_questions
--    when it actually differs from the live value (`is distinct from`) --
--    an unedited, already-correct question is never touched, so nothing
--    here can introduce an unintended diff.
-- ============================================================
create or replace function public.apply_live_copy_paper_to_live(p_audit_paper_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_paper record;
  v_q record;
  v_parent record;
  v_actor text;
  v_actor_user_id uuid;
  v_source text;
  v_total int;
  v_passed int;
  v_before jsonb;
  v_live_paper_id text;
  v_parent_ord int;
  v_new_live_id text;
  v_new_row jsonb;
  v_any_mismatch boolean := false;
  v_any_unplaced boolean := false;
begin
  select * into v_paper from public.audit_papers where id = p_audit_paper_id;
  if v_paper is null or v_paper.source <> 'live_copy' or v_paper.live_bank_paper_id is null then
    return; -- nothing to apply for a new_ocr paper or an unmatched live paper
  end if;
  v_live_paper_id := v_paper.live_bank_paper_id;

  -- Paper-scoped advisory lock (second review, MEDIUM #3): serializes this
  -- chokepoint against admin_split_bank_question / admin_reorder_bank_questions
  -- / admin_merge_bank_questions / admin_add_bank_question /
  -- admin_delete_bank_question for the SAME live paper, all of which shift
  -- bank_questions.ord. Confirmed live (read-only select against pg_constraint,
  -- 2026-09-28): bank_questions has UNIQUE (paper_id, ord)
  -- (constraint bank_questions_paper_id_ord_key) -- two ord-shifting writers
  -- racing on one paper without this lock could violate it mid-transaction.
  perform pg_advisory_xact_lock(hashtext(v_live_paper_id));

  -- ---- Pass 1: split halves that have no live row yet (fix #3) --------
  -- A row created by checker_split_question has live_bank_question_id
  -- null and split_from_id pointing at its sibling. Insert it into
  -- bank_questions right after the sibling's live row, numbered as
  -- printed, and record its new id on the audit row so pass 2 below (and
  -- every future run) can apply further edits to it like any other row.
  for v_q in
    select * from public.audit_questions
    where paper_id = p_audit_paper_id
      and kind = 'question'
      and question_passed = true
      and live_bank_question_id is null
      and split_from_id is not null
  loop
    v_actor := coalesce(v_q.checked_by, v_q.checked_by_user::text, 'unknown-checker');
    v_actor_user_id := case when v_q.checked_by is null then v_q.checked_by_user else null end;
    v_source := case when v_q.checked_by is null then 'checker' else 'ai' end;

    select * into v_parent from public.audit_questions where id = v_q.split_from_id;
    if v_parent is null or v_parent.live_bank_question_id is null then
      -- The sibling itself has no live row yet either (not applied yet, or
      -- was never a live_copy row) -- try again on a future run.
      v_any_unplaced := true;
      continue;
    end if;

    select ord into v_parent_ord from public.bank_questions
      where id = v_parent.live_bank_question_id and paper_id = v_live_paper_id;
    if v_parent_ord is null then
      -- Scoping guard (fix #4): the sibling's live_bank_question_id does not
      -- belong to this paper. Record and move on without touching anything.
      insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
      values (null, v_actor_user_id, p_audit_paper_id, v_q.id, 'live_apply',
              'skipped: split sibling''s live row is not in paper ' || v_live_paper_id);
      v_any_mismatch := true;
      continue;
    end if;

    -- Fix (HIGH #1, second review): extract(epoch from now()) is constant
    -- within one transaction, so two splits of the SAME parent applied in the
    -- same chokepoint call generated the identical id and the second insert
    -- hit the live primary key (23505), aborting the whole chokepoint and
    -- leaving the paper stuck. Derive the id from the split audit row's own
    -- uuid instead, which is unique per split by construction.
    v_new_live_id := v_parent.live_bank_question_id || '-s-' || left(replace(v_q.id::text, '-', ''), 12);

    if exists (select 1 from public.bank_questions where id = v_new_live_id and paper_id = v_live_paper_id) then
      -- Idempotency: a previous run already created this live row (e.g. it
      -- crashed after the insert below but before recording it on the audit
      -- row). Point the audit row at it and move on without re-shifting ord
      -- or re-inserting.
      update public.audit_questions set live_bank_question_id = v_new_live_id where id = v_q.id;
      continue;
    end if;

    update public.bank_questions set ord = ord + 1
      where paper_id = v_live_paper_id and ord > v_parent_ord;

    insert into public.bank_questions (id, paper_id, ord, number, display_number, body, marks, chapter, qtype, page, figure, options)
    values (v_new_live_id, v_live_paper_id, v_parent_ord + 1, v_q.display_number, v_q.display_number,
            v_q.body, v_q.marks, v_parent.chapter, null, null, null, null);

    update public.audit_questions set live_bank_question_id = v_new_live_id where id = v_q.id;

    select to_jsonb(bq.*) into v_new_row from public.bank_questions bq where bq.id = v_new_live_id;
    insert into public.bank_question_revisions
      (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
    values ('bank_questions', v_new_live_id, 'live_apply', null, null, v_new_row, v_actor, v_actor_user_id, v_source,
            p_audit_paper_id, v_q.id);
  end loop;

  -- ---- Pass 2: field-level diffs on every question that now has a live
  --      target, scoped to this paper (fix #4) ---------------------------
  for v_q in
    select * from public.audit_questions
    where paper_id = p_audit_paper_id
      and kind = 'question'
      and question_passed = true
      and live_bank_question_id is not null
  loop
    v_actor := coalesce(v_q.checked_by, v_q.checked_by_user::text, 'unknown-checker');
    v_actor_user_id := case when v_q.checked_by is null then v_q.checked_by_user else null end;
    v_source := case when v_q.checked_by is null then 'checker' else 'ai' end;

    select to_jsonb(bq.*) into v_before from public.bank_questions bq
      where bq.id = v_q.live_bank_question_id and bq.paper_id = v_live_paper_id;
    if v_before is null then
      -- Either the live row no longer exists, or (scoping guard, fix #4) it
      -- belongs to a different paper than this audit row claims. Either
      -- way: never write, log it, and don't let this paper's needs_review
      -- clear below.
      insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
      values (null, v_actor_user_id, p_audit_paper_id, v_q.id, 'live_apply',
              'skipped: live_bank_question_id ' || coalesce(v_q.live_bank_question_id, 'null') ||
              ' not found in paper ' || v_live_paper_id);
      v_any_mismatch := true;
      continue;
    end if;

    -- body: only write when it actually differs (byte-exact rule).
    if v_q.body is distinct from (v_before->>'body') then
      update public.bank_questions set body = v_q.body
        where id = v_q.live_bank_question_id and paper_id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
      values ('bank_questions', v_q.live_bank_question_id, 'live_apply', 'body',
              to_jsonb(v_before->>'body'), to_jsonb(v_q.body), v_actor, v_actor_user_id, v_source,
              p_audit_paper_id, v_q.id);
    end if;

    if v_q.display_number is distinct from (v_before->>'display_number') then
      update public.bank_questions set display_number = v_q.display_number
        where id = v_q.live_bank_question_id and paper_id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
      values ('bank_questions', v_q.live_bank_question_id, 'live_apply', 'display_number',
              to_jsonb(v_before->>'display_number'), to_jsonb(v_q.display_number), v_actor, v_actor_user_id, v_source,
              p_audit_paper_id, v_q.id);
    end if;

    if v_q.marks is distinct from ((v_before->>'marks')::numeric) then
      update public.bank_questions set marks = v_q.marks
        where id = v_q.live_bank_question_id and paper_id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
      values ('bank_questions', v_q.live_bank_question_id, 'live_apply', 'marks',
              to_jsonb((v_before->>'marks')::numeric), to_jsonb(v_q.marks), v_actor, v_actor_user_id, v_source,
              p_audit_paper_id, v_q.id);
    end if;

    if v_q.answer_key is distinct from (v_before->>'answer_key') then
      update public.bank_questions set answer_key = v_q.answer_key
        where id = v_q.live_bank_question_id and paper_id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
      values ('bank_questions', v_q.live_bank_question_id, 'live_apply', 'answer_key',
              to_jsonb(v_before->>'answer_key'), to_jsonb(v_q.answer_key), v_actor, v_actor_user_id, v_source,
              p_audit_paper_id, v_q.id);
    end if;
  end loop;

  -- ---- Clear needs_review only when every question is passed AND every
  --      passed question has a live target AND nothing was skipped for a
  --      scope mismatch (fix #3 + fix #4) -------------------------------
  select count(*) filter (where kind = 'question'),
         count(*) filter (where kind = 'question' and question_passed)
    into v_total, v_passed
  from public.audit_questions
  where paper_id = p_audit_paper_id;

  if v_total > 0 and v_total = v_passed and not v_any_mismatch and not v_any_unplaced then
    select to_jsonb(bp.*) into v_before from public.bank_papers bp where bp.id = v_live_paper_id;
    if v_before is not null and (v_before->>'needs_review')::boolean is distinct from false then
      update public.bank_papers set needs_review = false where id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, source, audit_paper_id)
      values ('bank_papers', v_live_paper_id, 'live_clear', 'needs_review',
              to_jsonb(true), to_jsonb(false), 'system:chokepoint', 'system', p_audit_paper_id);
    end if;
  end if;
end;
$function$;

comment on function public.apply_live_copy_paper_to_live(uuid) is
  'The chokepoint (W1 spec item 4): the only path by which a checker/AI decision reaches bank_questions/bank_papers. Fires via trigger when audit_papers.paper_passed flips true for source=''live_copy''; also callable directly to retry.';

-- SECURITY DEFINER function called by the trigger below still must not be
-- directly reachable by anon/authenticated without going through the
-- trigger or an admin wrapper -- revoke, then grant only to the admin retry
-- wrapper's needs are satisfied by that wrapper itself calling it as the
-- same definer, so no direct grant to authenticated is needed here at all.
revoke all on function public.apply_live_copy_paper_to_live(uuid) from public, anon, authenticated;

create or replace function public.trg_apply_live_copy_paper_to_live()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.source = 'live_copy' and new.paper_passed = true and (old.paper_passed is distinct from true) then
    perform public.apply_live_copy_paper_to_live(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.trg_apply_live_copy_paper_to_live() from public, anon, authenticated;

drop trigger if exists audit_papers_apply_to_live on public.audit_papers;
create trigger audit_papers_apply_to_live
after update of paper_passed on public.audit_papers
for each row execute function public.trg_apply_live_copy_paper_to_live();

-- 5a. admin_reapply_paper_to_live (fix #7): the retry path referenced in
--     the chokepoint's own comment above, which previously did not exist.
--     Admin-gated wrapper around the same chokepoint the trigger calls --
--     useful after a partial failure (e.g. a split sibling not placed yet
--     because ITS sibling wasn't live yet either) once the underlying state
--     is fixed.
create or replace function public.admin_reapply_paper_to_live(p_audit_paper_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform public.apply_live_copy_paper_to_live(p_audit_paper_id);
end;
$function$;

revoke all on function public.admin_reapply_paper_to_live(uuid) from public, anon, authenticated;
grant execute on function public.admin_reapply_paper_to_live(uuid) to authenticated;

-- ============================================================
-- 6. Checker RPCs. Every function below revokes from public/anon/
--    authenticated first, then grants execute to authenticated -- the
--    function body itself calls is_paper_checker() and raises if false,
--    per CLAUDE.md's trap (revoking from PUBLIC alone leaves the
--    role-name grant Supabase's default-privilege rule adds untouched).
--
--    6z (shared helper) enforces the orchestrator's routing rule (fix #2)
--    for every mutating checker RPC: is_paper_checker(), the question must
--    be review_bucket='kid' (never 'escalated' -- ask-for-help/skip act
--    only on routed 'kid' work too), the caller must hold the lease
--    (locked_by/locked_until) OR be an admin, and the question's paper
--    must be a source the checker queue actually serves ('live_copy' or
--    'new_ocr'). Not granted to any role: called only from other
--    SECURITY DEFINER functions below, which (like every function in this
--    migration) run as the function owner -- a superuser in Supabase's
--    migration path -- so the missing grant does not block them.
-- ============================================================
create or replace function public.checker_authorize_question(p_question_id uuid)
returns public.audit_questions
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_q public.audit_questions;
  v_source text;
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_q from public.audit_questions where id = p_question_id;
  if v_q.id is null then
    raise exception 'Question not found' using errcode = '42501';
  end if;

  if v_q.review_bucket <> 'kid' then
    raise exception 'This question is not routed to the paper checker' using errcode = '42501';
  end if;

  if not (
    (v_q.locked_by = auth.uid() and v_q.locked_until is not null and v_q.locked_until > now())
    or public.is_admin()
  ) then
    raise exception 'This question is not currently assigned to you' using errcode = '42501';
  end if;

  select ap.source into v_source from public.audit_papers ap where ap.id = v_q.paper_id;
  if v_source is null or v_source not in ('live_copy', 'new_ocr') then
    raise exception 'This paper is not eligible for checking' using errcode = '42501';
  end if;

  return v_q;
end;
$function$;

revoke all on function public.checker_authorize_question(uuid) from public, anon, authenticated;

-- 6a. Next question: cross-paper stream of needs_review papers' kid-bucket,
--     not-yet-passed, not-currently-leased, not-recently-skipped (D40)
--     questions, filtered by the checker's own subjects/classes (D41) when
--     they have chosen any. D65: deliberately no filter on aq.source (the
--     snippet pointer) or the AI's pack choice -- a question with no PDF
--     anywhere (sense_check_pack ran instead of verify_pack) is served like
--     any other; the client shows "No picture / check that it makes sense"
--     instead of an image, and every action (pass/fix/split/skip/help)
--     works the same way since none of them read aq.source.
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

  select subjects, classes into v_subjects, v_classes
  from public.paper_checkers where user_id = v_uid;

  select aq.* into v_q
  from public.audit_questions aq
  join public.audit_papers ap on ap.id = aq.paper_id
  where aq.kind = 'question'
    and aq.review_bucket = 'kid'
    and aq.question_passed = false
    and ap.source in ('live_copy', 'new_ocr')
    and (aq.locked_until is null or aq.locked_until < now())
    and (v_subjects is null or array_length(v_subjects, 1) is null or ap.subject = any(v_subjects))
    and (v_classes is null or array_length(v_classes, 1) is null or ap.class = any(v_classes))
    and not exists (
      select 1 from public.audit_question_skips s
      where s.question_id = aq.id and s.user_id = v_uid and s.skipped_at > now() - interval '24 hours'
    )
  -- D68: live needs_review papers (source='live_copy') go first -- they are
  -- already published and wrong right now, so fixing them matters more than
  -- clearing a paper that has not shipped yet. Within each group, newest
  -- year first. ap.year is text; the regexp guard avoids a cast error on a
  -- non-numeric value (blank, "N/A", etc.) by treating it as oldest.
  order by
    case when ap.source = 'live_copy' then 0 else 1 end,
    case when ap.year ~ '^\d+$' then ap.year::int else 0 end desc,
    ap.created_at, aq.ord
  limit 1
  for update of aq skip locked;

  if v_q.id is null then
    return; -- empty result set: nothing to check right now
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

-- 6b. Pass: looks right, as printed.
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

-- 6c. Fix it: edit body/display_number/marks, then pass.
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

-- 6d. Split: the printed question is actually two. Shortens the current
--     row's body to the text before p_split_at and inserts a new row after
--     it (same paper, ord shifted) with the remainder, tagged
--     split_from_id so the chokepoint can place its live half next to the
--     original's (fix #3). Neither half is auto-passed -- both need a
--     fresh look.
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

  -- Advisory lock keyed on the AUDIT paper id: serializes concurrent checker
  -- splits of the same audit paper against each other (this shifts only
  -- audit_questions.ord). It does not share a key with the chokepoint or the
  -- admin bank_questions functions, which lock on the live bank_papers id.
  perform pg_advisory_xact_lock(hashtext(v_q.paper_id::text));

  -- Stale-body check (second review, MEDIUM #2): the checker's client may
  -- have loaded this question before someone else (another checker action,
  -- or the AI pipeline) changed its body. Splitting at a byte offset into a
  -- body the client did not actually see would silently corrupt both halves.
  if p_body_before is distinct from v_q.body then
    raise exception 'stale question text, reload and retry' using errcode = '40001';
  end if;

  -- Duplicate-split guard (second review, HIGH #1): refuse a second split of
  -- the same question while an earlier split's second half has not yet been
  -- applied to live (live_bank_question_id still null). Without this, two
  -- unapplied splits of one parent race for the same chokepoint-generated id.
  if exists (
    select 1 from public.audit_questions
    where split_from_id = p_question_id and live_bank_question_id is null
  ) then
    raise exception 'This question already has an unapplied split pending; resolve it before splitting again' using errcode = '40001';
  end if;

  if p_split_at is null or p_split_at <= 0 or p_split_at >= length(p_body_before) then
    raise exception 'Split point out of range';
  end if;

  v_first := left(p_body_before, p_split_at);
  v_second := substring(p_body_before from p_split_at + 1);

  -- Make room: every question after this one, in this paper, shifts ord by 1.
  update public.audit_questions
  set ord = ord + 1
  where paper_id = v_q.paper_id and ord > v_q.ord;

  update public.audit_questions
  set body = v_first, status = 'flagged', question_passed = false,
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

-- 6e. Ask for help (D16/D21): escalates, never reds/blocks the paper.
create or replace function public.checker_ask_for_help(p_question_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_before public.audit_questions;
begin
  v_before := public.checker_authorize_question(p_question_id);

  update public.audit_questions
  set review_bucket = 'escalated', checked_by_user = auth.uid(),
      locked_by = null, locked_until = null
  where id = p_question_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
  values (null, auth.uid(), v_before.paper_id, p_question_id, 'checker_ask_help', 'review_bucket',
          to_jsonb(v_before.review_bucket),
          jsonb_build_object('review_bucket', 'escalated'),
          coalesce(p_reason, 'ask for help'));
end;
$function$;

revoke all on function public.checker_ask_for_help(uuid, text) from public, anon, authenticated;
grant execute on function public.checker_ask_for_help(uuid, text) to authenticated;

-- 6f. Skip (D40): release the lease and remember not to hand this exact
--     question back to this exact checker for 24h. Never turns the paper
--     red and never touches review_bucket -- a different checker (or the
--     same one, after 24h) can still be routed to it.
create or replace function public.checker_skip_question(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_q public.audit_questions;
begin
  v_q := public.checker_authorize_question(p_question_id);

  update public.audit_questions
  set locked_by = null, locked_until = null
  where id = p_question_id;

  insert into public.audit_question_skips (question_id, user_id, skipped_at)
  values (p_question_id, auth.uid(), now())
  on conflict (question_id, user_id) do update set skipped_at = now();

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action)
  values (null, auth.uid(), v_q.paper_id, p_question_id, 'checker_skip');
end;
$function$;

revoke all on function public.checker_skip_question(uuid) from public, anon, authenticated;
grant execute on function public.checker_skip_question(uuid) to authenticated;

-- 6g. Checked-today count, for the small counter on Kid Mode.
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
  -- Second review, LOW #4: the old `language sql` version had no auth check,
  -- so any authenticated user (not just checkers) could call it. It only ever
  -- returned that user's own count, but the RPC should still be
  -- checker-gated like every other checker_* function for a consistent
  -- 42501 contract.
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select count(*)::int into v_count
  from public.audit_review_log
  where at >= date_trunc('day', now())
    and action in ('checker_pass', 'checker_fix', 'checker_split', 'checker_ask_help')
    and actor_user_id = auth.uid();

  return v_count;
end;
$function$;

revoke all on function public.checker_checked_today_count() from public, anon, authenticated;
grant execute on function public.checker_checked_today_count() to authenticated;

-- 6h. Today + lifetime counts in one call (D42's "plus the checker's own
--     counts (today / total)"), and the weekly top-10 leaderboard by first
--     name only -- never an email, per D42.
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
      count(*) filter (where at >= date_trunc('day', now())) as today_count,
      count(*) as total_count
    from public.audit_review_log
    where actor_user_id = auth.uid()
      and action in ('checker_pass', 'checker_fix', 'checker_split', 'checker_ask_help');
end;
$function$;

revoke all on function public.checker_my_stats() from public, anon, authenticated;
grant execute on function public.checker_my_stats() to authenticated;

create or replace function public.checker_leaderboard()
returns table (rank int, first_name text, weekly_count bigint)
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
    select row_number() over (order by count(*) desc)::int as rank,
           coalesce(nullif(split_part(coalesce(p.full_name, ''), ' ', 1), ''), 'A checker') as first_name,
           count(*) as weekly_count
    from public.audit_review_log l
    join public.profiles p on p.id = l.actor_user_id
    where l.action in ('checker_pass', 'checker_fix', 'checker_split', 'checker_ask_help')
      and l.at >= now() - interval '7 days'
    group by l.actor_user_id, p.full_name
    order by weekly_count desc
    limit 10;
end;
$function$;

revoke all on function public.checker_leaderboard() from public, anon, authenticated;
grant execute on function public.checker_leaderboard() to authenticated;

-- 6i. Checker preferences (D41): self-service, any signed-in checker may
--     set their OWN subjects/classes. Never lets a checker edit another
--     row (p_user_id is always auth.uid(), not a parameter).
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

  update public.paper_checkers
  set subjects = nullif(p_subjects, array[]::text[]),
      classes = nullif(p_classes, array[]::text[])
  where user_id = auth.uid();
end;
$function$;

revoke all on function public.checker_set_preferences(text[], text[]) from public, anon, authenticated;
grant execute on function public.checker_set_preferences(text[], text[]) to authenticated;

-- 6j. Read the caller's own preferences (so the client knows whether to
--     show the first-use "pick your subjects" prompt).
create or replace function public.checker_get_preferences()
returns table (subjects text[], classes text[])
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query select pc.subjects, pc.classes from public.paper_checkers pc where pc.user_id = auth.uid();
end;
$function$;

revoke all on function public.checker_get_preferences() from public, anon, authenticated;
grant execute on function public.checker_get_preferences() to authenticated;

-- ============================================================
-- 7. Storage: paper checkers and admins may read snippet crops in the
--    private 'audit-figures' bucket (created in 002_audit_figures.sql,
--    public=false, no prior policies -- default-deny for anon/
--    authenticated). This is additive: only a SELECT policy, scoped to
--    is_admin() or is_paper_checker(), so the client can call
--    createSignedUrl() itself for a snippet it's allowed to see.
-- ============================================================
drop policy if exists "paper checkers and admins can read audit figures" on storage.objects;
create policy "paper checkers and admins can read audit figures"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'audit-figures'
    and (public.is_admin() or public.is_paper_checker())
  );

-- ============================================================
-- 8. Admin RPCs (D22). Every one checks is_admin() and is locked down the
--    same way as the checker RPCs above.
-- ============================================================

-- 8a. Generic field edit on a live paper or question, whitelisted columns
--     only (never id/paper_id/ord -- those are structural, handled by the
--     merge/split/reorder/add/delete functions below).
create or replace function public.admin_edit_bank_paper(p_paper_id text, p_field text, p_value text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_before jsonb;
  v_after jsonb;
  v_allowed text[] := array[
    'school', 'year', 'exam', 'cls', 'subject', 'board',
    'marks', 'is_published', 'needs_review', 'allowed_time_minutes',
    'general_instructions', 'incomplete_note'
  ];
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not (p_field = any(v_allowed)) then
    raise exception 'Field % is not editable through this function', p_field;
  end if;

  select to_jsonb(bp.*) into v_before from public.bank_papers bp where bp.id = p_paper_id;
  if v_before is null then
    raise exception 'Paper not found';
  end if;

  execute format('update public.bank_papers set %I = $1 where id = $2', p_field)
    using case
      when p_field in ('marks', 'allowed_time_minutes') then p_value::numeric::text
      when p_field in ('is_published', 'needs_review') then p_value::boolean::text
      else p_value
    end, p_paper_id;

  -- Second review, LOW #6: store `after` typed the same way the column is,
  -- not always as a jsonb string -- admin_undo_revision's optimistic check
  -- reads it back with `#>>'{}'` and compares to the current column's ::text
  -- cast, which only lines up when a numeric/boolean field's stored `after`
  -- is itself a jsonb number/boolean.
  v_after := case
    when p_field in ('marks', 'allowed_time_minutes') then to_jsonb(p_value::numeric)
    when p_field in ('is_published', 'needs_review') then to_jsonb(p_value::boolean)
    else to_jsonb(p_value)
  end;

  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source)
  values ('bank_papers', p_paper_id, 'admin_edit', p_field, v_before->p_field, v_after, auth.uid()::text, auth.uid(), 'admin');
end;
$function$;

revoke all on function public.admin_edit_bank_paper(text, text, text) from public, anon, authenticated;
grant execute on function public.admin_edit_bank_paper(text, text, text) to authenticated;

create or replace function public.admin_edit_bank_question(p_question_id text, p_field text, p_value text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_before jsonb;
  v_after jsonb;
  v_allowed text[] := array[
    'number', 'body', 'marks', 'chapter', 'qtype', 'page', 'figure',
    'display_number', 'instructions', 'suggested_time_minutes',
    'chapter_from_paper', 'answer_key', 'alternative_group',
    'alternative_label', 'section_label', 'syllabus_ref'
  ];
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not (p_field = any(v_allowed)) then
    raise exception 'Field % is not editable through this function', p_field;
  end if;

  select to_jsonb(bq.*) into v_before from public.bank_questions bq where bq.id = p_question_id;
  if v_before is null then
    raise exception 'Question not found';
  end if;

  execute format('update public.bank_questions set %I = $1 where id = $2', p_field)
    using case
      when p_field in ('marks', 'suggested_time_minutes', 'page') then p_value::numeric::text
      when p_field = 'chapter_from_paper' then p_value::boolean::text
      else p_value
    end, p_question_id;

  -- Second review, LOW #6: typed `after`, matching admin_edit_bank_paper.
  v_after := case
    when p_field in ('marks', 'suggested_time_minutes', 'page') then to_jsonb(p_value::numeric)
    when p_field = 'chapter_from_paper' then to_jsonb(p_value::boolean)
    else to_jsonb(p_value)
  end;

  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source)
  values ('bank_questions', p_question_id, 'admin_edit', p_field, v_before->p_field, v_after, auth.uid()::text, auth.uid(), 'admin');
end;
$function$;

revoke all on function public.admin_edit_bank_question(text, text, text) from public, anon, authenticated;
grant execute on function public.admin_edit_bank_question(text, text, text) to authenticated;

-- 8b. Structural: merge two questions (second's body appended to first,
--     second deleted), split (mirrors checker_split_question but on LIVE
--     rows), reorder (swap ord), add, delete. Each logs one revision row.
create or replace function public.admin_merge_bank_questions(p_first_id text, p_second_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_first public.bank_questions;
  v_second public.bank_questions;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_first from public.bank_questions where id = p_first_id;
  select * into v_second from public.bank_questions where id = p_second_id;
  if v_first.id is null or v_second.id is null then
    raise exception 'Question not found';
  end if;
  if v_first.paper_id <> v_second.paper_id then
    raise exception 'Cannot merge questions from different papers';
  end if;

  -- Second review, MEDIUM #3: paper-scoped advisory lock.
  perform pg_advisory_xact_lock(hashtext(v_first.paper_id));

  update public.bank_questions
  set body = v_first.body || E'\n\n' || v_second.body,
      marks = coalesce(v_first.marks, 0) + coalesce(v_second.marks, 0)
  where id = p_first_id;

  delete from public.bank_questions where id = p_second_id;

  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source)
  values ('bank_questions', p_first_id, 'admin_merge', null,
          jsonb_build_object('first', to_jsonb(v_first), 'second', to_jsonb(v_second)),
          jsonb_build_object('merged_into', p_first_id, 'removed', p_second_id),
          auth.uid()::text, auth.uid(), 'admin');
end;
$function$;

revoke all on function public.admin_merge_bank_questions(text, text) from public, anon, authenticated;
grant execute on function public.admin_merge_bank_questions(text, text) to authenticated;

create or replace function public.admin_split_bank_question(p_question_id text, p_split_at int)
returns table (first_id text, second_id text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_q public.bank_questions;
  v_first text;
  v_second text;
  v_new_id text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_q from public.bank_questions where id = p_question_id;
  if v_q.id is null then
    raise exception 'Question not found';
  end if;
  -- Second review, MEDIUM #3: paper-scoped advisory lock.
  perform pg_advisory_xact_lock(hashtext(v_q.paper_id));

  if p_split_at is null or p_split_at <= 0 or p_split_at >= length(v_q.body) then
    raise exception 'Split point out of range';
  end if;

  v_first := left(v_q.body, p_split_at);
  v_second := substring(v_q.body from p_split_at + 1);
  v_new_id := v_q.id || '-split-' || replace(gen_random_uuid()::text, '-', '');

  update public.bank_questions set ord = ord + 1 where paper_id = v_q.paper_id and ord > v_q.ord;
  update public.bank_questions set body = v_first where id = p_question_id;
  insert into public.bank_questions (id, paper_id, ord, number, body, marks, chapter, qtype, page, figure, options)
  values (v_new_id, v_q.paper_id, v_q.ord + 1, null, v_second, null, v_q.chapter, v_q.qtype, v_q.page, null, null);

  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source)
  values ('bank_questions', p_question_id, 'admin_split', 'body', to_jsonb(v_q.body),
          jsonb_build_object('first_id', p_question_id, 'second_id', v_new_id), auth.uid()::text, auth.uid(), 'admin');

  return query select p_question_id, v_new_id;
end;
$function$;

revoke all on function public.admin_split_bank_question(text, int) from public, anon, authenticated;
grant execute on function public.admin_split_bank_question(text, int) to authenticated;

create or replace function public.admin_reorder_bank_questions(p_paper_id text, p_ordered_ids text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_before jsonb;
  v_id text;
  v_ord int := 0;
  v_expected text[];
  v_provided_sorted text[];
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- Second review, MEDIUM #3: paper-scoped advisory lock.
  perform pg_advisory_xact_lock(hashtext(p_paper_id));

  -- Second review, LOW #5: p_ordered_ids must be exactly this paper's
  -- question ids, each exactly once -- not a subset (which would silently
  -- strand the omitted rows at whatever ord they last had), not a superset
  -- with a stray id from another paper, and not a list with a duplicate
  -- (which would collide with unique(paper_id, ord) once both loops below
  -- try to place the same id at two ords). Comparing the sorted arrays
  -- catches all three: different length, an unknown id, or a duplicate id
  -- each make the sorted arrays unequal.
  select array_agg(id order by id) into v_expected
    from public.bank_questions where paper_id = p_paper_id;
  select array_agg(x order by x) into v_provided_sorted from unnest(p_ordered_ids) x;
  if v_expected is null or v_provided_sorted is distinct from v_expected then
    raise exception 'p_ordered_ids must contain exactly this paper''s question ids, each exactly once' using errcode = '22023';
  end if;

  select jsonb_agg(jsonb_build_object('id', id, 'ord', ord) order by ord)
    into v_before from public.bank_questions where paper_id = p_paper_id;

  foreach v_id in array p_ordered_ids loop
    -- offset into a scratch range first so unique(paper_id, ord) can never
    -- collide mid-loop between the old and new orderings.
    update public.bank_questions set ord = ord + 100000 where id = v_id and paper_id = p_paper_id;
  end loop;
  foreach v_id in array p_ordered_ids loop
    update public.bank_questions set ord = v_ord where id = v_id and paper_id = p_paper_id;
    v_ord := v_ord + 1;
  end loop;

  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source)
  values ('bank_papers', p_paper_id, 'admin_reorder', 'question_order', v_before, to_jsonb(p_ordered_ids), auth.uid()::text, auth.uid(), 'admin');
end;
$function$;

revoke all on function public.admin_reorder_bank_questions(text, text[]) from public, anon, authenticated;
grant execute on function public.admin_reorder_bank_questions(text, text[]) to authenticated;

create or replace function public.admin_add_bank_question(
  p_paper_id text, p_after_ord int, p_body text, p_marks numeric, p_display_number text
)
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

  -- Second review, MEDIUM #3: paper-scoped advisory lock.
  perform pg_advisory_xact_lock(hashtext(p_paper_id));

  v_new_id := p_paper_id || '-add-' || replace(gen_random_uuid()::text, '-', '');
  update public.bank_questions set ord = ord + 1 where paper_id = p_paper_id and ord > p_after_ord;
  insert into public.bank_questions (id, paper_id, ord, body, marks, display_number)
  values (v_new_id, p_paper_id, p_after_ord + 1, coalesce(p_body, ''), p_marks, p_display_number);

  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source)
  values ('bank_questions', v_new_id, 'admin_add', null, null,
          jsonb_build_object('paper_id', p_paper_id, 'body', p_body, 'marks', p_marks), auth.uid()::text, auth.uid(), 'admin');

  return v_new_id;
end;
$function$;

revoke all on function public.admin_add_bank_question(text, int, text, numeric, text) from public, anon, authenticated;
grant execute on function public.admin_add_bank_question(text, int, text, numeric, text) to authenticated;

create or replace function public.admin_delete_bank_question(p_question_id text)
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
  select * into v_before from public.bank_questions where id = p_question_id;
  if v_before.id is null then
    raise exception 'Question not found';
  end if;

  -- Second review, MEDIUM #3: paper-scoped advisory lock.
  perform pg_advisory_xact_lock(hashtext(v_before.paper_id));

  delete from public.bank_questions where id = p_question_id;

  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source)
  values ('bank_questions', p_question_id, 'admin_delete', null, to_jsonb(v_before), null, auth.uid()::text, auth.uid(), 'admin');
end;
$function$;

revoke all on function public.admin_delete_bank_question(text) from public, anon, authenticated;
grant execute on function public.admin_delete_bank_question(text) to authenticated;

-- 8c. Attach/replace a figure on a live question (bank_questions.figure is
--     an existing text column: a path/URL into the public paper-figures
--     bucket. This function only records the pointer; uploading the file
--     itself stays a client-side storage call, same as admin/papers.tsx's
--     existing upload flow).
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
  select * into v_before from public.bank_questions where id = p_question_id;
  if v_before.id is null then
    raise exception 'Question not found';
  end if;

  update public.bank_questions set figure = p_figure_path where id = p_question_id;

  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source)
  values ('bank_questions', p_question_id, 'admin_edit', 'figure', to_jsonb(v_before.figure), to_jsonb(p_figure_path), auth.uid()::text, auth.uid(), 'admin');
end;
$function$;

revoke all on function public.admin_set_bank_question_figure(text, text) from public, anon, authenticated;
grant execute on function public.admin_set_bank_question_figure(text, text) to authenticated;

-- 8d. Hide/restore a paper. Reuses bank_papers.is_published exactly as
--     admin/papers.tsx already does for the `papers` (submissions) table --
--     RLS's "published papers are public" policy already keys off this
--     same column, so this is the existing visibility switch, not a new one.
create or replace function public.admin_hide_bank_paper(p_paper_id text, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.bank_papers set is_published = false where id = p_paper_id;
  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source, reason)
  values ('bank_papers', p_paper_id, 'admin_hide', 'is_published', to_jsonb(true), to_jsonb(false), auth.uid()::text, auth.uid(), 'admin', p_reason);
end;
$function$;

revoke all on function public.admin_hide_bank_paper(text, text) from public, anon, authenticated;
grant execute on function public.admin_hide_bank_paper(text, text) to authenticated;

create or replace function public.admin_restore_bank_paper(p_paper_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.bank_papers set is_published = true where id = p_paper_id;
  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source)
  values ('bank_papers', p_paper_id, 'admin_restore', 'is_published', to_jsonb(false), to_jsonb(true), auth.uid()::text, auth.uid(), 'admin');
end;
$function$;

revoke all on function public.admin_restore_bank_paper(text) from public, anon, authenticated;
grant execute on function public.admin_restore_bank_paper(text) to authenticated;

-- 8e. Full change history for a paper (its own row + every question's).
--     plpgsql + an explicit raise (fix #9): the previous `language sql`
--     version folded the admin check into the WHERE clause, which just
--     returns an empty set for a non-admin instead of refusing outright --
--     harmless here since RLS on bank_question_revisions already limits
--     SELECT to admins, but inconsistent with every other RPC's 42501
--     contract, so a caller can no longer mistake "empty" for "you looked
--     but there was nothing".
create or replace function public.admin_paper_history(p_paper_id text)
returns setof public.bank_question_revisions
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select r.* from public.bank_question_revisions r
    where (r.table_name = 'bank_papers' and r.row_id = p_paper_id)
       or (r.table_name = 'bank_questions' and r.row_id in (
             select id from public.bank_questions where paper_id = p_paper_id
           ))
    order by r.created_at desc;
end;
$function$;

revoke all on function public.admin_paper_history(text) from public, anon, authenticated;
grant execute on function public.admin_paper_history(text) to authenticated;

-- 8f. Undo a revision: re-applies `before` for a field-level edit; for a
--     whole-row delete, re-inserts the row from `before`. merge/split/
--     reorder are intentionally NOT auto-undoable here (their `before` is
--     a compound snapshot, not a single field) -- an admin undoes those by
--     re-editing manually; the history still shows exactly what happened.
--
--     Optimistic check (fix #6): if the field's CURRENT live value no
--     longer matches this revision's `after` (i.e. something else changed
--     it since), refuse unless p_force is passed -- otherwise an undo could
--     silently clobber a newer, unrelated edit made after this revision.
create or replace function public.admin_undo_revision(p_revision_id bigint, p_force boolean default false)
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

    if v_rev.table_name = 'bank_papers' then
      execute format('update public.bank_papers set %I = $1 where id = $2', v_rev.field)
        using (v_rev.before #>> '{}'), v_rev.row_id;
    else
      execute format('update public.bank_questions set %I = $1 where id = $2', v_rev.field)
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

revoke all on function public.admin_undo_revision(bigint, boolean) from public, anon, authenticated;
grant execute on function public.admin_undo_revision(bigint, boolean) to authenticated;

-- 8g. Grant/revoke the checker role.
create or replace function public.admin_grant_paper_checker(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  insert into public.paper_checkers (user_id, active, granted_by, granted_at, revoked_at)
  values (p_user_id, true, auth.uid(), now(), null)
  on conflict (user_id) do update set active = true, granted_by = auth.uid(), granted_at = now(), revoked_at = null;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), null, null, 'admin_grant_checker', p_user_id::text);
end;
$function$;

revoke all on function public.admin_grant_paper_checker(uuid) from public, anon, authenticated;
grant execute on function public.admin_grant_paper_checker(uuid) to authenticated;

create or replace function public.admin_revoke_paper_checker(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.paper_checkers set active = false, revoked_at = now() where user_id = p_user_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), null, null, 'admin_revoke_checker', p_user_id::text);
end;
$function$;

revoke all on function public.admin_revoke_paper_checker(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_paper_checker(uuid) to authenticated;

-- 8h. List checkers with counts (and a null accuracy placeholder -- W3's
--     simulation harness is the only planned source of ground truth to
--     compute a real accuracy figure against; see the assumption recorded
--     in W1's log note).
-- plpgsql + explicit raise (fix #9), same reasoning as admin_paper_history
-- above: a non-admin now gets a hard 42501 refusal, not a quietly empty list.
create or replace function public.admin_list_checkers()
returns table (
  user_id uuid, email text, active boolean, granted_at timestamptz,
  passed_count bigint, fixed_count bigint, split_count bigint, escalated_count bigint
)
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select pc.user_id,
           u.email,
           pc.active,
           pc.granted_at,
           count(*) filter (where l.action = 'checker_pass') as passed_count,
           count(*) filter (where l.action = 'checker_fix') as fixed_count,
           count(*) filter (where l.action = 'checker_split') as split_count,
           count(*) filter (where l.action = 'checker_ask_help') as escalated_count
    from public.paper_checkers pc
    join auth.users u on u.id = pc.user_id
    left join public.audit_review_log l on l.actor_user_id = pc.user_id
    group by pc.user_id, u.email, pc.active, pc.granted_at
    order by pc.granted_at desc;
end;
$function$;

revoke all on function public.admin_list_checkers() from public, anon, authenticated;
grant execute on function public.admin_list_checkers() to authenticated;

-- 8h-2. Search Shikshaq accounts by name or email (D32), so granting the
--     checker permission does not require already knowing a user's uuid.
--     public.profiles carries both full_name and email directly (checked
--     live, 2026-09-28) so this needs no auth.users join.
create or replace function public.admin_search_users(p_query text)
returns table (user_id uuid, full_name text, email text, role text, is_checker boolean, checker_active boolean)
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_query is null or length(trim(p_query)) < 2 then
    return;
  end if;

  return query
    select p.id, p.full_name, p.email, p.role,
           pc.user_id is not null as is_checker,
           coalesce(pc.active, false) as checker_active
    from public.profiles p
    left join public.paper_checkers pc on pc.user_id = p.id
    where p.full_name ilike '%' || p_query || '%' or p.email ilike '%' || p_query || '%'
    order by p.full_name nulls last
    limit 20;
end;
$function$;

revoke all on function public.admin_search_users(text) from public, anon, authenticated;
grant execute on function public.admin_search_users(text) to authenticated;

-- 8i. The escalation queue ("Ask for help"). plpgsql + explicit raise (fix #9).
create or replace function public.admin_escalation_queue()
returns table (
  question_id uuid, paper_id uuid, live_bank_paper_id text, display_number text,
  body text, flag_reasons text[], school text, subject text, cls text, updated_at timestamptz
)
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select aq.id, aq.paper_id, ap.live_bank_paper_id, aq.display_number, aq.body,
           aq.flag_reasons, ap.school, ap.subject, ap.class, aq.updated_at
    from public.audit_questions aq
    join public.audit_papers ap on ap.id = aq.paper_id
    where aq.review_bucket = 'escalated' and aq.question_passed = false
    order by aq.updated_at asc;
end;
$function$;

revoke all on function public.admin_escalation_queue() from public, anon, authenticated;
grant execute on function public.admin_escalation_queue() to authenticated;

-- 8i-2. Resolve an escalation: the admin either accepts the text as-is
--     (leave p_body/p_display_number/p_marks null) or fixes it, then the
--     question is passed and taken out of the escalated bucket back into
--     'kid' bucket bookkeeping (it is already question_passed=true so it
--     will never resurface in checker_next_question). Logged as
--     'admin_resolve_escalation' per the owner dashboard's logging contract.
create or replace function public.admin_resolve_escalation(
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
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_before from public.audit_questions where id = p_question_id;
  if v_before.id is null then
    raise exception 'Question not found';
  end if;

  update public.audit_questions
  set body = coalesce(p_body, body),
      display_number = coalesce(p_display_number, display_number),
      marks = coalesce(p_marks, marks),
      status = 'passed', question_passed = true, review_bucket = 'kid',
      locked_by = null, locked_until = null
  where id = p_question_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after)
  values (null, auth.uid(), v_before.paper_id, p_question_id, 'admin_resolve_escalation', 'review_bucket',
          jsonb_build_object('review_bucket', v_before.review_bucket, 'body', v_before.body),
          jsonb_build_object('review_bucket', 'kid', 'body', coalesce(p_body, v_before.body)));
end;
$function$;

revoke all on function public.admin_resolve_escalation(uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.admin_resolve_escalation(uuid, text, text, numeric) to authenticated;

-- 8j. Paper list for the admin queue view, with the four filters the spec
--     asks for: needs review, escalated, hidden, incomplete. (AI-approved
--     is any live_copy paper with paper_passed=true and no escalated
--     questions left -- computed client-side from this + the escalation
--     queue rather than a fifth SQL branch, to keep one function simple.)
-- plpgsql + explicit raise (fix #9).
create or replace function public.admin_paper_queue()
returns table (
  paper_id text, title text, school text, subject text, cls text, board text, year text,
  needs_review boolean, is_published boolean, incomplete_note text,
  audit_paper_id uuid, escalated_count bigint, total_questions bigint, passed_questions bigint
)
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select bp.id, bp.school || ' ' || bp.subject as title, bp.school, bp.subject, bp.cls, bp.board, bp.year,
           bp.needs_review, bp.is_published, bp.incomplete_note,
           ap.id as audit_paper_id,
           count(aq.*) filter (where aq.review_bucket = 'escalated' and aq.question_passed = false) as escalated_count,
           count(aq.*) filter (where aq.kind = 'question') as total_questions,
           count(aq.*) filter (where aq.kind = 'question' and aq.question_passed) as passed_questions
    from public.bank_papers bp
    left join public.audit_papers ap on ap.live_bank_paper_id = bp.id and ap.source = 'live_copy'
    left join public.audit_questions aq on aq.paper_id = ap.id
    group by bp.id, ap.id
    order by bp.needs_review desc, bp.id;
end;
$function$;

revoke all on function public.admin_paper_queue() from public, anon, authenticated;
grant execute on function public.admin_paper_queue() to authenticated;

commit;

-- ============================================================
-- Audit query (CLAUDE.md's exact recipe), re-run after the orchestrator's
-- fix-list review to cover every function this migration now creates.
-- Every one must show EXECUTE granted only to a role that is either
-- 'authenticated' (function checks caller internally) or nothing at all
-- for the three internal-only helpers (checker_authorize_question is a
-- shared helper called only from other SECURITY DEFINER functions, same
-- shape as the two chokepoint functions):
--
--   select p.proname, p.prosecdef,
--          case when p.proacl is null then 'DEFAULT (execute to public)'
--               else pg_catalog.array_to_string(p.proacl, ' | ') end as acl
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prokind = 'f'
--     and p.proname in (
--       'is_paper_checker', 'apply_live_copy_paper_to_live',
--       'trg_apply_live_copy_paper_to_live', 'checker_authorize_question',
--       'checker_next_question', 'checker_pass_question',
--       'checker_fix_question', 'checker_split_question',
--       'checker_ask_for_help', 'checker_skip_question',
--       'checker_checked_today_count', 'checker_my_stats',
--       'checker_leaderboard', 'checker_set_preferences',
--       'checker_get_preferences', 'admin_edit_bank_paper',
--       'admin_edit_bank_question', 'admin_merge_bank_questions',
--       'admin_split_bank_question', 'admin_reorder_bank_questions',
--       'admin_add_bank_question', 'admin_delete_bank_question',
--       'admin_set_bank_question_figure', 'admin_hide_bank_paper',
--       'admin_restore_bank_paper', 'admin_paper_history',
--       'admin_undo_revision', 'admin_reapply_paper_to_live',
--       'admin_grant_paper_checker', 'admin_revoke_paper_checker',
--       'admin_list_checkers', 'admin_search_users',
--       'admin_escalation_queue', 'admin_resolve_escalation',
--       'admin_paper_queue', 'bank_paper_questions'
--     )
--   order by p.prosecdef desc, p.proname;
--
-- Expected: proacl shows exactly `={}` (revoked from PUBLIC) plus
-- `authenticated=X` for every function EXCEPT these three, which must show
-- NO grant to authenticated (or any role) at all -- internal-only, reached
-- only from inside another SECURITY DEFINER function in this same
-- migration, which runs as the function owner regardless of grants:
--   apply_live_copy_paper_to_live, trg_apply_live_copy_paper_to_live,
--   checker_authorize_question
-- ...and bank_paper_questions, which additionally grants to anon (the
-- public reader gate; every other function in the list grants to
-- authenticated only, never anon). A NULL proacl anywhere in this list
-- means the revoke/grant block for that function was skipped -- re-run
-- this migration.
--
-- Run live, read-only, 2026-09-28 (project uvtifolnsneitetzohtn, before
-- this fix-list revision existed -- kept here as the confirmed baseline for
-- objects this migration REPLACES, not for the new ones it adds):
--   select p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and p.proname='bank_paper_questions';
--   -> {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}
-- i.e. PUBLIC already had no entry (previously revoked) and anon/
-- authenticated were both already explicitly granted -- this migration's
-- revoke/grant block reproduces that state after the DROP+CREATE above,
-- it does not change it.
--
-- MEDIUM fix #8 (widen bank_questions.marks to numeric): checked live,
-- read-only, same session -- `bank_questions.marks` and `bank_papers.marks`
-- are ALREADY `numeric` (confirmed via information_schema.columns), not
-- `integer` as the committed schema migration
-- (20260829180149_bank_papers_and_questions.sql) declares. That migration
-- has drifted from live before this workstream touched anything. No ALTER
-- COLUMN TYPE is included here: running one on an already-numeric column
-- would force a full-table rewrite of bank_questions (44,726 rows) for zero
-- schema change, which is a real lock/IO cost with no benefit. If the
-- orchestrator's own inspection shows a different live type by the time
-- this is applied, re-check with the query above before applying an ALTER.
