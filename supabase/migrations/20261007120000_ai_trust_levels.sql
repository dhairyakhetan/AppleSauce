-- Trust by confidence.
--
-- Owner, 7 Oct 2026: "in the beginning, ALL questions need to be validated
-- (even ones claude marks as confident). after a while, if we see that 100%
-- (or at least 97%) of questions that claude marks as highly confident are
-- correct (i.e. passed directly without edits) - we'll start trusting claude's
-- high confidence and not pass those on for verification. similar for
-- medium/low confidence ... (and ofc, if claude marks a question as this
-- probably has some issue, that'll always move to a checker for review)".
-- Decisions: bar "97% over 200+ per level"; 1 in 20 trusted questions still
-- spot-checked; past AI passes: "Sample 300 for checking".
--
-- Levels come from the scores the AI check already writes to content_checks
-- (no prompt change): the deciding score is the lower of the two Haiku scores
-- when both Haikus passed it, else Sonnet's score.
--   high    score >= 0.95
--   medium  0.85 <= score < 0.95
--   low     score < 0.85
--   issue   the AI sent it to a person (flag, disagreement, unsure, typo):
--           never trustable, always a person.
-- Trust is kept per level AND per decision (pass = AI said the words are
-- right, fix = AI changed the words), because a confident pass and a
-- confident rewrite are different bets.
--
-- A person's check counts as "AI was right" when no person changed the words
-- (fix, printed typo, split) and no HOD set it aside after the AI decided.
-- A level is trusted only when an admin presses the switch, and only once it
-- has 200+ person checks at 97%+. It switches itself off when the latest 200
-- checks of that level fall below 97% (ai_trust_recheck, run by the daily
-- pipeline and before every AI apply).

-- ---------------------------------------------------------------- columns

alter table public.audit_questions
  add column if not exists ai_confidence text
    check (ai_confidence is null or ai_confidence in ('high', 'medium', 'low', 'issue')),
  add column if not exists ai_confidence_score numeric
    check (ai_confidence_score is null or (ai_confidence_score >= 0 and ai_confidence_score <= 1)),
  add column if not exists ai_decision text
    check (ai_decision is null or ai_decision in ('pass', 'fix', 'escalate')),
  add column if not exists ai_decided_at timestamptz,
  -- Why a person is looking at a question the AI had settled.
  add column if not exists ai_review_reason text
    check (ai_review_reason is null or ai_review_reason in ('validation', 'spot_check', 'past_sample'));

create index if not exists audit_questions_ai_review
  on public.audit_questions (ai_confidence, ai_decision) where ai_review_reason is not null;

create table if not exists public.ai_trust_levels (
  level           text not null check (level in ('high', 'medium', 'low')),
  decision        text not null check (decision in ('pass', 'fix')),
  trusted         boolean not null default false,
  changed_at      timestamptz,
  changed_by      uuid references auth.users(id) on delete set null,
  auto_off_at     timestamptz,
  auto_off_reason text,
  primary key (level, decision)
);
alter table public.ai_trust_levels enable row level security;
revoke all on public.ai_trust_levels from public, anon, authenticated;

insert into public.ai_trust_levels (level, decision)
select l, d from unnest(array['high', 'medium', 'low']) l cross join unnest(array['pass', 'fix']) d
on conflict do nothing;

-- ---------------------------------------------------------------- helpers

-- The bar, in one place for the database, the pipeline and the website.
create or replace function public.ai_trust_bar()
returns table(min_rate numeric, min_checked integer, spot_check_every integer)
language sql immutable
as $$ select 0.97::numeric, 200, 20; $$;

create or replace function public.ai_confidence_level(p_score numeric)
returns text
language sql immutable
as $$
  select case when p_score is null then 'low'
              when p_score >= 0.95 then 'high'
              when p_score >= 0.85 then 'medium'
              else 'low' end;
$$;

-- One row per AI-settled question a person has looked at: was the AI right?
create or replace function public.ai_trust_outcomes()
returns table(question_id uuid, subject text, level text, decision text, reason text,
              checked_at timestamptz, as_is boolean)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  with seen as (
    select q.id, ap.subject, q.ai_confidence, q.ai_decision, q.ai_review_reason, q.ai_decided_at
    from public.audit_questions q
    join public.audit_papers ap on ap.id = q.paper_id
    where q.ai_review_reason is not null
      and q.ai_decision in ('pass', 'fix')
      and q.ai_confidence in ('high', 'medium', 'low')
      and q.ai_decided_at is not null
  ),
  people as (
    select s.id,
           max(k.created_at) filter (where k.verdict in ('pass', 'fix', 'printed_typo')) as last_at,
           bool_or(k.verdict in ('fix', 'printed_typo')) as changed
    from seen s
    join public.content_checks k
      on k.table_name = 'audit_questions' and k.row_id = s.id::text
     and k.checker_kind in ('student', 'hod', 'admin')
     and k.created_at >= s.ai_decided_at
    group by s.id
  ),
  other as (
    select s.id, max(l.at) as last_at
    from seen s
    join public.audit_review_log l
      on l.question_id = s.id and l.at >= s.ai_decided_at
     and l.action in ('checker_split', 'hod_set_aside')
    group by s.id
  )
  select s.id, s.subject, s.ai_confidence, s.ai_decision, s.ai_review_reason,
         greatest(p.last_at, o.last_at),
         (o.id is null and not coalesce(p.changed, false))
  from seen s
  left join people p on p.id = s.id
  left join other o on o.id = s.id
  where p.last_at is not null or o.id is not null;
$$;

-- Switch off any trusted level whose latest checks fell below the bar.
-- Returns the levels it switched off.
create or replace function public.ai_trust_recheck()
returns table(level text, decision text, recent_checked integer, recent_rate numeric)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  b record;
  t record;
  n int;
  r numeric;
begin
  select * into b from public.ai_trust_bar();
  for t in select * from public.ai_trust_levels x where x.trusted loop
    select count(*), avg(case when o.as_is then 1 else 0 end)
      into n, r
    from (select * from public.ai_trust_outcomes() o
          where o.level = t.level and o.decision = t.decision
          order by o.checked_at desc
          limit b.min_checked) o;
    if n > 0 and r < b.min_rate then
      update public.ai_trust_levels x
      set trusted = false, auto_off_at = now(),
          auto_off_reason = format('latest %s checks were %s%% right, below %s%%',
                                   n, round(r * 100, 1), round(b.min_rate * 100))
      where x.level = t.level and x.decision = t.decision;
      insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
      values (null, null, null, null, 'ai_trust_auto_off',
              format('%s %s: latest %s checks %s%% right', t.level, t.decision, n, round(r * 100, 1)));
      level := t.level; decision := t.decision; recent_checked := n; recent_rate := r;
      return next;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------- what the HOD and admin see

-- One row per level and decision, for all subjects (subject null) and per
-- subject. "waiting" = AI-settled questions still with a person.
create or replace function public.ai_trust_meter()
returns table(level text, decision text, subject text, checked integer, as_is integer, rate numeric,
              waiting integer, trusted boolean, eligible boolean, auto_off_at timestamptz,
              auto_off_reason text, min_rate numeric, min_checked integer, spot_check_every integer)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    with b as (select * from public.ai_trust_bar()),
    o as (select * from public.ai_trust_outcomes()),
    w as (
      select q.ai_confidence as level, q.ai_decision as decision, ap.subject, count(*)::int as n
      from public.audit_questions q
      join public.audit_papers ap on ap.id = q.paper_id
      where q.ai_review_reason is not null and q.question_passed = false and q.set_aside_at is null
        and q.ai_decision in ('pass', 'fix')
      group by grouping sets ((q.ai_confidence, q.ai_decision, ap.subject), (q.ai_confidence, q.ai_decision))
    ),
    g as (
      select o.level, o.decision, o.subject, count(*)::int as checked,
             count(*) filter (where o.as_is)::int as as_is
      from o
      group by grouping sets ((o.level, o.decision, o.subject), (o.level, o.decision))
    ),
    keys as (
      select t.level, t.decision, null::text as subject from public.ai_trust_levels t
      union
      select g.level, g.decision, g.subject from g where g.subject is not null
      union
      select w.level, w.decision, w.subject from w where w.subject is not null
    )
    select k.level, k.decision, k.subject,
           coalesce(g.checked, 0), coalesce(g.as_is, 0),
           case when coalesce(g.checked, 0) > 0 then round(g.as_is::numeric / g.checked, 4) end,
           coalesce(w.n, 0),
           t.trusted,
           coalesce(g.checked, 0) >= b.min_checked and coalesce(g.as_is::numeric / nullif(g.checked, 0), 0) >= b.min_rate,
           t.auto_off_at, t.auto_off_reason,
           b.min_rate, b.min_checked, b.spot_check_every
    from keys k
    cross join b
    join public.ai_trust_levels t on t.level = k.level and t.decision = k.decision
    left join g on g.level = k.level and g.decision = k.decision and g.subject is not distinct from k.subject
    left join w on w.level = k.level and w.decision = k.decision and w.subject is not distinct from k.subject
    order by case k.level when 'high' then 0 when 'medium' then 1 else 2 end, k.decision, k.subject nulls first;
end;
$$;

-- The admin switch. Trusting needs the bar met across all subjects.
create or replace function public.admin_set_ai_trust(p_level text, p_decision text, p_trusted boolean)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  b record;
  n int;
  r numeric;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.ai_trust_levels x where x.level = p_level and x.decision = p_decision) then
    raise exception 'Unknown level %/%', p_level, p_decision using errcode = '22023';
  end if;
  if p_trusted then
    select * into b from public.ai_trust_bar();
    select count(*), avg(case when o.as_is then 1 else 0 end) into n, r
    from public.ai_trust_outcomes() o where o.level = p_level and o.decision = p_decision;
    if n < b.min_checked or coalesce(r, 0) < b.min_rate then
      raise exception 'Not earned yet: % checked, % right (needs % checked and % right)',
        n, coalesce(round(r * 100, 1), 0) || '%', b.min_checked, round(b.min_rate * 100) || '%'
        using errcode = '22023';
    end if;
  end if;
  update public.ai_trust_levels x
  set trusted = p_trusted, changed_at = now(), changed_by = auth.uid(),
      auto_off_at = case when p_trusted then null else x.auto_off_at end,
      auto_off_reason = case when p_trusted then null else x.auto_off_reason end
  where x.level = p_level and x.decision = p_decision;
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), null, null, 'admin_set_ai_trust',
          format('%s %s -> %s', p_level, p_decision, case when p_trusted then 'trusted' else 'checked by people' end));
