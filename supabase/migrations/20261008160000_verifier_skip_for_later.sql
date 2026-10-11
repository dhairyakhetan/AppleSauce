-- Skip is always available, and a skipped question waits for later.
--
-- Owner, 8 Oct 2026: "skip is unavailable since it's the last question; this
-- shouldn't be the case. if someone skips, those questions will remain pending
-- in that paper for them to come back to later, but they should be able to go
-- to other papers."
--
-- Nothing on the server refused a skip on the last question (that was the
-- screen), so checker_skip_question is untouched. What changes:
--   * verifier_next_in_paper(paper, include_skipped default false) no longer
--     loops a skipped question straight back: skipped ones are served only when
--     the verifier asks to go through them (include_skipped = true), earliest
--     skipped first, as before. checker_next_question still works: with the
--     default, a paper holding only skipped questions gives nothing and the next
--     paper is tried.
--   * verifier_my_papers() gains `skipped`: how many of the paper's remaining
--     questions this verifier skipped since they got the paper. They are still
--     part of `remaining`, so the paper does not close (verifier_close_finished
--     leaves it alone), the 7 day idle return and the 10 paper cap keep counting
--     it, exactly as today. The counts read audit_review_log_counted (leaves out
--     undone answers, 20261008140000).
--
-- The old one-argument verifier_next_in_paper is dropped (a second overload
-- would make a one-argument call ambiguous). Every function: revoked from
-- public, anon and authenticated, then granted to authenticated.

drop function if exists public.verifier_next_in_paper(uuid);
drop function if exists public.verifier_my_papers();

create or replace function public.verifier_next_in_paper(p_paper_id uuid, p_include_skipped boolean default false)
returns table(id uuid, paper_id uuid, ord integer, display_number text, number_path text, body text,
              options jsonb, marks numeric, instructions text, flag_reasons text[], flag_detail text,
              source jsonb, subject text, school text, cls text, exam text, year text, version integer,
              page integer, page_path text, snippet_path text)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_claimed uuid;
  v_since timestamptz;
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select a.assigned_at into v_since
  from public.checker_assignments a
  where a.audit_paper_id = p_paper_id and a.user_id = v_uid
    and a.status in ('queued', 'assigned');
  if not found then
    raise exception 'This paper is not assigned to you' using errcode = '42501';
  end if;

  for attempt in 1..5 loop
    v_id := null;
    -- Questions this verifier skipped (while holding the paper) wait: they are
    -- served only on request, the earliest skipped first.
    select aq.id into v_id
    from public.audit_questions aq
    left join lateral (select max(s.skipped_at) as at from public.audit_question_skips s
                       where s.question_id = aq.id and s.user_id = v_uid
                         and s.skipped_at >= v_since) sk on true
    where aq.paper_id = p_paper_id
      and aq.review_bucket = 'kid' and aq.question_passed = false and aq.kind = 'question'
      and public.checker_question_servable(aq)
      and (aq.locked_until is null or aq.locked_until < now() or aq.locked_by = v_uid)
      and (coalesce(p_include_skipped, false) or sk.at is null)
    order by case when aq.locked_by = v_uid and aq.locked_until > now() and sk.at is null then 0 else 1 end,
             sk.at nulls first, aq.ord, aq.id
    limit 1;

    if v_id is null then
      perform public.verifier_close_finished(v_uid);
      return;
    end if;

    update public.audit_questions as aqu
    set locked_by = v_uid, locked_until = now() + interval '10 minutes', leased_at = now()
    where aqu.id = v_id
      and (aqu.locked_until is null or aqu.locked_until < now() or aqu.locked_by = v_uid)
    returning aqu.id into v_claimed;
    exit when v_claimed is not null;
  end loop;

  if v_claimed is null then
    return;
  end if;
  return query
    select aq.id, aq.paper_id, aq.ord, aq.display_number, aq.number_path,
           aq.body, aq.options, aq.marks, aq.instructions,
           aq.flag_reasons, aq.flag_detail, aq.source,
           ap.subject, ap.school, ap.class, ap.exam_type, ap.year, aq.version,
           case when (aq.source ->> 'page') ~ '^[0-9]{1,6}$' then (aq.source ->> 'page')::integer end,
           pg.object_path,
           coalesce(nullif(aq.source ->> 'snippet_object', ''), nullif(aq.source ->> 'whole_snippet_object', ''))
    from public.audit_questions aq
    join public.audit_papers ap on ap.id = aq.paper_id
    left join public.audit_paper_pages pg
           on pg.audit_paper_id = aq.paper_id
          and (aq.source ->> 'page') ~ '^[0-9]{1,6}$'
          and pg.page = (aq.source ->> 'page')::integer
    where aq.id = v_claimed;
