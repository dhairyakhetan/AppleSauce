-- W13: realtime for paper checking. "Multiple people will test and verify
-- the papers at the same time."
--
-- What this adds:
--   1. RLS policies on realtime.messages so ONLY paper checkers and admins
--      can join the private Broadcast topic 'paper-review', and so they may
--      write presence (who is online) but never a broadcast message. Every
--      'activity' message on that topic therefore comes from a database
--      trigger below and cannot be forged by a client.
--   2. A trigger on public.audit_review_log (every checker/admin action on
--      the audit_* staging copy) that sends a SMALL private broadcast.
--   3. A trigger on public.bank_question_revisions (admin_* rows only: an
--      admin editing, hiding, merging, deleting... a LIVE question or paper)
--      that sends the same kind of broadcast, translated to the audit_*
--      question/paper ids the checker page actually holds open.
--
-- Why Broadcast from triggers, not postgres_changes: audit_* tables are
-- service-role only (no SELECT for authenticated), and postgres_changes
-- delivers a row only to a subscriber whose role can SELECT it. Granting
-- that SELECT would expose question bodies, which CLAUDE.md forbids.
--
-- Payload contract (never question text, never names or emails):
--   { source: 'audit' | 'live', action, question_id, paper_id,
--     actor_user_id, at }
-- question_id / paper_id are audit_questions.id / audit_papers.id (uuids),
-- or null. actor_user_id is the acting account's uuid (or null for an
-- AI/system row); the checker page needs it to tell "someone else changed
-- the question I have open" from its own action. realtime.send() adds an
-- `id`.
--
-- Failure isolation: realtime.send() already catches every error and only
-- raises a WARNING (read from the live definition, 2026-09-28), and both
-- trigger functions below wrap their whole body in their own
-- begin/exception block as well. A realtime outage can never roll back a
-- checker's or admin's action.
--
-- Volume: human actions (actor_user_id not null) always broadcast; there
-- are a handful of people and each action is a click. Actor-less rows
-- (AI/system batches, which can insert thousands of log rows in one run)
-- broadcast ONLY when the question they touch is currently leased to a
-- checker, i.e. somebody actually has it open. Nothing else needs to hear
-- about them live.
--
-- Grants: both trigger functions are SECURITY DEFINER (owner postgres,
-- which has BYPASSRLS and INSERT on realtime.messages, confirmed read-only
-- 2026-09-28) and are revoked from public, anon AND authenticated by role
-- name -- CLAUDE.md's trap. They are reachable only as triggers.
--
-- Idempotent: CREATE OR REPLACE / DROP ... IF EXISTS throughout.

begin;

-- ============================================================
-- 1. Who may join the 'paper-review' topic, and what they may write.
-- ============================================================

-- Receive: broadcast and presence messages on this one topic, for paper
-- checkers and admins only. is_paper_checker() already includes admins;
-- is_admin() is spelled out so the policy reads the way the design does.
-- Both are SECURITY DEFINER, STABLE and executable by authenticated
-- (checked live 2026-09-28).
drop policy if exists "paper-review: checkers and admins receive" on realtime.messages;
create policy "paper-review: checkers and admins receive"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() = 'paper-review'
    and realtime.messages.extension in ('broadcast', 'presence')
    and (public.is_admin() or public.is_paper_checker())
  );

-- Write: presence ONLY. A client can say "I am online" on this topic, but
-- cannot send a broadcast, so it cannot forge an 'activity' event that
-- would bounce another checker off their question. Activity broadcasts
-- come only from the triggers below, which run as the table owner and so
-- are not subject to this policy.
drop policy if exists "paper-review: checkers and admins track presence" on realtime.messages;
create policy "paper-review: checkers and admins track presence"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.topic() = 'paper-review'
    and realtime.messages.extension = 'presence'
    and (public.is_admin() or public.is_paper_checker())
  );

-- ============================================================
-- 2. audit_review_log -> 'activity'
-- ============================================================
create or replace function public.trg_broadcast_paper_review_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    if new.actor_user_id is null then
      -- AI/system row: only worth a message if a checker has this question
      -- open right now (see "Volume" in the header).
      if new.question_id is null or not exists (
        select 1 from public.audit_questions aq
        where aq.id = new.question_id
          and aq.locked_until is not null
          and aq.locked_until > now()
      ) then
        return null;
      end if;
    end if;

    perform realtime.send(
      jsonb_build_object(
        'source', 'audit',
        'action', new.action,
        'question_id', new.question_id,
        'paper_id', new.paper_id,
        'actor_user_id', new.actor_user_id,
        'at', new.at
      ),
      'activity',
      'paper-review',
      true
    );
  exception when others then
    raise warning 'paper-review broadcast skipped: %', sqlerrm;
  end;
  return null;
end;
$function$;

