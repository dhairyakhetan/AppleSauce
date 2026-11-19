-- Per-checker work and a Head of Department (HOD) view.
--
-- Owner, 7 Oct 2026: "every checker should have their own view (questions
-- assigned to them, which keep coming one after the other, one paper at a
-- time) and hods ka view alag hona chahiye - they'd see watv's escalated to em
-- or howev each member's performing + what's assigned to each member".
-- Decisions: "One HOD over everyone"; assignment "Auto, HOD can move".
--
-- What changes:
--   * paper_hods: who is an HOD. is_hod() is true for admins too.
--   * checker_assignments: a whole paper belongs to one checker at a time.
--     checker_next_question() keeps its exact return shape, but now serves
--     only the caller's assigned paper, in printed order, and auto-assigns
--     the next paper when that one runs out. An HOD can assign, queue, move
--     and unassign papers.
--   * Escalations ("Ask for help", review_bucket = 'escalated') are resolved
--     by the HOD with the same versioned pass / fix functions checkers use,
--     or sent back to the checkers, or set aside.
--   * content_checks records an HOD's verdict as checker_kind 'hod'.
--   * Set-aside questions are no longer served to checkers (13 were).
--
-- Every new function is SECURITY DEFINER with its role check inside, revoked
-- from public, anon and authenticated, then granted to authenticated only.

-- ---------------------------------------------------------------- tables

create table if not exists public.paper_hods (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  active     boolean not null default true,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.paper_hods enable row level security;
revoke all on public.paper_hods from public, anon, authenticated;

create table if not exists public.checker_assignments (
  id             bigint generated always as identity primary key,
  audit_paper_id uuid not null references public.audit_papers(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  assigned_by    uuid references auth.users(id) on delete set null, -- null = given automatically
  status         text not null default 'assigned'
                 check (status in ('queued', 'assigned', 'done', 'returned')),
  assigned_at    timestamptz not null default now(),
  started_at     timestamptz,                                      -- when it became the checker's current paper
  closed_at      timestamptz,
  closed_reason  text
);
alter table public.checker_assignments enable row level security;
revoke all on public.checker_assignments from public, anon, authenticated;

-- A paper is held by at most one checker (current or queued); a checker has
-- at most one current paper.
create unique index if not exists checker_assignments_one_holder
  on public.checker_assignments (audit_paper_id) where status in ('queued', 'assigned');
create unique index if not exists checker_assignments_one_current
  on public.checker_assignments (user_id) where status = 'assigned';
create index if not exists checker_assignments_user_status
  on public.checker_assignments (user_id, status, assigned_at);

alter table public.content_checks drop constraint if exists content_checks_checker_kind_check;
alter table public.content_checks add constraint content_checks_checker_kind_check
  check (checker_kind = any (array['haiku_paddle', 'haiku_pdf', 'sonnet', 'student', 'admin', 'hod']));

-- ---------------------------------------------------------------- roles

create or replace function public.is_hod()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select public.is_admin() or exists (
    select 1 from public.paper_hods h where h.user_id = auth.uid() and h.active
  );
$$;

-- Who is recording a verdict, for content_checks.checker_kind.
create or replace function public.checker_kind_for_caller()
returns text
language sql stable security definer
set search_path to 'public'
as $$
  select case
    when public.is_admin() then 'admin'
    when exists (select 1 from public.paper_hods h where h.user_id = auth.uid() and h.active) then 'hod'
    else 'student' end;
$$;

create or replace function public.admin_add_hod(p_email text)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_user_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'No account with the email %; they must sign up first', p_email using errcode = 'P0002';
  end if;
  insert into public.paper_hods (user_id, active, granted_by, granted_at, revoked_at)
  values (v_user_id, true, auth.uid(), now(), null)
  on conflict (user_id) do update
    set active = true, granted_by = auth.uid(), granted_at = now(), revoked_at = null;
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), null, null, 'admin_add_hod', p_email);
  return v_user_id;
