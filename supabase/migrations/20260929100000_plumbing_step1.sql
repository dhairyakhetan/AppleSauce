-- Papers pipeline, step 1 ("fix the plumbing"), approved 2026-09-29.
-- FILE ONLY -- not applied. Builds on 20260929013000_checker_queue_hygiene.sql,
-- which IS applied. Touches no question text, no bank_* writes, no teacher
-- tables. Every replaced function keeps CLAUDE.md's grant pattern: revoke
-- from public AND anon AND authenticated by role name, grant execute to
-- authenticated only, is_admin()/is_paper_checker() checked in the body.
--
-- Measured against production (uvtifolnsneitetzohtn) on 2026-09-29, inside
-- begin ... rollback (nothing committed), with the indexes below created
-- and dropped in the SAME transaction so the "after" numbers are real:
--
--   admin_paper_queue()   raw query: 2429ms / 51835 buffers (report 04)
--                          -> rewritten + indexed: ~24-63ms / ~11600 buffers
--                          target <500ms: MET
--   checker_next_question() raw query: 96ms / 36061 buffers (report 04)
--                          -> rewritten + indexed: ~24-38ms / ~6800-17400 buffers
--                          target <50ms: MET (see caveat in section 2 below)
--
-- ============================================================
-- 1. Indexes
-- ============================================================
-- Backs checker_next_question's per-paper "how many questions does this
-- paper still have open" count (item 2 below) and admin_paper_queue's
-- question-count lateral. Partial on the exact predicate both queries use.
create index if not exists idx_audit_questions_open_by_paper
  on public.audit_questions (paper_id)
  where kind = 'question' and question_passed = false;

-- Backs the "what's actually waiting for a kid checker" scan. Matches the
-- WHERE clause of checker_next_question and checker_queue_facets exactly,
-- including the blank-body check from the hygiene migration, so it can be
-- used as an index-only/bitmap source instead of a sequential filter.
create index if not exists idx_audit_questions_kid_ready
  on public.audit_questions (paper_id)
  where kind = 'question' and review_bucket = 'kid' and question_passed = false
    and btrim(coalesce(body, '')) <> '';

-- Backs admin_paper_queue's escalated-count lateral (review_bucket='escalated'
-- AND question_passed=false is the exact filter it runs per paper).
create index if not exists idx_audit_questions_escalated_open
  on public.audit_questions (paper_id)
  where review_bucket = 'escalated' and question_passed = false;

-- Backs admin_paper_queue's "latest live_copy audit_papers row per bank
-- paper" lookup (previously a per-row ORDER BY + LIMIT 1 lateral, 1960
-- times over; now a single DISTINCT ON scan).
create index if not exists idx_audit_papers_live_copy_created
  on public.audit_papers (live_bank_paper_id, created_at desc)
  where source = 'live_copy';

-- Backs both the 24h "don't re-serve what I skipped" check (already live)
-- and the new 30-minute "don't re-serve this checker's recently-skipped
-- PAPER" check (item 2 below).
create index if not exists idx_audit_question_skips_user_recent
  on public.audit_question_skips (user_id, skipped_at desc);