end;
$$;

-- ---------------------------------------------------------------- backfill and past sample

-- Fill ai_* for questions the AI has already settled, from content_checks.
-- Idempotent; only rows with no ai_decision yet.
create or replace function public.ai_backfill_confidence()
returns integer
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  n int;
begin
  with d as (
    select q.id,
           case when q.checked_by = 'ai:haiku+haiku'
                then (select min(k.confidence) from public.content_checks k
                      where k.table_name = 'audit_questions' and k.row_id = q.id::text
                        and k.checker_kind in ('haiku_paddle', 'haiku_pdf') and k.verdict = 'pass')
                else (select k.confidence from public.content_checks k
                      where k.table_name = 'audit_questions' and k.row_id = q.id::text
                        and k.checker_kind = 'sonnet'
                      order by k.created_at desc, k.id desc limit 1) end as score,
           (select max(l.at) from public.audit_review_log l
             where l.question_id = q.id and l.action in ('ai_pass', 'ai_fix', 'ai_escalate')) as at,
           exists (select 1 from public.audit_review_log l
                   where l.question_id = q.id and l.action = 'ai_fix') as fixed,
           exists (select 1 from public.audit_review_log l
                   where l.question_id = q.id and l.action = 'ai_escalate') as escalated
    from public.audit_questions q
    where q.kind = 'question' and q.checked_by like 'ai:%' and q.ai_decision is null
  )
  update public.audit_questions q
  set ai_confidence_score = d.score,
      ai_decided_at = coalesce(d.at, q.updated_at),
      ai_decision = case when d.escalated and not q.question_passed then 'escalate'
                         when d.fixed then 'fix' else 'pass' end,
      ai_confidence = case when d.escalated and not q.question_passed then 'issue'
                           else public.ai_confidence_level(d.score) end
  from d
  where q.id = d.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Owner: "Sample 300 for checking". A random sample of questions the AI