end;
$$;

create or replace function public.admin_remove_hod(p_user_id uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.paper_hods set active = false, revoked_at = now() where user_id = p_user_id;
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), null, null, 'admin_remove_hod', p_user_id::text);
end;
$$;

create or replace function public.admin_list_hods()
returns table(user_id uuid, email text, name text, active boolean, granted_at timestamptz)
language plpgsql stable security definer
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select h.user_id, u.email::text, public.history_actor_from_key(h.user_id::text) ->> 'name',
           h.active, h.granted_at
    from public.paper_hods h
    join auth.users u on u.id = h.user_id
    order by h.active desc, h.granted_at desc;
end;
$$;

-- ---------------------------------------------------------------- serving

-- One question a checker may be served: the rules checker_next_question has
-- always applied, in one place, plus "not set aside". Plain SQL with no
-- SECURITY DEFINER or SET clause so the planner can inline it and check the
-- cheap columns first; it is only ever called from definer functions.
create or replace function public.checker_question_servable(p_q public.audit_questions)
returns boolean
language sql stable
as $$
  select p_q.kind = 'question'
     and p_q.review_bucket = 'kid'
     and p_q.question_passed = false
     and p_q.set_aside_at is null
     and public.checker_body_ok(p_q)
     and public.checker_has_picture(p_q)
     and coalesce(p_q.source ->> 'pipeline', '') <> 'english_w14'
     and exists (
       select 1 from public.audit_papers ap
       where ap.id = p_q.paper_id
         and ap.source in ('live_copy', 'new_ocr')
         and not (coalesce(ap.subject, '') ilike 'English%')
     );
$$;

-- Close the caller's current paper if nothing is left in it for them, then
-- promote their oldest queued paper. Returns the current paper id or null.
create or replace function public.checker_settle_current(p_uid uuid)
returns uuid
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_a public.checker_assignments;
  v_left_for_me int;
  v_left_at_all int;