end;
$$;

create or replace function public.verifier_my_papers()
returns table(assignment_id bigint, paper_id uuid, subject text, school text, cls text, exam text, year text,
              given_by_hod boolean, assigned_at timestamptz,
              total integer, done integer, remaining integer, with_hod integer, skipped integer)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform public.distribute_unassigned_papers();
  perform public.verifier_close_finished(v_uid);
  return query
    with mine as (
      select a.* from public.checker_assignments a
      where a.user_id = v_uid and a.status in ('queued', 'assigned')
    ),
    c as (
      select m.id,
             (select count(*)::int from public.audit_questions q
               where q.paper_id = m.audit_paper_id and q.review_bucket = 'kid'
                 and q.question_passed = false and q.kind = 'question'
                 and public.checker_question_servable(q)) as remaining,
             (select count(distinct l.question_id)::int from public.audit_review_log_counted l
               where l.paper_id = m.audit_paper_id and l.actor_user_id = v_uid
                 and l.at >= m.assigned_at
                 and l.action in ('checker_pass', 'checker_fix', 'checker_printed_typo', 'checker_split')) as done,
             (select count(*)::int from public.audit_questions q
               where q.paper_id = m.audit_paper_id and q.review_bucket = 'escalated'
                 and q.question_passed = false and q.set_aside_at is null) as with_hod,
             (select count(*)::int from public.audit_questions q
               where q.paper_id = m.audit_paper_id and q.review_bucket = 'kid'
                 and q.question_passed = false and q.kind = 'question'
                 and public.checker_question_servable(q)
                 and exists (select 1 from public.audit_question_skips s
                             where s.question_id = q.id and s.user_id = v_uid
                               and s.skipped_at >= m.assigned_at)) as skipped
      from mine m
    )
    select m.id, m.audit_paper_id, ap.subject, ap.school, ap.class, ap.exam_type, ap.year,
           m.assigned_by is not null, m.assigned_at,
           c.done + c.remaining + c.with_hod, c.done, c.remaining, c.with_hod, c.skipped
    from mine m
    join c on c.id = m.id
    join public.audit_papers ap on ap.id = m.audit_paper_id
    order by m.assigned_at, m.id;
end;
$$;

-- ---------------------------------------------------------------- verify

do $$
declare
  src text;
begin
  src := pg_get_functiondef('public.verifier_next_in_paper(uuid, boolean)'::regprocedure);
  if position('coalesce(p_include_skipped, false) or sk.at is null' in src) = 0 then
    raise exception 'patch did not apply: verifier_next_in_paper';
  end if;
  src := pg_get_functiondef('public.verifier_my_papers()'::regprocedure);
  if position('as skipped' in src) = 0 or position('audit_review_log_counted' in src) = 0 then
    raise exception 'patch did not apply: verifier_my_papers';
  end if;
  -- the old one-argument version must be gone
  if to_regprocedure('public.verifier_next_in_paper(uuid)') is not null then
    raise exception 'patch did not apply: old verifier_next_in_paper(uuid) still exists';
  end if;
end $$;

-- ---------------------------------------------------------------- grants

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.verifier_next_in_paper(uuid, boolean)',
    'public.verifier_my_papers()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
