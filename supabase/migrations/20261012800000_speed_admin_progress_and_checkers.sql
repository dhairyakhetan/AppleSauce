-- Admin People tab: two functions over the 3 second budget on live data
-- (role check, 12 October 2026): admin_paper_progress 8.3 s cold / 4.6 s warm,
-- admin_checker_list 10.2 s cold / 2.2 s warm.
--
-- WHY (EXPLAIN (ANALYZE, BUFFERS) on live data, as an admin):
--   admin_paper_progress
--     * audit_questions (65 MB heap, wide rows because of body) was read end to
--       end by a sequential scan only to count three small things per paper.
--     * audit_review_log (63 MB heap, wide rows because of before/after) was read
--       through audit_review_log_paper_id_idx, i.e. one heap visit per log row
--       (66 600 of them), with two memoized profile/user lookups per row, only
--       to take a max and a list of distinct actors per paper.
--   admin_checker_list
--     * audit_review_log was sequentially scanned TWICE for the system rows (once
--       for the "pipeline" row, once for the AI rows, 8 000 pages each, because
--       the existing partial index does not carry the undone_at condition the
--       view adds) and every AI row then did its own audit_questions
--       primary-key lookup (37 900 of them, 150 000 buffer hits).
--     * content_checks (13 MB) and bank_question_revisions (13 MB) were read
--       whole to produce 3 and 11 groups.
--
-- WHAT CHANGES: both functions are rewritten around pre-aggregated CTEs, and
-- small partial indexes let those aggregates run as index-only scans.
-- Same signature, same columns, same rows, same order, same admin gate, same
-- grants. Proven row for row against the previous bodies in a rolled-back
-- rehearsal (EXCEPT both ways on one snapshot).

-- 1. Indexes (each answers one aggregate without touching the wide heap) -------

-- admin_paper_progress: total and cleared per paper from the index alone. The
-- open-doubt count already has idx_audit_questions_kid_ready, whose predicate is
-- exactly the one the new query uses.
create index if not exists audit_questions_question_paper_passed_idx
  on public.audit_questions (paper_id, question_passed)
  where kind = 'question';

-- admin_paper_progress: last activity and distinct actors per paper, by paper
-- then actor, without reading before/after.
create index if not exists audit_review_log_paper_actor_at_idx
  on public.audit_review_log (paper_id, actor_user_id, at)
  where undone_at is null and paper_id is not null;

-- admin_checker_list, system log rows: every system row (action, question, time,
-- id) without the wide heap, and the ~1 150 rows whose note names a model, which
-- are the only rows that need their note read.
create index if not exists audit_review_log_system_live_idx
  on public.audit_review_log (action, question_id, at, id)
  where actor_user_id is null and undone_at is null;

create index if not exists audit_review_log_system_model_note_idx
  on public.audit_review_log (id)
  where actor_user_id is null and undone_at is null
    and (lower(coalesce(note, '')) like '%sonnet%' or lower(coalesce(note, '')) like '%haiku%');

-- admin_checker_list: checked_by per question without reading the 65 MB heap.
create index if not exists audit_questions_id_checked_by_idx
  on public.audit_questions (id) include (checked_by);

-- admin_checker_list: the two remaining whole-table reads. Both tables have a
-- handful of groups and many wide rows.
create index if not exists content_checks_counted_actor_idx
  on public.content_checks (checker_kind, actor_user_id, model, created_at)
  where undone_at is null;

create index if not exists bank_question_revisions_actor_at_idx
  on public.bank_question_revisions (actor_user_id, actor, created_at);

-- 2. admin_paper_progress ---------------------------------------------------------

create or replace function public.admin_paper_progress()
 returns table(audit_paper_id uuid, live_bank_paper_id text, subject text, cls text, school text, open_doubts bigint, cleared bigint, total bigint, pct_done numeric, last_activity timestamp with time zone, workers text[])
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  with q as (
    -- total and cleared: index-only on audit_questions_question_paper_passed_idx
    select
      aq.paper_id as ap_id,
      count(*) filter (where aq.question_passed = true) as cleared,
      count(*) as total
    from public.audit_questions aq
    where aq.kind = 'question'
    group by aq.paper_id
  ),
  kid as (
    -- open doubts: exactly the predicate of idx_audit_questions_kid_ready
    select aq.paper_id as ap_id, count(*) as open_doubts
    from public.audit_questions aq
    where aq.kind = 'question'
      and aq.review_bucket = 'kid'
      and aq.question_passed = false
      and btrim(coalesce(aq.body, '')) <> ''
    group by aq.paper_id
  ),
  by_actor as (
    -- one row per (paper, actor): index-only on audit_review_log_paper_actor_at_idx
    select l.paper_id as ap_id, l.actor_user_id, max(l.at) as last_at
    from public.audit_review_log_counted l
    where l.paper_id is not null
    group by l.paper_id, l.actor_user_id
  ),
  actor_name as (
    -- the name lookup runs once per distinct person, not once per log row
    select a.actor_user_id, coalesce(pr.full_name, u.email::text) as nm
    from (select distinct b.actor_user_id from by_actor b where b.actor_user_id is not null) a
    left join public.profiles pr on pr.id = a.actor_user_id
    left join auth.users u on u.id = a.actor_user_id
  ),
  activity as (
    select
      b.ap_id,
      max(b.last_at) as last_activity,
      array_agg(distinct n.nm) filter (where b.actor_user_id is not null) as workers
    from by_actor b
    left join actor_name n on n.actor_user_id = b.actor_user_id
    group by b.ap_id
  )
  select
    ap.id as audit_paper_id,
    ap.live_bank_paper_id,
    ap.subject,
    ap.class as cls,
    ap.school,
    coalesce(kid.open_doubts, 0) as open_doubts,
    coalesce(q.cleared, 0) as cleared,
    coalesce(q.total, 0) as total,
    case when coalesce(q.total, 0) = 0 then 0
         else round(100.0 * coalesce(q.cleared, 0) / q.total, 1) end as pct_done,
    act.last_activity,
    coalesce(act.workers, '{}') as workers
  from public.audit_papers ap
  left join q on q.ap_id = ap.id
  left join kid on kid.ap_id = ap.id
  left join activity act on act.ap_id = ap.id
  where ap.source in ('live_copy', 'new_ocr')
  order by coalesce(kid.open_doubts, 0) desc, ap.subject, ap.class;