begin
  for i in 1..20 loop
    v_a := null;
    select * into v_a from public.checker_assignments
    where user_id = p_uid and status = 'assigned' for update;

    if v_a.id is null then
      -- Promote the oldest queued paper, if any.
      update public.checker_assignments
      set status = 'assigned', started_at = now()
      where id = (select id from public.checker_assignments
                  where user_id = p_uid and status = 'queued'
                  order by assigned_at, id limit 1)
      returning * into v_a;
      if v_a.id is null then
        return null;
      end if;
    end if;

    select count(*) filter (
             where (q.locked_until is null or q.locked_until < now() or q.locked_by = p_uid)
               and not exists (select 1 from public.audit_question_skips s
                               where s.question_id = q.id and s.user_id = p_uid
                                 and s.skipped_at > now() - interval '24 hours')),
           count(*)
      into v_left_for_me, v_left_at_all
    from public.audit_questions q
    where q.paper_id = v_a.audit_paper_id
      and (q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question' and public.checker_question_servable(q));

    if v_left_for_me > 0 then
      return v_a.audit_paper_id;
    end if;

    update public.checker_assignments
    set status = case when v_left_at_all = 0 then 'done' else 'returned' end,
        closed_at = now(),
        closed_reason = case when v_left_at_all = 0 then 'all questions checked'
                             else 'only skipped questions were left' end
    where id = v_a.id;
  end loop;
  return null;
end;
$$;

-- Same return shape as before, so the existing checker screen keeps working.
create or replace function public.checker_next_question()
returns table(id uuid, paper_id uuid, ord integer, display_number text, number_path text, body text,
              options jsonb, marks numeric, instructions text, flag_reasons text[], flag_detail text,
              source jsonb, subject text, school text, cls text, exam text, year text, version integer)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_subjects text[];
  v_classes text[];
  v_paper uuid;
  v_id uuid;
  v_claimed_id uuid;
  v_tried uuid[] := array[]::uuid[];
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

  for attempt in 1..8 loop
    v_paper := public.checker_settle_current(v_uid);

    if v_paper is null then
      -- Give the caller the next paper nobody holds, in their subjects and
      -- classes. Nearly finished papers first, then live papers, newest year.
      select c.paper_id into v_paper
      from (
        select aq.paper_id, count(*) as open_count
        from public.audit_questions aq
        where (aq.review_bucket = 'kid' and aq.question_passed = false and aq.kind = 'question' and public.checker_question_servable(aq))
          and (aq.locked_until is null or aq.locked_until < now() or aq.locked_by = v_uid)
          and not exists (select 1 from public.audit_question_skips s
                          where s.question_id = aq.id and s.user_id = v_uid
                            and s.skipped_at > now() - interval '24 hours')
        group by aq.paper_id
      ) c
      join public.audit_papers ap on ap.id = c.paper_id
      where not exists (select 1 from public.checker_assignments ca
                        where ca.audit_paper_id = c.paper_id and ca.status in ('queued', 'assigned'))
        and (v_subjects is null or array_length(v_subjects, 1) is null or ap.subject = any(v_subjects))
        and (v_classes is null or array_length(v_classes, 1) is null or ap.class = any(v_classes))
        and not (c.paper_id = any(v_tried))
      order by case when ap.source = 'live_copy' then 0 else 1 end,
               c.open_count,
               case when ap.year ~ '^\d+$' then ap.year::int else 0 end desc,
               ap.created_at
      limit 1;

      if v_paper is null then
        return;  -- nothing left for this checker
      end if;

      begin
        insert into public.checker_assignments (audit_paper_id, user_id, assigned_by, status, started_at)
        values (v_paper, v_uid, null, 'assigned', now());
      exception when unique_violation then
        -- Someone else took it a moment ago; try another paper.
        v_tried := v_tried || v_paper;
        continue;
      end;
    end if;

    -- The next question of the current paper, in printed order.
    select aq.id into v_id
    from public.audit_questions aq
    where aq.paper_id = v_paper
      and (aq.review_bucket = 'kid' and aq.question_passed = false and aq.kind = 'question' and public.checker_question_servable(aq))
      and (aq.locked_until is null or aq.locked_until < now() or aq.locked_by = v_uid)
      and not exists (select 1 from public.audit_question_skips s
                      where s.question_id = aq.id and s.user_id = v_uid
                        and s.skipped_at > now() - interval '24 hours')
    order by case when aq.locked_by = v_uid and aq.locked_until > now() then 0 else 1 end,
             aq.ord, aq.id
    limit 1;

    if v_id is null then
      continue;  -- settle will close this paper on the next pass
    end if;

    update public.audit_questions as aqu
    set locked_by = v_uid, locked_until = now() + interval '10 minutes', leased_at = now()
    where aqu.id = v_id
      and (aqu.locked_until is null or aqu.locked_until < now() or aqu.locked_by = v_uid)
      and (aqu.review_bucket = 'kid' and aqu.question_passed = false and aqu.kind = 'question' and public.checker_question_servable(aqu))
    returning aqu.id into v_claimed_id;

    exit when v_claimed_id is not null;
  end loop;

  if v_claimed_id is null then
    return;
  end if;
  return query
    select aq.id, aq.paper_id, aq.ord, aq.display_number, aq.number_path,
           aq.body, aq.options, aq.marks, aq.instructions,
           aq.flag_reasons, aq.flag_detail, aq.source,
           ap.subject, ap.school, ap.class, ap.exam_type, ap.year,
           aq.version
    from public.audit_questions aq
    join public.audit_papers ap on ap.id = aq.paper_id
    where aq.id = v_claimed_id;
end;
$$;

-- The caller's current paper and how far through it they are.
create or replace function public.checker_my_assignment()
returns table(assignment_id bigint, paper_id uuid, subject text, school text, cls text, exam text,
              year text, given_by_hod boolean, started_at timestamptz,
              done_count integer, remaining_count integer, queued_count integer)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_paper uuid;
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  v_paper := public.checker_settle_current(v_uid);
  if v_paper is null then
    return;
  end if;
  return query
    select a.id, a.audit_paper_id, ap.subject, ap.school, ap.class, ap.exam_type, ap.year,
           a.assigned_by is not null, coalesce(a.started_at, a.assigned_at),
           (select count(distinct l.question_id)::int from public.audit_review_log l
             where l.paper_id = a.audit_paper_id and l.actor_user_id = v_uid
               and l.at >= coalesce(a.started_at, a.assigned_at)
               and l.action in ('checker_pass', 'checker_fix', 'checker_printed_typo',
                                'checker_split', 'checker_ask_help')),
           (select count(*)::int from public.audit_questions q
             where q.paper_id = a.audit_paper_id and (q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question' and public.checker_question_servable(q))),
           (select count(*)::int from public.checker_assignments x
             where x.user_id = v_uid and x.status = 'queued')
    from public.checker_assignments a
    join public.audit_papers ap on ap.id = a.audit_paper_id
    where a.user_id = v_uid and a.status = 'assigned';
end;
$$;

-- Hand the current paper back (for example, the checker cannot read the
-- subject). Its questions go back to the pool.
create or replace function public.checker_return_paper(p_reason text)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_a public.checker_assignments;
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.checker_assignments
  set status = 'returned', closed_at = now(),
      closed_reason = coalesce(nullif(left(btrim(coalesce(p_reason, '')), 300), ''), 'handed back by the checker')
  where user_id = auth.uid() and status = 'assigned'
  returning * into v_a;
  if v_a.id is null then
    return;
  end if;
  update public.audit_questions set locked_by = null, locked_until = null
  where paper_id = v_a.audit_paper_id and locked_by = auth.uid();
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), v_a.audit_paper_id, null, 'checker_return_paper', v_a.closed_reason);
end;
$$;

-- ---------------------------------------------------------------- HOD may resolve escalations

-- Unchanged for checkers. New: an HOD (or admin) may act on an escalated
-- question without holding its lease.
create or replace function public.checker_authorize_question(p_question_id uuid)
returns public.audit_questions
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_q public.audit_questions;
  v_source text;
begin
  if not (public.is_paper_checker() or public.is_hod()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_q from public.audit_questions where id = p_question_id;
  if v_q.id is null then
    raise exception 'Question not found' using errcode = '42501';
  end if;

  if v_q.review_bucket = 'escalated' then
    if not public.is_hod() then
      raise exception 'This question was sent to the HOD' using errcode = '42501';
    end if;
  else
    if not public.is_paper_checker() then
      raise exception 'Not authorized' using errcode = '42501';
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
  end if;

  select ap.source into v_source from public.audit_papers ap where ap.id = v_q.paper_id;
  if v_source is null or v_source not in ('live_copy', 'new_ocr') then
    raise exception 'This paper is not eligible for checking' using errcode = '42501';
  end if;

  return v_q;
end;
$$;

-- Same as before except checker_kind comes from checker_kind_for_caller().
create or replace function public.checker_pass_locked(p_question_id uuid, p_expected_version integer)
returns integer
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_before public.audit_questions;
  v_current integer;
begin
  v_before := public.checker_authorize_question(p_question_id);

  select aq.version into v_current from public.audit_questions aq where aq.id = p_question_id for update;
  if p_expected_version is null or v_current is distinct from p_expected_version then
    raise exception 'stale question: you saw version %, it is now at version %',
      coalesce(p_expected_version::text, 'none'), v_current using errcode = '40001';
  end if;

  if btrim(coalesce(v_before.body, '')) = '' then
    raise exception 'This question has no words; it cannot be passed' using errcode = '22023';
  end if;

  update public.audit_questions
  set status = 'passed', question_passed = true, checked_by_user = auth.uid(),
      locked_by = null, locked_until = null
  where id = p_question_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after)
  values (null, auth.uid(), v_before.paper_id, p_question_id, 'checker_pass', null,
          jsonb_build_object('status', v_before.status, 'question_passed', v_before.question_passed, 'version', v_current),
          jsonb_build_object('status', 'passed', 'question_passed', true, 'version', v_current));

  insert into public.content_checks
    (table_name, row_id, version_seen, checker_kind, actor_user_id, verdict)
  values ('audit_questions', p_question_id::text, v_current,
          public.checker_kind_for_caller(), auth.uid(), 'pass');

  return v_current;
end;
$$;

create or replace function public.checker_fix_locked(p_question_id uuid, p_expected_version integer, p_body text,
  p_display_number text, p_marks numeric, p_printed_typo boolean default false, p_typo_note text default null)
returns integer
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_before public.audit_questions;
  v_current integer;
  v_changes jsonb;
  v_new integer;
  v_typo boolean := coalesce(p_printed_typo, false);
  v_note text := nullif(left(btrim(coalesce(p_typo_note, '')), 500), '');
begin
  v_before := public.checker_authorize_question(p_question_id);

  select aq.version into v_current from public.audit_questions aq where aq.id = p_question_id for update;
  if p_expected_version is null or v_current is distinct from p_expected_version then
    raise exception 'stale question: you saw version %, it is now at version %',
      coalesce(p_expected_version::text, 'none'), v_current using errcode = '40001';
  end if;

  if btrim(coalesce(p_body, v_before.body, '')) = '' then
    raise exception 'This question has no words; it cannot be passed' using errcode = '22023';
  end if;
  if v_typo and (p_body is null or p_body = v_before.body) then
    raise exception 'A printed typo fix must change the words' using errcode = '22023';
  end if;

  v_changes := jsonb_strip_nulls(jsonb_build_object(
    'body', p_body, 'display_number', p_display_number, 'marks', p_marks));

  v_new := v_current;
  if v_changes <> '{}'::jsonb then
    v_new := public.apply_fix_locked(
      'audit_questions', p_question_id::text, v_current, v_changes,
      'checker', 'checker',
      case when v_typo then 'printed typo corrected by a checker' || coalesce(': ' || v_note, '')
           else 'checker fix' end);
  end if;

  update public.audit_questions
  set status = 'passed', question_passed = true, checked_by_user = auth.uid(),
      locked_by = null, locked_until = null
  where id = p_question_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
  values (null, auth.uid(), v_before.paper_id, p_question_id,
          case when v_typo then 'checker_printed_typo' else 'checker_fix' end, null,
          jsonb_build_object('body', v_before.body, 'display_number', v_before.display_number,
                             'marks', v_before.marks, 'version', v_current),
          jsonb_build_object('body', p_body, 'display_number', p_display_number,
                             'marks', p_marks, 'version', v_new),
          v_note);

  insert into public.content_checks
    (table_name, row_id, version_seen, checker_kind, actor_user_id, verdict, proposed_changes, applied_version, notes)
  values ('audit_questions', p_question_id::text, v_current,
          public.checker_kind_for_caller(), auth.uid(),
          case when v_typo then 'printed_typo' else 'fix' end,
          v_changes, case when v_new is distinct from v_current then v_new end, v_note);

  return v_new;
end;
$$;

-- ---------------------------------------------------------------- HOD views

-- Questions checkers sent up ("Ask for help"), still open.
create or replace function public.hod_escalations()
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v jsonb;
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'paper_id', q.paper_id, 'ord', q.ord, 'kind', q.kind, 'parent_id', q.parent_id,
           'number_path', q.number_path, 'display_number', q.display_number,
           'instructions', q.instructions, 'body', q.body, 'options', q.options, 'marks', q.marks,
           'figure_path', q.figure ->> 'path', 'state', 'open', 'version', q.version,
           'flag_reasons', to_jsonb(q.flag_reasons), 'review_bucket', q.review_bucket,
           'live_bank_question_id', q.live_bank_question_id,
           'subject', ap.subject, 'school', ap.school, 'cls', ap.class, 'exam', ap.exam_type, 'year', ap.year,
           'page', case when (q.source ->> 'page') ~ '^[0-9]{1,6}$' then (q.source ->> 'page')::integer end,
           'page_path', pg.object_path,
           'snippet_path', coalesce(nullif(q.source ->> 'snippet_object', ''), nullif(q.source ->> 'whole_snippet_object', '')),
           'escalated_by', e.actor_user_id,
           'escalated_by_name', public.history_actor_from_key(e.actor_user_id::text) ->> 'name',
           'escalated_at', e.at,
           'reason', e.note
         ) order by e.at nulls last, q.paper_id, q.ord), '[]'::jsonb)
    into v
  from public.audit_questions q
  join public.audit_papers ap on ap.id = q.paper_id
  left join public.audit_paper_pages pg
         on pg.audit_paper_id = q.paper_id
        and (q.source ->> 'page') ~ '^[0-9]{1,6}$'
        and pg.page = (q.source ->> 'page')::integer
  left join lateral (
    select l.actor_user_id, l.at, l.note from public.audit_review_log l
    where l.question_id = q.id and l.action = 'checker_ask_help'
    order by l.at desc limit 1
  ) e on true
  where q.review_bucket = 'escalated'
    and q.kind = 'question'
    and q.question_passed = false
    and q.set_aside_at is null;
  return v;
