-- Hygiene round 27 (2026-10-03).
--
-- 1. admin_checker_list() took 415 ms warm and 4.6 s cold (Checkers page).
--    Its third branch ran history_actor_key() once per AI log row (about 60 000
--    rows) before grouping. It now groups the AI rows by what the key depends on
--    (note, the question's checked_by) first and builds the key once per group.
--    Same columns, same rows, same order, same grants (create or replace keeps
--    them), same admin gate.
--
--    The "pipeline" branch counted 85 000 system log rows through a join; it now
--    groups by action first (an index-only scan with the partial index below) and
--    joins the catalog on about 35 rows. Measured warm: 415 ms -> 260-300 ms, output identical row for row in a rolled-back rehearsal;
--    cold reads touch far fewer pages.
--
-- 2. history_actor_key() and history_action_bucket() had a mutable search_path
--    (advisor function_search_path_mutable). Pinned to public, pg_temp. Their
--    bodies are untouched.

create index if not exists audit_review_log_system_action_at_idx
  on public.audit_review_log (action, at) where actor_user_id is null;

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
      select 'pipeline', min(a.f), max(a.l), sum(a.n)
      from (select l.action, min(l.at) as f, max(l.at) as l, count(*) as n
            from public.audit_review_log l
            where l.actor_user_id is null
            group by l.action) a
      left join public.log_action_catalog c on c.action = a.action
      where c.kind is distinct from 'ai'
      union all
      select public.history_actor_key(null, null, concat_ws(' ', ai.note, ai.checked_by)), min(ai.f), max(ai.l), sum(ai.n)
      from (
        select l.note, q.checked_by, min(l.at) as f, max(l.at) as l, count(*) as n
        from public.audit_review_log l
        join public.log_action_catalog c on c.action = l.action and c.kind = 'ai'
        left join public.audit_questions q on q.id = l.question_id
        where l.actor_user_id is null
        group by l.note, q.checked_by
      ) ai
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

alter function public.history_actor_key(uuid, text, text) set search_path = public, pg_temp;
alter function public.history_action_bucket(text) set search_path = public, pg_temp;