-- ============================================================
-- 2. admin_paper_queue(): three per-row laterals -> three CTEs
-- ============================================================
-- Same output, same rows, same values. The three LEFT JOIN LATERALs each
-- ran once per bank_papers row (1960 times): a per-row ORDER BY/LIMIT 1
-- over audit_papers, a per-row aggregate over audit_questions, and a
-- per-row join+aggregate over audit_questions+audit_papers. Rewritten as
-- one DISTINCT ON pass over audit_papers and two GROUP BY passes over
-- audit_questions, each run once, then joined to bank_papers.
create or replace function public.admin_paper_queue()
returns table (
  paper_id text, title text, school text, subject text, cls text, board text, year text,
  needs_review boolean, is_published boolean, incomplete_note text,
  audit_paper_id uuid, escalated_count bigint, total_questions bigint, passed_questions bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    with latest_ap as (
      -- CHANGED: one DISTINCT ON scan (index-backed) instead of a
      -- per-bank-paper "ORDER BY created_at DESC LIMIT 1" lateral.
      select distinct on (a.live_bank_paper_id) a.live_bank_paper_id, a.id
      from public.audit_papers a
      where a.source = 'live_copy'
        and coalesce(a.meta_source ->> 'role', '') <> 'rescue'
      order by a.live_bank_paper_id, a.created_at desc
    ),
    audit_counts as (
      -- CHANGED: one GROUP BY over audit_questions instead of a per-paper
      -- aggregate lateral run 1960 times. Column aliased (not "paper_id")
      -- because this function's OUT parameter is also named paper_id.
      select q.paper_id as ac_paper_id,
             count(*) filter (where q.kind = 'question') as total,
             count(*) filter (where q.kind = 'question' and q.question_passed) as passed
      from public.audit_questions q
      group by q.paper_id
    ),
    escalated_counts as (
      select q.paper_id as ec_paper_id, count(*) as n
      from public.audit_questions q
      where q.review_bucket = 'escalated' and q.question_passed = false
      group by q.paper_id
    ),
    esc_per_bank as (
      -- Same semantics as the original esc lateral: summed across EVERY
      -- live_copy audit_papers row that matches this bank paper, not just
      -- the latest one.
      select a.live_bank_paper_id, sum(ec.n) as n
      from public.audit_papers a
      join escalated_counts ec on ec.ec_paper_id = a.id
      where a.source = 'live_copy'
      group by a.live_bank_paper_id
    )
    select bp.id, bp.school || ' ' || bp.subject as title, bp.school, bp.subject, bp.cls, bp.board, bp.year,
           bp.needs_review, bp.is_published, bp.incomplete_note,
           la.id as audit_paper_id,
           coalesce(epb.n, 0)::bigint as escalated_count,
           coalesce(ac.total, 0)::bigint as total_questions,
           coalesce(ac.passed, 0)::bigint as passed_questions
    from public.bank_papers bp
    left join latest_ap la on la.live_bank_paper_id = bp.id
    left join audit_counts ac on ac.ac_paper_id = la.id
    left join esc_per_bank epb on epb.live_bank_paper_id = bp.id
    order by bp.id;
end;
$function$;

revoke all on function public.admin_paper_queue() from public, anon, authenticated;
grant execute on function public.admin_paper_queue() to authenticated;

-- ============================================================
-- 3. checker_next_question(): rewrite + skip-a-paper + English-never
-- ============================================================
-- Three changes on top of the hygiene migration's version:
--   (a) Speed: the per-candidate correlated "how many questions does this
--       paper still have open" subquery (H3: 36,061 buffers to serve one
--       row) is now computed once per DISTINCT candidate paper (candidates
--       CTE + paper_open_counts CTE), not once per candidate ROW.
--   (b) Skip jumps to another paper (owner decision, 2026-09-29): a paper
--       this checker skipped a question from in the last 30 minutes is
--       pushed behind every other paper in the ORDER BY -- but the skipped
--       QUESTION itself is not touched, and it is still served to any
--       OTHER checker immediately (only this checker's ordering changes).
--   (c) English is AI-only (owner): a row is never served here if its
--       paper's subject starts with "English" (any of the three English
--       subject labels) or its own source tag is the english_w14 pipeline.
--       90 open kid-queue rows are English today (see section 5 below);
--       none of them will be served by this function once applied.
--
-- Locking: the original did the ordering and the "for update skip locked"
-- row lock in one statement. Pushing the ordering into CTEs (needed for
-- (a)) means the winning row can no longer be locked in the same SELECT
-- (FOR UPDATE cannot target a CTE). Locking is now compare-and-swap: try
-- to claim the computed winner with an UPDATE ... WHERE <still available>,
-- and if another transaction claimed it in the tiny window between picking
-- and claiming, retry (excluding that id) up to 5 times. At the checker
-- concurrency this system actually has (single digits), this is
-- functionally equivalent to SKIP LOCKED and cannot livelock: each retry
-- permanently excludes the id that just lost the race.
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
        -- CHANGED (item 3): English is never served here.
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
    -- CHANGED (item 1, speed): computed once per distinct candidate paper,
    -- not once per candidate row (H3).
    paper_open_counts as (
      select p.paper_id,
        (select count(*) from public.audit_questions r
          where r.paper_id = p.paper_id and r.kind = 'question' and r.question_passed = false) as open_count
      from paper_ids p
    ),
    -- CHANGED (item 2): papers this checker skipped a question from in the
    -- last 30 minutes.
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
      -- Kept: the question this checker already holds comes back first.
      case when c.locked_by = v_uid and c.locked_until > now() then 0 else 1 end,
      -- NEW: a paper this checker just skipped out of, deprioritised.
      case when sp.paper_id is not null then 1 else 0 end,
      -- Kept: English-doubted rows go last (now moot for English itself,
      -- since English is excluded above; kept for any other pipeline that
      -- sets the same flag).
      case when c.source ->> 'rescue_decision' = 'ai_doubt' then 1 else 0 end,
      -- Kept: live papers first.
      case when c.p_source = 'live_copy' then 0 else 1 end,
      -- Kept: fewest questions left in the paper first.
      coalesce(poc.open_count, 0),
      -- Kept: newest year, then paper order.
      case when c.p_year ~ '^\d+$' then c.p_year::int else 0 end desc,
      c.p_created_at, c.ord
    limit 1;

    if v_id is null then
      return;
    end if;

    -- CHANGED (review SHOULD-FIX): re-check the row's own eligibility in
    -- the claiming UPDATE, not just its lock state. Between the SELECT
    -- above and this UPDATE, another transaction could have passed the
    -- question, moved it out of the kid bucket, or blanked its body; the
    -- lock-state check alone would still let this claim it. Any such row
    -- now fails the WHERE, v_claimed_id stays null, and the loop retries.
    update public.audit_questions
    set locked_by = v_uid, locked_until = now() + interval '10 minutes'
    where public.audit_questions.id = v_id
      and (locked_until is null or locked_until < now() or locked_by = v_uid)
      and review_bucket = 'kid' and not question_passed
      and btrim(coalesce(body, '')) <> ''
    returning public.audit_questions.id into v_claimed_id;

    if v_claimed_id is not null then
      exit;
    end if;

    -- Someone else claimed it between the SELECT and the UPDATE: don't
    -- offer it again this call.
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
           ap.subject, ap.school, ap.class, ap.exam_type, ap.year
    from public.audit_questions aq
    join public.audit_papers ap on ap.id = aq.paper_id
    where aq.id = v_claimed_id;