end;
$$;

-- Send an escalated question back to the checkers' pool.
create or replace function public.hod_send_back(p_question_id uuid, p_note text)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_q public.audit_questions;
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_q from public.audit_questions where id = p_question_id for update;
  if v_q.id is null or v_q.review_bucket <> 'escalated' then
    raise exception 'This question is not waiting for the HOD' using errcode = '22023';
  end if;
  update public.audit_questions
  set review_bucket = 'kid', locked_by = null, locked_until = null
  where id = p_question_id;
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
  values (null, auth.uid(), v_q.paper_id, p_question_id, 'hod_send_back', 'review_bucket',
          to_jsonb('escalated'::text), to_jsonb('kid'::text), nullif(left(btrim(coalesce(p_note, '')), 500), ''));
end;
$$;

-- Set an escalated question aside (it will not be published).
create or replace function public.hod_set_aside(p_question_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_q public.audit_questions;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Say why it is being set aside' using errcode = '22023';
  end if;
  select * into v_q from public.audit_questions where id = p_question_id for update;
  if v_q.id is null or v_q.review_bucket <> 'escalated' then
    raise exception 'This question is not waiting for the HOD' using errcode = '22023';
  end if;
  update public.audit_questions
  set set_aside_at = now(), set_aside_by = auth.uid(), set_aside_reason = v_reason,
      locked_by = null, locked_until = null
  where id = p_question_id;
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), v_q.paper_id, p_question_id, 'hod_set_aside', v_reason);
end;
$$;

