-- Owner-approved 2026-09-29. Two changes:
--
-- 1. AUTO-RETURN. "[Hidden papers] come back automatically when their
--    questions clear" -- apply_live_copy_paper_to_live() (the chokepoint
--    every checker/AI pass through to write into bank_questions /
--    bank_papers) currently only ever clears bank_papers.needs_review; it
--    never touches is_published. The 369 papers hidden on 2026-09-28
--    (bank_question_revisions: table_name='bank_papers', field='is_published',
--    action='admin_hide', actor='ai:empty-paper-hide', reason='published
--    with zero questions; owner 2026-09-29: hide until filled') were logged
--    precisely so this could be reversed automatically and safely. This
--    migration patches the chokepoint, from its LIVE definition (read via
--    pg_get_functiondef 2026-09-29, unique anchors, refuses to apply if the
--    expected text is not found), to republish a paper when, at the end of
--    a chokepoint run for it: (a) it now has at least one bank_questions
--    row, AND (b) the MOST RECENT bank_question_revisions row for that
--    paper's is_published field was logged by actor 'ai:empty-paper-hide'
--    -- i.e. nothing else (an admin-red hide, a manual restore-then-rehide,
--    anything) has had the last word on its visibility since. A paper
--    hidden for any other reason (104 rows, actor 'owner-decision', "hide
--    marking schemes and tutor notes") is never touched by this. The
--    republish is itself logged the same way, action 'auto_return', field
--    'is_published', reason 'auto_return: questions cleared', so it is
--    exactly as auditable and reversible as the original hide.
--
--    Verified live (read-only, 2026-09-29): all 369 empty-hide papers are
--    still hidden and still have zero bank_questions rows today, so this
--    migration republishes 0 papers on apply -- it only wires up the path
--    for when a checker or re-import actually adds their questions back.
--
-- 2. LEASE TIMING. admin_team_stats() (HOD/Team dashboard) has always
--    returned median_seconds = null because nothing recorded when a
--    checker's lease on a question STARTED, only when it expires
--    (locked_until). Fix, in three small pieces:
--      a. audit_questions.leased_at (nullable timestamptz): set to now()
--         in checker_next_question()'s claiming UPDATE, alongside the
--         locked_by/locked_until it already sets. Patched from the LIVE
--         definition the same way as the chokepoint above.
--      b. audit_review_log.seconds_on_question (nullable numeric), filled
--         by a new BEFORE INSERT trigger that -- for the four checker
--         action rows (checker_pass, checker_fix, checker_ask_help,
--         checker_skip) -- looks up that question's leased_at and stores
--         the elapsed seconds. The whole lookup is wrapped in its own
--         begin/exception block (the same guard just applied to the two
--         existing audit_review_log-adjacent triggers in
--         20260929120000/2916aa4: "a log failure must never abort a
--         pipeline write" -- here, never abort the checker's own action),
--         so a bad lookup can only ever cost a null median input, never
--         block a pass/fix/help/skip.
--      c. admin_team_stats() redefined so median_seconds is
--         percentile_cont(0.5) of seconds_on_question per user over the
--         window, NULLs dropped. Its RETURNS TABLE signature is untouched
--         (median_seconds numeric stays in the same position), so
--         src/lib/team-dashboard-api.ts needs no change.
--
-- Everything below is CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS /
-- DROP TRIGGER IF EXISTS + CREATE TRIGGER, and is idempotent. Security
-- definer, search_path and existing grants are preserved throughout: the
-- two chokepoint/queue functions are patched via pg_get_functiondef (which
-- keeps CREATE OR REPLACE, so ACLs are untouched) and their revokes are
-- restated explicitly below anyway, matching what has_function_privilege
-- shows live today.

begin;

-- bank_question_revisions.action is a closed enum via CHECK constraint;
-- 'auto_return' is a new, distinct action (never used for a human/admin
-- hide or restore) so it must be added before anything can insert it.
alter table public.bank_question_revisions drop constraint bank_question_revisions_action_check;
alter table public.bank_question_revisions add constraint bank_question_revisions_action_check
  check (action = any (array[
    'admin_edit', 'admin_merge', 'admin_split', 'admin_reorder', 'admin_add',
    'admin_delete', 'admin_hide', 'admin_restore', 'admin_undo',
    'live_apply', 'live_clear', 'auto_return'
  ]));

-- ============================================================
-- 1a. apply_live_copy_paper_to_live(): auto-return.
-- ============================================================

do $patch$
declare
  d text;
  n text;
  v_declare_block text := $decl$v_any_unplaced boolean := false;
  v_last_hide_actor text;
  v_qcount int;$decl$;
  v_auto_return_block text := $ar$  -- ---- Auto-return (owner 2026-09-29): a paper hidden only because it
  --      had zero questions comes back once it has at least one -- but
  --      only when this logged hide is still the last word on the
  --      paper's is_published state. A hide logged for any other reason
  --      (e.g. admin-red) is never overridden here.
  select r.actor into v_last_hide_actor
  from public.bank_question_revisions r
  where r.table_name = 'bank_papers' and r.row_id = v_live_paper_id and r.field = 'is_published'
  order by r.created_at desc, r.id desc
  limit 1;

  if v_last_hide_actor = 'ai:empty-paper-hide' then
    select count(*) into v_qcount from public.bank_questions where paper_id = v_live_paper_id;
    if v_qcount >= 1 then
      select to_jsonb(bp.*) into v_before from public.bank_papers bp where bp.id = v_live_paper_id;
      if v_before is not null and (v_before->>'is_published')::boolean is distinct from true then
        update public.bank_papers set is_published = true where id = v_live_paper_id;
        insert into public.bank_question_revisions
          (table_name, row_id, action, field, before, after, actor, source, audit_paper_id, reason)
        values ('bank_papers', v_live_paper_id, 'auto_return', 'is_published',
                to_jsonb(false), to_jsonb(true), 'system:chokepoint', 'system', p_audit_paper_id,
                'auto_return: questions cleared');
      end if;
    end if;
  end if;

$ar$;
begin
  select pg_get_functiondef('public.apply_live_copy_paper_to_live(uuid)'::regprocedure) into d;

  n := replace(d, 'v_any_unplaced boolean := false;', v_declare_block);
  if n = d then
    raise exception 'apply_live_copy_paper_to_live: declare anchor not found';
  end if;
  d := n;

  n := replace(d, E'end;\n$function$', v_auto_return_block || E'end;\n$function$');
  if n = d then
    raise exception 'apply_live_copy_paper_to_live: end anchor not found';
  end if;
  d := n;

  execute d;
end
$patch$;

revoke all on function public.apply_live_copy_paper_to_live(uuid) from public, anon, authenticated;

-- ============================================================
-- 1b. checker_next_question(): stamp leased_at on claim.
-- ============================================================

alter table public.audit_questions add column if not exists leased_at timestamptz;

do $patch$
declare
  d text;
  n text;
begin
  select pg_get_functiondef('public.checker_next_question()'::regprocedure) into d;

  n := replace(
    d,
    E'set locked_by = v_uid, locked_until = now() + interval \'10 minutes\'',
    E'set locked_by = v_uid, locked_until = now() + interval \'10 minutes\', leased_at = now()'
  );
  if n = d then
    raise exception 'checker_next_question: claiming UPDATE anchor not found';
  end if;
  d := n;

  execute d;
end
$patch$;

revoke all on function public.checker_next_question() from public, anon, authenticated;
grant execute on function public.checker_next_question() to authenticated;

-- ============================================================
-- 2. audit_review_log.seconds_on_question, filled by trigger.
-- ============================================================

alter table public.audit_review_log add column if not exists seconds_on_question numeric;

-- Same failure-isolation pattern as trg_log_audit_question_created /
-- trg_log_audit_question_ai_verdict / trg_broadcast_paper_review_activity
-- (2916aa4): the lookup is wrapped in its own begin/exception so a bad
-- lookup can never abort the checker's pass/fix/help/skip it rides on --
-- it only ever costs a null median input.
create or replace function public.trg_audit_review_log_seconds_on_question()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_leased_at timestamptz;
begin
  if new.action in ('checker_pass', 'checker_fix', 'checker_ask_help', 'checker_skip')
     and new.question_id is not null then
    begin
      select public.audit_questions.leased_at into v_leased_at
      from public.audit_questions
      where public.audit_questions.id = new.question_id;

      if v_leased_at is not null then
        new.seconds_on_question := extract(epoch from (coalesce(new.at, now()) - v_leased_at));
      end if;
    exception when others then
      raise warning 'audit_review_log seconds_on_question skipped: %', sqlerrm;
    end;
  end if;
  return new;
end;
$function$;

revoke all on function public.trg_audit_review_log_seconds_on_question() from public, anon, authenticated;

drop trigger if exists audit_review_log_seconds_on_question on public.audit_review_log;
create trigger audit_review_log_seconds_on_question
before insert on public.audit_review_log
for each row execute function public.trg_audit_review_log_seconds_on_question();

-- ============================================================
-- 3. admin_team_stats(): real median_seconds. Signature unchanged.
-- ============================================================

do $patch$
declare
  d text;
  n text;
begin
  select pg_get_functiondef('public.admin_team_stats(timestamp with time zone, timestamp with time zone)'::regprocedure) into d;

  n := replace(
    d,
    E'    group by l.actor_user_id\n  )\n  select\n    pu.actor_user_id as user_id,',
    E'    group by l.actor_user_id\n  ),\n  seconds_by_user as (\n    select l.actor_user_id, l.seconds_on_question\n    from public.audit_review_log l\n    where l.actor_user_id is not null\n      and l.at >= p_from and l.at < p_to\n      and l.action in (\'checker_pass\', \'checker_fix\', \'checker_ask_help\', \'checker_skip\')\n      and l.seconds_on_question is not null\n  ),\n  median_by_user as (\n    select s.actor_user_id, percentile_cont(0.5) within group (order by s.seconds_on_question) as median_seconds\n    from seconds_by_user s\n    group by s.actor_user_id\n  )\n  select\n    pu.actor_user_id as user_id,'
  );
  if n = d then
    raise exception 'admin_team_stats: overturns/select anchor not found';
  end if;
  d := n;

  n := replace(d, 'null::numeric as median_seconds,', 'round(mb.median_seconds::numeric, 1) as median_seconds,');
  if n = d then
    raise exception 'admin_team_stats: median_seconds select-list anchor not found';
  end if;
  d := n;

  n := replace(
    d,
    E'  left join overturns ov on ov.actor_user_id = pu.actor_user_id\n  order by questions_checked desc;',
    E'  left join overturns ov on ov.actor_user_id = pu.actor_user_id\n  left join median_by_user mb on mb.actor_user_id = pu.actor_user_id\n  order by questions_checked desc;'
  );
  if n = d then
    raise exception 'admin_team_stats: final join/order anchor not found';
  end if;
  d := n;

  execute d;
end
$patch$;

revoke all on function public.admin_team_stats(timestamp with time zone, timestamp with time zone) from public, anon, authenticated;
grant execute on function public.admin_team_stats(timestamp with time zone, timestamp with time zone) to authenticated;

commit;