end;
$function$;

revoke all on function public.checker_next_question() from public, anon, authenticated;
grant execute on function public.checker_next_question() to authenticated;

-- ============================================================
-- 4. English rescue publish trigger: tighten the split-half path
-- ============================================================
-- H4 (stress test): the trigger's WHEN clause allows ANY split
-- (new.split_from_id is not null) to reach english_rescue_publish_split_half(),
-- not just an English-rescue split. Today that function itself refuses
-- anything whose PARENT isn't tagged english_w14/rescue, so nothing wrong
-- happens -- but the WHEN clause is broader than the one case the function
-- actually handles, so a future change to that function (or a new pipeline
-- reusing split_from_id) could publish a question outside the whole-paper
-- gate without the trigger itself ever refusing.
--
-- A trigger's WHEN clause cannot contain a subquery (Postgres restriction),
-- so the parent's tag cannot be checked there directly -- the WHEN clause
-- above stays as broad as it is today. Instead, the guard is duplicated
-- into the DISPATCHER (this function), which now re-verifies the parent's
-- tag itself before ever calling english_rescue_publish_split_half(), so
-- the gate holds even if that function's own internal guard is ever
-- loosened. Behaviour for a real English rescue split is unchanged: the
-- parent lookup here is exactly the same lookup that function already
-- does, so nothing that publishes today stops publishing.
create or replace function public.trg_english_rescue_publish()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_parent public.audit_questions;
begin
  begin
    if new.split_from_id is not null then
      -- CHANGED (H4): re-check the parent's tag here, in the dispatcher,
      -- not only inside english_rescue_publish_split_half().
      select * into v_parent from public.audit_questions where id = new.split_from_id;
      if v_parent.id is not null
         and coalesce(v_parent.source ->> 'pipeline', '') = 'english_w14'
         and coalesce(v_parent.source ->> 'role', '') = 'rescue' then
        perform public.english_rescue_publish_split_half(new.id);
      end if;
      -- else: not an English-rescue split. No-op, same as the function's
      -- own (still-intact) guard would have produced.
    else
      perform public.english_rescue_publish_question(new.id);
    end if;
  exception when others then
    insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
    values (null, null, new.paper_id, new.id, 'live_apply',
            'english rescue publish FAILED, retry with english_rescue_publish_paper: ' || sqlerrm);
  end;
  return new;
end;
$function$;

revoke all on function public.trg_english_rescue_publish() from public, anon, authenticated;
-- No grant: only ever invoked by the trigger itself (SECURITY DEFINER),
-- exactly as before.

-- ============================================================
-- 5. Checkers by email (owner decision, 2026-09-29)
-- ============================================================
-- admin_grant_paper_checker(uuid) / admin_revoke_paper_checker(uuid) /
-- admin_list_checkers() already exist (paper_checker_and_admin,
-- 2026-09-28) but take a user id, which nobody outside the database has a
-- reason to know. These three add an email-based front door for the admin
-- UI; the id-based functions are left as-is (nothing currently calls them
-- from outside the database, but removing them isn't this migration's job).