-- Each checker: what they hold now and how they are doing.
create or replace function public.hod_team()
returns table(user_id uuid, name text, email text, active boolean, subjects text[], classes text[],
              current_paper_id uuid, current_paper_label text, current_remaining integer, queued_count integer,
              done_today integer, done_7d integer, done_all integer,
              passed_as_is integer, edited integer, escalated integer, skipped integer,
              overturned integer, last_active timestamptz)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_today timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    with people as (
      select pc.user_id, pc.active, pc.subjects, pc.classes from public.paper_checkers pc
    ),
    acts as (
      select l.actor_user_id as uid, l.action, l.at, l.question_id
      from public.audit_review_log l
      join people p on p.user_id = l.actor_user_id
      where l.action in ('checker_pass', 'checker_fix', 'checker_printed_typo', 'checker_split',
                         'checker_ask_help', 'checker_skip')
    ),
    mine as (
      select k.actor_user_id as uid, k.row_id, k.created_at
      from public.content_checks k
      join people p on p.user_id = k.actor_user_id
      where k.table_name = 'audit_questions' and k.checker_kind = 'student'
    ),
    over as (
      -- A later fix by someone else to a question this checker had settled.
      select m.uid, count(distinct m.row_id)::int as n
      from mine m
      where exists (select 1 from public.content_checks k2
                    where k2.table_name = 'audit_questions' and k2.row_id = m.row_id
                      and k2.created_at > m.created_at
                      and k2.actor_user_id is distinct from m.uid
                      and k2.verdict in ('fix', 'printed_typo'))
      group by m.uid
    )
    select p.user_id,
           public.history_actor_from_key(p.user_id::text) ->> 'name',
           u.email::text, p.active, p.subjects, p.classes,
           cur.audit_paper_id,
           case when cur.audit_paper_id is null then null
                else concat_ws(' ', cap.subject, case when cap.class is not null then 'Class ' || cap.class end,
                               cap.school, cap.year) end,
           case when cur.audit_paper_id is null then null
                else (select count(*)::int from public.audit_questions q
                      where q.paper_id = cur.audit_paper_id and (q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question' and public.checker_question_servable(q))) end,
           (select count(*)::int from public.checker_assignments x where x.user_id = p.user_id and x.status = 'queued'),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action <> 'checker_skip' and a.at >= v_today),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action <> 'checker_skip' and a.at >= now() - interval '7 days'),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action <> 'checker_skip'),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action = 'checker_pass'),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action in ('checker_fix', 'checker_printed_typo', 'checker_split')),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action = 'checker_ask_help'),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action = 'checker_skip'),
           coalesce(o.n, 0),
           (select max(a.at) from acts a where a.uid = p.user_id)
    from people p
    join auth.users u on u.id = p.user_id
    left join public.checker_assignments cur on cur.user_id = p.user_id and cur.status = 'assigned'
    left join public.audit_papers cap on cap.id = cur.audit_paper_id
    left join over o on o.uid = p.user_id
    order by p.active desc, 13 desc, 2;