revoke all on function public.trg_broadcast_paper_review_activity() from public;
revoke all on function public.trg_broadcast_paper_review_activity() from anon;
revoke all on function public.trg_broadcast_paper_review_activity() from authenticated;

comment on function public.trg_broadcast_paper_review_activity() is
  'W13: AFTER INSERT trigger on audit_review_log. Sends a small private Broadcast (topic paper-review, event activity) with action, audit question/paper ids, actor uuid and time. Never question text, names or emails. Trigger-only: revoked from public, anon and authenticated.';

drop trigger if exists audit_review_log_broadcast_activity on public.audit_review_log;
create trigger audit_review_log_broadcast_activity
after insert on public.audit_review_log
for each row execute function public.trg_broadcast_paper_review_activity();

-- ============================================================
-- 3. bank_question_revisions (admin_* rows) -> 'activity'
--
--    An admin edit lands on the LIVE row (bank_questions / bank_papers) and
--    is logged here, not in audit_review_log. The checker page holds an
--    audit_questions row open, linked by live_bank_question_id. So: for a
--    question-level admin change, send one message per UNPASSED audit copy
--    of that live question (normally one, and only those can be open in the
--    checker). For a paper-level change (hide, restore, a paper field),
--    send one message carrying the paper's live_copy audit paper id and no
--    question id -- the admin page refreshes its numbers, the checker page
--    ignores it. live_apply / live_clear rows are skipped: they are written
--    by the chokepoint inside a checker's own action, which audit_review_log
--    has already announced.
-- ============================================================
-- The lookups below run inside an admin's write. Neither column had an
-- index (checked live, read-only, 2026-09-28).
create index if not exists audit_questions_live_bank_question_id_idx
  on public.audit_questions (live_bank_question_id);
create index if not exists audit_papers_live_bank_paper_id_idx
  on public.audit_papers (live_bank_paper_id);

create or replace function public.trg_broadcast_paper_review_live_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_aq record;
  v_sent boolean := false;
  v_audit_paper_id uuid;
begin
  begin
    if new.action not like 'admin\_%' then
      return null;
    end if;

    if new.table_name = 'bank_questions' then
      for v_aq in
        select aq.id, aq.paper_id
        from public.audit_questions aq
        where aq.live_bank_question_id = new.row_id
          and aq.question_passed = false
      loop
        perform realtime.send(
          jsonb_build_object(
            'source', 'live',
            'action', new.action,
            'question_id', v_aq.id,
            'paper_id', v_aq.paper_id,
            'actor_user_id', new.actor_user_id,
            'at', new.created_at
          ),
          'activity',
          'paper-review',
          true
        );
        v_sent := true;
      end loop;
    else
      select ap.id into v_audit_paper_id
      from public.audit_papers ap
      where ap.live_bank_paper_id = new.row_id and ap.source = 'live_copy'
      limit 1;
    end if;

    if not v_sent then
      perform realtime.send(
        jsonb_build_object(
          'source', 'live',
          'action', new.action,
          'question_id', null,
          'paper_id', v_audit_paper_id,
          'actor_user_id', new.actor_user_id,
          'at', new.created_at
        ),
        'activity',
        'paper-review',
        true
      );
    end if;
  exception when others then
    raise warning 'paper-review broadcast skipped: %', sqlerrm;
  end;
  return null;
end;
$function$;

revoke all on function public.trg_broadcast_paper_review_live_change() from public;
revoke all on function public.trg_broadcast_paper_review_live_change() from anon;
revoke all on function public.trg_broadcast_paper_review_live_change() from authenticated;

comment on function public.trg_broadcast_paper_review_live_change() is
  'W13: AFTER INSERT trigger on bank_question_revisions, admin_* rows only. Translates a live question/paper change to the audit_* ids the checker page holds and sends a small private Broadcast (topic paper-review, event activity). Never question text, names or emails. Trigger-only: revoked from public, anon and authenticated.';

drop trigger if exists bank_question_revisions_broadcast_activity on public.bank_question_revisions;
create trigger bank_question_revisions_broadcast_activity
after insert on public.bank_question_revisions
for each row execute function public.trg_broadcast_paper_review_live_change();

commit;

-- ============================================================
-- Checks to run after applying (read-only):
--
-- a) Neither trigger function is reachable by a client role. Both rows must
--    be false in every column:
--
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed,
--          has_function_privilege('public', p.oid, 'EXECUTE') as pub
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('trg_broadcast_paper_review_activity',
--                       'trg_broadcast_paper_review_live_change');
--
-- b) The two policies exist, and nothing else on realtime.messages:
--
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname = 'realtime' and tablename = 'messages';
--
-- c) End to end needs two signed-in accounts (see the W13 log): a checker
--    on /checker and an admin on /admin/paper-review, then one checker
--    action; the admin's numbers and log should move within ~3 seconds.
-- ============================================================