create or replace function public.admin_add_checker(p_email text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select id into v_user_id from auth.users where lower(email) = lower(p_email);
  if v_user_id is null then
    raise exception 'No account with the email %; they must sign up first', p_email using errcode = 'P0002';
  end if;

  insert into public.paper_checkers (user_id, active, granted_by, granted_at, revoked_at)
  values (v_user_id, true, auth.uid(), now(), null)
  on conflict (user_id) do update
    set active = true, granted_by = auth.uid(), granted_at = now(), revoked_at = null;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), null, null, 'admin_add_checker', p_email);

  return v_user_id;
end;
$function$;

revoke all on function public.admin_add_checker(text) from public, anon, authenticated;
grant execute on function public.admin_add_checker(text) to authenticated;

create or replace function public.admin_remove_checker(p_user_id uuid)
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
  values (null, auth.uid(), null, null, 'admin_remove_checker', p_user_id::text);
end;
$function$;

revoke all on function public.admin_remove_checker(uuid) from public, anon, authenticated;
grant execute on function public.admin_remove_checker(uuid) to authenticated;

-- New RPC under a NEW name, admin_list_checker_accounts(): the OLD
-- admin_list_checkers() (active, granted_at, passed_count/fixed_count/
-- split_count/escalated_count) is NOT dropped or replaced here. It IS
-- called today: src/lib/checker-api.ts's adminListCheckers() and
-- src/pages/admin/paper-review.tsx (~412-436) both read its old shape,
-- including revoked (active = false) checkers so an admin can reactivate
-- them from that page. Dropping it would break paper-review.tsx. The new
-- "add checkers by email" admin page (src/lib/checker-admin-api.ts) is
-- pointed at this new function instead.
create or replace function public.admin_list_checker_accounts()
returns table (
  user_id uuid, email text, full_name text, added_at timestamptz,
  checked_today bigint, checked_total bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select pc.user_id, u.email::text, p.full_name, pc.granted_at as added_at,
           count(*) filter (
             where l.action in ('checker_pass', 'checker_fix', 'checker_split', 'checker_ask_help')
               and l.at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
           ) as checked_today,
           count(*) filter (
             where l.action in ('checker_pass', 'checker_fix', 'checker_split', 'checker_ask_help')
           ) as checked_total
    from public.paper_checkers pc
    join auth.users u on u.id = pc.user_id
    left join public.profiles p on p.id = pc.user_id
    left join public.audit_review_log l on l.actor_user_id = pc.user_id
    where pc.active
    group by pc.user_id, u.email, p.full_name, pc.granted_at
    order by pc.granted_at desc;
end;
$function$;

revoke all on function public.admin_list_checker_accounts() from public, anon, authenticated;
grant execute on function public.admin_list_checker_accounts() to authenticated;

-- ============================================================
-- Verify after applying (CLAUDE.md: has_function_privilege, never proacl):
--   select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') authd
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname in ('admin_paper_queue',
--     'checker_next_question', 'admin_add_checker', 'admin_remove_checker',
--     'admin_list_checker_accounts');
--   -- expect anon = false and authd = true on every row
-- ---------------------------------------------------------------------------
-- English kid-queue rows (item 3): 90 open 'kid' rows are English today
-- (measured 2026-09-29: 86 by aq.source->>'pipeline' = 'english_w14', 90
-- by ap.subject ilike 'English%' -- the union of both is 90). None of them
-- are moved by this migration; checker_next_question() above simply never
-- serves them. Proposed (NOT executed) data move, once the owner confirms
-- 'admin' is the right destination -- 'ai' is not a legal review_bucket
-- value today (constraint audit_questions_review_bucket_check allows only
-- kid/admin/data/renderer/none/escalated; adding 'ai' would need its own
-- migration to widen that constraint first):
--
--   select count(*) from public.audit_questions aq
--   join public.audit_papers ap on ap.id = aq.paper_id
--   where aq.kind = 'question' and aq.review_bucket = 'kid' and aq.question_passed = false
--     and ap.source in ('live_copy', 'new_ocr') and btrim(coalesce(aq.body, '')) <> ''
--     and (coalesce(ap.subject, '') ilike 'English%'
--          or coalesce(aq.source ->> 'pipeline', '') = 'english_w14');
--   -- 90
--
--   update public.audit_questions aq
--   set review_bucket = 'admin'
--   from public.audit_papers ap
--   where ap.id = aq.paper_id
--     and aq.kind = 'question' and aq.review_bucket = 'kid' and aq.question_passed = false
--     and ap.source in ('live_copy', 'new_ocr') and btrim(coalesce(aq.body, '')) <> ''
--     and (coalesce(ap.subject, '') ilike 'English%'
--          or coalesce(aq.source ->> 'pipeline', '') = 'english_w14');