end;
$$;

-- Who holds which paper, current and queued.
create or replace function public.hod_assignments()
returns table(assignment_id bigint, status text, user_id uuid, checker_name text,
              paper_id uuid, subject text, school text, cls text, exam text, year text,
              remaining integer, given_by_name text, assigned_at timestamptz, started_at timestamptz)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select a.id, a.status, a.user_id, public.history_actor_from_key(a.user_id::text) ->> 'name',
           a.audit_paper_id, ap.subject, ap.school, ap.class, ap.exam_type, ap.year,
           (select count(*)::int from public.audit_questions q
             where q.paper_id = a.audit_paper_id and (q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question' and public.checker_question_servable(q))),
           case when a.assigned_by is null then 'Automatic'
                else public.history_actor_from_key(a.assigned_by::text) ->> 'name' end,
           a.assigned_at, a.started_at
    from public.checker_assignments a
    join public.audit_papers ap on ap.id = a.audit_paper_id
    where a.status in ('assigned', 'queued')
    order by 4, case a.status when 'assigned' then 0 else 1 end, a.assigned_at;
end;
$$;

-- Papers with questions waiting that nobody holds, for the HOD to hand out.
create or replace function public.hod_unassigned_papers(p_limit integer default 200)
returns table(paper_id uuid, subject text, school text, cls text, exam text, year text, open_count integer)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select c.paper_id, ap.subject, ap.school, ap.class, ap.exam_type, ap.year, c.n
    from (select q.paper_id, count(*)::int as n from public.audit_questions q
          where (q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question' and public.checker_question_servable(q)) group by q.paper_id) c
    join public.audit_papers ap on ap.id = c.paper_id
    where not exists (select 1 from public.checker_assignments a
                      where a.audit_paper_id = c.paper_id and a.status in ('queued', 'assigned'))
    order by ap.subject, ap.class, c.n desc
    limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

-- Give a paper to a checker. If they already have a current paper it is
-- queued behind it. If someone else held it, theirs is closed as 'returned'.
create or replace function public.hod_assign_paper(p_paper_id uuid, p_user_id uuid)
returns text
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_prev public.checker_assignments;
  v_status text;
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.paper_checkers pc where pc.user_id = p_user_id and pc.active) then
    raise exception 'That person is not an active checker' using errcode = '22023';
  end if;
  if not exists (select 1 from public.audit_papers ap where ap.id = p_paper_id) then
    raise exception 'Paper not found' using errcode = '22023';
  end if;

  select * into v_prev from public.checker_assignments
  where audit_paper_id = p_paper_id and status in ('queued', 'assigned') for update;
  if v_prev.id is not null then
    if v_prev.user_id = p_user_id then
      return v_prev.status;
    end if;
    update public.checker_assignments
    set status = 'returned', closed_at = now(), closed_reason = 'moved by the HOD'
    where id = v_prev.id;
    update public.audit_questions set locked_by = null, locked_until = null
    where paper_id = p_paper_id and locked_by = v_prev.user_id;
  end if;

  v_status := case when exists (select 1 from public.checker_assignments x
                                where x.user_id = p_user_id and x.status = 'assigned')
                   then 'queued' else 'assigned' end;
  insert into public.checker_assignments (audit_paper_id, user_id, assigned_by, status, started_at)
  values (p_paper_id, p_user_id, auth.uid(), v_status, case when v_status = 'assigned' then now() end);

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), p_paper_id, null, 'hod_assign_paper',
          p_user_id::text || ' ' || v_status || coalesce(' (moved from ' || v_prev.user_id::text || ')', ''));
  return v_status;
end;
$$;

create or replace function public.hod_unassign(p_assignment_id bigint)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_a public.checker_assignments;
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.checker_assignments
  set status = 'returned', closed_at = now(), closed_reason = 'unassigned by the HOD'
  where id = p_assignment_id and status in ('queued', 'assigned')
  returning * into v_a;
  if v_a.id is null then
    return;
  end if;
  update public.audit_questions set locked_by = null, locked_until = null
  where paper_id = v_a.audit_paper_id and locked_by = v_a.user_id;
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), v_a.audit_paper_id, null, 'hod_unassign', v_a.user_id::text);
end;
$$;