-- passed or fixed with no person looking goes to the checkers, tagged
-- past_sample. Only questions a checker can actually be served (picture,
-- words, eligible paper). Dry run unless p_apply.
create or replace function public.ai_sample_past_passes(p_n integer, p_apply boolean)
returns table(level text, decision text, picked integer)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_ids uuid[];
begin
  select array_agg(x.id) into v_ids
  from (
    select q.id
    from public.audit_questions q
    where q.kind = 'question' and q.question_passed and q.review_bucket = 'none'
      and q.set_aside_at is null and q.ai_review_reason is null
      and q.ai_decision in ('pass', 'fix') and q.ai_confidence in ('high', 'medium', 'low')
      and public.checker_body_ok(q) and public.checker_has_picture(q)
      and coalesce(q.source ->> 'pipeline', '') <> 'english_w14'
      and exists (select 1 from public.audit_papers ap
                  where ap.id = q.paper_id and ap.source in ('live_copy', 'new_ocr')
                    and not (coalesce(ap.subject, '') ilike 'English%'))
    order by random()
    limit greatest(0, least(coalesce(p_n, 0), 1000))
  ) x;

  if p_apply and v_ids is not null then
    update public.audit_questions q
    set status = 'flagged', question_passed = false, review_bucket = 'kid',
        ai_review_reason = 'past_sample', locked_by = null, locked_until = null
    where q.id = any(v_ids);
    insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
    select null, null, q.paper_id, q.id, 'ai_trust_sample', 'review_bucket',
           to_jsonb('none'::text), to_jsonb('kid'::text),
           format('owner 2026-10-07 "Sample 300 for checking": AI %s at %s confidence, sent to a checker', q.ai_decision, q.ai_confidence)
    from public.audit_questions q where q.id = any(v_ids);
  end if;

  return query
    select q.ai_confidence, q.ai_decision, count(*)::int
    from public.audit_questions q where q.id = any(coalesce(v_ids, array[]::uuid[]))
    group by 1, 2 order by 1, 2;
end;
$$;

-- ---------------------------------------------------------------- grants

do $$
declare
  f text;
begin
  foreach f in array array['public.ai_trust_meter()', 'public.admin_set_ai_trust(text, text, boolean)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- Pipeline (service key) only.
  foreach f in array array['public.ai_trust_recheck()', 'public.ai_backfill_confidence()',
                           'public.ai_sample_past_passes(integer, boolean)', 'public.ai_trust_outcomes()',
                           'public.ai_trust_bar()', 'public.ai_confidence_level(numeric)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

grant select on public.ai_trust_levels to service_role;

insert into public.log_action_catalog (action, kind, meaning) values
  ('admin_set_ai_trust', 'admin',  'An admin changed which AI confidence levels are trusted'),
  ('ai_trust_auto_off',  'system', 'An AI confidence level stopped being trusted because people corrected it too often'),
  ('ai_trust_sample',    'system', 'A question the AI had settled was sent to a checker to measure the AI')
on conflict (action) do nothing;

select public.ai_backfill_confidence();