end;
$function$;

-- 3. admin_checker_list -----------------------------------------------------------

create or replace function public.admin_checker_list()
 returns table(actor_key text, name text, role text, first_at timestamp with time zone, last_at timestamp with time zone, total_actions integer)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- history_actor_key() only asks whether the note or the question's
  -- checked_by contains "sonnet" or "haiku" (lower case, in that order). So:
  --   * every system row comes from audit_review_log_system_live_idx
  --     (index-only, no note);
  --   * the few rows whose note names a model come from
  --     audit_review_log_system_model_note_idx and keep their two note flags;
  --   * every other AI row has both flags false, which is what its note would
  --     have said.
  -- The hint handed to history_actor_key() is rebuilt from the flags and
  -- checked_by, which answers its two LIKE tests exactly as the full note would.
  return query
    with marked as (
      select l.id, l.action, l.question_id, l.at,
             lower(coalesce(l.note, '')) like '%sonnet%' as ns,
             lower(coalesce(l.note, '')) like '%haiku%' as nh
      from public.audit_review_log l
      where l.actor_user_id is null and l.undone_at is null
        and (lower(coalesce(l.note, '')) like '%sonnet%' or lower(coalesce(l.note, '')) like '%haiku%')
    ),
    plain as (
      select l.id, l.action, l.question_id, l.at
      from public.audit_review_log l
      where l.actor_user_id is null and l.undone_at is null
    ),
    pipe as (
      select p.action, min(p.at) as f, max(p.at) as l, count(*) as n
      from plain p
      group by p.action
    ),
    ai_rows as (
      select p.question_id, p.at, false as ns, false as nh
      from plain p
      join public.log_action_catalog c on c.action = p.action and c.kind = 'ai'
      where not exists (select 1 from marked m where m.id = p.id)
      union all
      select m.question_id, m.at, m.ns, m.nh
      from marked m
      join public.log_action_catalog c on c.action = m.action and c.kind = 'ai'
    ),
    keyed as (
      select l.actor_user_id::text as k, min(l.at) as f, max(l.at) as l, count(*) as n
      from public.audit_review_log_counted l
      where l.actor_user_id is not null
      group by l.actor_user_id
      union all
      select 'pipeline', min(a.f), max(a.l), sum(a.n)
      from pipe a
      left join public.log_action_catalog c on c.action = a.action
      where c.kind is distinct from 'ai'
      union all
      select public.history_actor_key(null, null,
               concat_ws(' ', case when ai.ns then 'sonnet' end, case when ai.nh then 'haiku' end, q.checked_by)),
             min(ai.at), max(ai.at), count(*)
      from ai_rows ai
      left join public.audit_questions q on q.id = ai.question_id
      group by 1
      union all
      select public.history_actor_key(g.actor_user_id, g.checker_kind, g.model), min(g.f), max(g.l), sum(g.n)
      from (select k.actor_user_id, k.checker_kind, k.model, min(k.created_at) as f, max(k.created_at) as l, count(*) as n
            from public.content_checks_counted k
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

-- 4. Grants (unchanged by create or replace; restated so the file is self-proving)

revoke all on function public.admin_paper_progress() from public;
revoke all on function public.admin_paper_progress() from anon;
revoke all on function public.admin_paper_progress() from authenticated;
grant execute on function public.admin_paper_progress() to authenticated;

revoke all on function public.admin_checker_list() from public;
revoke all on function public.admin_checker_list() from anon;
revoke all on function public.admin_checker_list() from authenticated;
grant execute on function public.admin_checker_list() to authenticated;

analyze public.audit_questions;
analyze public.audit_review_log;
analyze public.content_checks;
analyze public.bank_question_revisions;
