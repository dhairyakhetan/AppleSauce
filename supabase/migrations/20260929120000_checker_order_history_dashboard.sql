-- Owner brief "Round 6" (00 Owner Brief and Answers.md) + pipeline-plan
-- 11 Step 1 Plumbing.md follow-up. NOT applied by this commit -- dry-run
-- tested inside begin/rollback against production, see
-- "14 Order History Dashboard.md" for the plain-English writeup and the
-- dry-run results.
--
-- Three things:
--   1. checker_next_question: "fewest open doubts" must count only the
--      questions a checker actually has to clear (review_bucket = 'kid',
--      not yet passed, not blank, not English) -- not every unpassed
--      question in the paper (admin/data/renderer/none rows included).
--      Starts from the LIVE definition (pg_get_functiondef, fetched
--      2026-09-29), keeps every existing qualification the 2026-09-29
--      hotfix (b15bed3) already applied, and touches nothing else.
--   2. admin_question_history(p_question_id): one merged, time-ordered
--      timeline per question id, from every source that already logs
--      against a question id, plus two new triggers that close the two
--      gaps this uncovered (see "What was NOT logged" below).
--   3. admin_team_stats(p_from, p_to) and admin_paper_progress(): the HOD
--      dashboard's two queries.
--
-- Every function here: SECURITY DEFINER, SET search_path = public,
-- REVOKE from public/anon/authenticated by name (Supabase's default
-- privilege grant is per-role, not per-schema -- CLAUDE.md's "trap"),
-- then GRANT to authenticated only, with is_admin() checked inside the
-- body as the real gate.

-- ===========================================================================
-- 1. checker_next_question: count only "doubts a checker must clear"
-- ===========================================================================

create or replace function public.checker_next_question()
 returns table(id uuid, paper_id uuid, ord integer, display_number text, number_path text, body text, options jsonb, marks numeric, instructions text, flag_reasons text[], flag_detail text, source jsonb, subject text, school text, cls text, exam text, year text)
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
    -- CHANGED (owner Round 6, 2026-09-29): "the paper with the fewest
    -- questions needing a check comes first" -- fewest OPEN CHECKER
    -- DOUBTS, i.e. rows still in the 'kid' bucket, unpassed, non-blank and
    -- non-English (the ones a checker must actually clear), NOT every
    -- unpassed row in the paper (which also counts admin/data/renderer/
    -- none-bucket rows that no checker will ever see). The previous
    -- version of this CTE counted `r.question_passed = false` alone,
    -- which over-counted every paper by everything sitting in a bucket a
    -- checker never sees.
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

    -- Every reference to an OUT-parameter name (id, paper_id, ord,
    -- display_number, number_path, body, options, marks, instructions,
    -- flag_reasons, flag_detail, source, subject, school, cls, exam, year)
    -- inside this statement is qualified with `public.audit_questions.` --
    -- this exact ambiguity (an unqualified `body`) took the live checker
    -- down for the whole day, hotfixed in 20260929110000. locked_by /
    -- locked_until / review_bucket / question_passed are not OUT-parameter
    -- names, so they cannot be ambiguous, but are qualified too for the
    -- same discipline.
    update public.audit_questions
    set locked_by = v_uid, locked_until = now() + interval '10 minutes'
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
           ap.subject, ap.school, ap.class, ap.exam_type, ap.year
    from public.audit_questions aq
    join public.audit_papers ap on ap.id = aq.paper_id
    where aq.id = v_claimed_id;
end;
$function$;

revoke all on function public.checker_next_question() from public, anon, authenticated;
grant execute on function public.checker_next_question() to authenticated;

-- ===========================================================================
-- 2a. Close the two logging gaps found while building the per-question
--     timeline (see "What was NOT logged" in 14 Order History Dashboard.md):
--
--     - A question being FLAGGED (by the import pipeline or a rule) never
--       wrote a row anywhere -- only the current flag_reasons/flag_detail
--       sat on the row itself, with no "when" or "why it started".
--     - An AI verdict (audit_questions.source, e.g. rescue_decision:
--       'ai_doubt') is a single mutable jsonb column: every time an AI
--       pass rewrites it, the PREVIOUS verdict is gone with no trace.
--
--     Both are closed the same way: an AFTER INSERT / AFTER UPDATE
--     trigger writes one row to the existing audit_review_log for every
--     future row, keyed on the question's own id, same table the checker
--     actions already log to. Nothing about checker_pass/fix/ask_help/
--     skip changes; those already log correctly.
-- ===========================================================================

create or replace function public.trg_log_audit_question_created()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.kind = 'question' then
    -- A logging failure must never abort the pipeline's own insert.
    begin
      insert into public.audit_review_log
        (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
      values (
        null, null, new.paper_id, new.id,
        case when coalesce(array_length(new.flag_reasons, 1), 0) > 0 then 'ai_flagged' else 'created' end,
        'flag_reasons', null, to_jsonb(new.flag_reasons), new.flag_detail
      );
    exception when others then
      raise warning 'audit_question created log skipped: %', sqlerrm;
    end;
  end if;
  return new;
end;
$function$;

drop trigger if exists audit_question_log_created on public.audit_questions;
create trigger audit_question_log_created
  after insert on public.audit_questions
  for each row execute function public.trg_log_audit_question_created();

revoke all on function public.trg_log_audit_question_created() from public, anon, authenticated;

create or replace function public.trg_log_audit_question_ai_verdict()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.source is distinct from old.source then
    -- A logging failure must never abort the pipeline's own update.
    begin
      insert into public.audit_review_log
        (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after)
      values (null, null, new.paper_id, new.id, 'ai_verdict', 'source', old.source, new.source);
    exception when others then
      raise warning 'audit_question ai_verdict log skipped: %', sqlerrm;
    end;
  end if;
  return new;
end;
$function$;

drop trigger if exists audit_question_log_ai_verdict on public.audit_questions;
create trigger audit_question_log_ai_verdict
  after update on public.audit_questions
  for each row
  when (new.source is distinct from old.source)
  execute function public.trg_log_audit_question_ai_verdict();

revoke all on function public.trg_log_audit_question_ai_verdict() from public, anon, authenticated;

-- ===========================================================================
-- 2b. admin_question_history: one merged, time-ordered timeline per
--     question id (owner: "every question has one traceable history,
--     keyed on its question id").
--
--     Sources merged:
--       - audit_review_log (question_id = p_question_id) -- every checker
--         action (pass/fix/split/ask_help/skip), every admin action that
--         already logs here, and (from this migration on) 'created' /
--         'ai_flagged' / 'ai_verdict' rows from the two triggers above.
--       - bank_question_revisions (audit_question_id = p_question_id, OR
--         row_id = this question's live_bank_question_id) -- every change
--         apply_live_copy_paper_to_live or an admin edit made to the LIVE
--         row, with a real before/after jsonb diff.
--
--     Deliberately NOT a third source: audit_question_skips. Every skip
--     already produces an audit_review_log row (action = 'checker_skip',
--     written by checker_skip_question itself) with the same actor and
--     timestamp -- pulling the skips table too would double every skip in
--     the timeline.
-- ===========================================================================

create or replace function public.admin_question_history(p_question_id uuid)
 returns table (
   at timestamptz,
   actor_kind text,
   actor_name text,
   action text,
   detail text,
   before jsonb,
   after jsonb
 )
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v_live_id text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select aq.live_bank_question_id into v_live_id
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
      l.after as after
    from public.audit_review_log l
    left join public.profiles p on p.id = l.actor_user_id
    left join auth.users u on u.id = l.actor_user_id
    where l.question_id = p_question_id
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
      r.after as after
    from public.bank_question_revisions r
    left join public.profiles pr on pr.id = r.actor_user_id
    left join auth.users au on au.id = r.actor_user_id
    where r.audit_question_id = p_question_id
       or (v_live_id is not null and r.row_id = v_live_id)
  )
  select * from log_rows
  union all
  select * from revision_rows
  order by at asc;
end;
$function$;

revoke all on function public.admin_question_history(uuid) from public, anon, authenticated;
grant execute on function public.admin_question_history(uuid) to authenticated;

-- ===========================================================================
-- 3a. admin_team_stats: per checker, for the HOD dashboard.
--
--     median_seconds is returned as NULL, on purpose, not guessed at.
--     "Lease to action" needs a lease-START timestamp, but
--     checker_authorize_question / the pass|fix|ask_help|skip functions
--     all NULL OUT locked_by/locked_until the moment the action completes
--     -- so by the time an action is logged, the row no longer remembers
--     when the lease that led to it began. This is a real gap, not a
--     missing SQL trick: closing it needs a small change to log the lease
--     start (e.g. a `leased_at` column on audit_review_log, set by
--     checker_next_question's claiming UPDATE), which is a separate,
--     small follow-up migration -- listed in
--     "14 Order History Dashboard.md" rather than guessed at here.
-- ===========================================================================

create or replace function public.admin_team_stats(p_from timestamptz, p_to timestamptz)
 returns table (
   user_id uuid,
   name text,
   questions_checked bigint,
   passed bigint,
   fixed bigint,
   asked_help bigint,
   skipped bigint,
   papers_completed bigint,
   median_seconds numeric,
   admin_overturns bigint
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
  with acts as (
    select l.actor_user_id, l.action, l.paper_id, l.question_id, l.at
    from public.audit_review_log l
    where l.actor_user_id is not null
      and l.at >= p_from and l.at < p_to
      and l.action in ('checker_pass', 'checker_fix', 'checker_ask_help', 'checker_skip')
  ),
  per_user as (
    select
      a.actor_user_id,
      count(*) filter (where a.action = 'checker_pass') as passed,
      count(*) filter (where a.action = 'checker_fix') as fixed,
      count(*) filter (where a.action = 'checker_ask_help') as asked_help,
      count(*) filter (where a.action = 'checker_skip') as skipped
    from acts a
    group by a.actor_user_id
  ),
  papers_done as (
    select a.actor_user_id, count(distinct a.paper_id) as papers_completed
    from acts a
    join public.audit_papers ap on ap.id = a.paper_id
    where a.action in ('checker_pass', 'checker_fix') and ap.paper_passed = true
    group by a.actor_user_id
  ),
  -- "admin overturns" = a later admin edit (bank_question_revisions row by
  -- an admin) landing on a question this checker had passed or fixed.
  overturns as (
    select l.actor_user_id, count(*) as n
    from public.audit_review_log l
    join public.bank_question_revisions r
      on r.audit_question_id = l.question_id
     and r.created_at > l.at
     and r.actor_user_id is not null
     and r.actor_user_id is distinct from l.actor_user_id
     and r.actor_user_id in (select ad.id from public.admins ad)
    where l.action in ('checker_pass', 'checker_fix')
      and l.actor_user_id is not null
      and l.at >= p_from and l.at < p_to
    group by l.actor_user_id
  )
  select
    pu.actor_user_id as user_id,
    coalesce(pr.full_name, u.email::text, 'Unknown') as name,
    coalesce(pu.passed, 0) + coalesce(pu.fixed, 0) + coalesce(pu.asked_help, 0) as questions_checked,
    coalesce(pu.passed, 0) as passed,
    coalesce(pu.fixed, 0) as fixed,
    coalesce(pu.asked_help, 0) as asked_help,
    coalesce(pu.skipped, 0) as skipped,
    coalesce(pd.papers_completed, 0) as papers_completed,
    null::numeric as median_seconds,
    coalesce(ov.n, 0) as admin_overturns
  from per_user pu
  left join public.profiles pr on pr.id = pu.actor_user_id
  left join auth.users u on u.id = pu.actor_user_id
  left join papers_done pd on pd.actor_user_id = pu.actor_user_id
  left join overturns ov on ov.actor_user_id = pu.actor_user_id
  order by questions_checked desc;
end;
$function$;

revoke all on function public.admin_team_stats(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_team_stats(timestamptz, timestamptz) to authenticated;

-- ===========================================================================
-- 3b. admin_paper_progress: per paper, for the same dashboard.
-- ===========================================================================

create or replace function public.admin_paper_progress()
 returns table (
   audit_paper_id uuid,
   live_bank_paper_id text,
   subject text,
   cls text,
   school text,
   open_doubts bigint,
   cleared bigint,
   total bigint,
   pct_done numeric,
   last_activity timestamptz,
   workers text[]
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
  with q as (
    select
      aq.paper_id as ap_id,
      count(*) filter (
        where aq.review_bucket = 'kid' and aq.question_passed = false
          and btrim(coalesce(aq.body, '')) <> ''
      ) as open_doubts,
      count(*) filter (where aq.question_passed = true) as cleared,
      count(*) as total
    from public.audit_questions aq
    where aq.kind = 'question'
    group by aq.paper_id
  ),
  activity as (
    select
      l.paper_id as ap_id,
      max(l.at) as last_activity,
      array_agg(distinct coalesce(pr.full_name, u.email::text))
        filter (where l.actor_user_id is not null) as workers
    from public.audit_review_log l
    left join public.profiles pr on pr.id = l.actor_user_id
    left join auth.users u on u.id = l.actor_user_id
    where l.paper_id is not null
    group by l.paper_id
  )
  select
    ap.id as audit_paper_id,
    ap.live_bank_paper_id,
    ap.subject,
    ap.class as cls,
    ap.school,
    coalesce(q.open_doubts, 0) as open_doubts,
    coalesce(q.cleared, 0) as cleared,
    coalesce(q.total, 0) as total,
    case when coalesce(q.total, 0) = 0 then 0
         else round(100.0 * coalesce(q.cleared, 0) / q.total, 1) end as pct_done,
    act.last_activity,
    coalesce(act.workers, '{}') as workers
  from public.audit_papers ap
  left join q on q.ap_id = ap.id
  left join activity act on act.ap_id = ap.id
  where ap.source in ('live_copy', 'new_ocr')
  order by coalesce(q.open_doubts, 0) desc, ap.subject, ap.class;
end;
$function$;

revoke all on function public.admin_paper_progress() from public, anon, authenticated;
grant execute on function public.admin_paper_progress() to authenticated;

-- ===========================================================================
-- Indexes the three new lookups lean on.
-- ===========================================================================

create index if not exists idx_audit_review_log_question_id on public.audit_review_log (question_id);
create index if not exists idx_audit_review_log_actor_at on public.audit_review_log (actor_user_id, at);
create index if not exists idx_audit_review_log_paper_at on public.audit_review_log (paper_id, at);
create index if not exists idx_bank_question_revisions_audit_question_id on public.bank_question_revisions (audit_question_id);
create index if not exists idx_bank_question_revisions_row_id on public.bank_question_revisions (row_id);