-- ---------------------------------------------------------------- grants

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.is_hod()',
    'public.admin_add_hod(text)',
    'public.admin_remove_hod(uuid)',
    'public.admin_list_hods()',
    'public.checker_next_question()',
    'public.checker_my_assignment()',
    'public.checker_return_paper(text)',
    'public.checker_pass_locked(uuid, integer)',
    'public.checker_fix_locked(uuid, integer, text, text, numeric, boolean, text)',
    'public.hod_escalations()',
    'public.hod_send_back(uuid, text)',
    'public.hod_set_aside(uuid, text)',
    'public.hod_team()',
    'public.hod_assignments()',
    'public.hod_unassigned_papers(integer)',
    'public.hod_assign_paper(uuid, uuid)',
    'public.hod_unassign(bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  -- Internal helpers: callable only from the functions above.
  foreach f in array array[
    'public.checker_kind_for_caller()',
    'public.checker_question_servable(public.audit_questions)',
    'public.checker_settle_current(uuid)',
    'public.checker_authorize_question(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;

-- Log action names for the history pages.
insert into public.log_action_catalog (action, kind, meaning) values
  ('admin_add_hod',        'admin',   'An admin made someone an HOD'),
  ('admin_remove_hod',     'admin',   'An admin removed someone as HOD'),
  ('checker_return_paper', 'checker', 'A checker handed their paper back'),
  ('hod_send_back',        'admin',   'The HOD sent a question back to the checkers'),
  ('hod_set_aside',        'admin',   'The HOD set a question aside'),
  ('hod_assign_paper',     'admin',   'The HOD gave a paper to a checker'),
  ('hod_unassign',         'admin',   'The HOD took a paper back from a checker')
on conflict (action) do nothing;
