-- Verifiers hold a list of papers; every person's actions are visible to HODs.
--
-- Owner, 7 Oct 2026 (clarifying 20261007100000): "Question papers (and thus
-- all questions within that paper) will get auto-assigned to each verifier.
-- thus, the verifier, on their view, can see all question papers assigned to
-- them. (and ofc, if they click on any paper, they can see all questions
-- inside as a top-level view) ... if they click on "start verifying" ... one
-- question at a time ... just like members' actions are being tracked, hods'
-- actions are also being tracked, and all hods/admins can see this ... Hods
-- ... be able to see analytics per verifier (how many questions they
-- reviewed, across how many papers, how many edits/corrections, how many yes,
-- etc)".
--
-- Changes:
--   * A verifier may hold many papers at once (status 'assigned'); 'queued'
--     is no longer used for new assignments.
--   * verifier_profiles (grade, school, board, valid until 31 March 2027,
--     HOD-approved preferred subjects) and distribute_unassigned_papers(),
--     which gives out whole papers under the owner's rules (see the
--     distribution section). It runs when a verifier opens their list, and an
--     HOD can run it.
--   * verifier_my_papers(), verifier_paper_questions(paper),
--     verifier_next_in_paper(paper): the list, the top-level view of one
--     paper, and "start verifying" one question at a time.
--   * checker_next_question() keeps its shape and serves from the caller's
--     own papers.
--   * hod_team() gains papers_held / papers_reviewed; hod_action_history()
--     shows every person's actions (verifiers, HODs, admins) to HODs and admins.

drop index if exists public.checker_assignments_one_current;

-- ---------------------------------------------------------------- verifier profiles
--
-- Owner, 7 Oct 2026: "The verifiers' grades, school and boards will be input
-- in the system when they get access. (this data will only be valid until
-- March '27, and should be refreshed then). No verifier should get a paper
-- which is a grade higher than their own grade, strict rule (same grade or
-- lower is fine). Preference but not strict rule: Verifiers should get papers
-- within their own boards first ... another field named preferred subjects
-- will also be stored- this field will have to be approved (or filled) by
-- HoDs, verifiers can't update this on their own ... For the beginning: Each
-- verifier should get papers across subjects (and lesser important, but if
-- possible also across standards) > logic: to be able to test productivity of
-- each verifier in an even playing ground".

create table if not exists public.verifier_profiles (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  full_name          text,
  grade              integer check (grade is null or grade between 1 and 12),
  school             text,
  board              text,
  valid_until        date not null default date '2027-03-31',
  preferred_subjects text[],          -- set or approved by an HOD only
  requested_subjects text[],          -- what the verifier asked for, waiting for an HOD
  requested_at       timestamptz,
  updated_by         uuid references auth.users(id) on delete set null,
  updated_at         timestamptz not null default now()
);
alter table public.verifier_profiles enable row level security;
revoke all on public.verifier_profiles from public, anon, authenticated;

-- 'X', '10', '10th', 'GRADE X' -> 10. Unknown -> null.
create or replace function public.class_grade(p_class text)
returns integer
language sql immutable
as $$
  with t as (select upper(regexp_replace(coalesce(p_class, ''), '(GRADE|CLASS|STD|TH|ST|ND|RD|[^A-Z0-9])', '', 'g')) as s)
  select case
    when s ~ '^[0-9]{1,2}$' and s::int between 1 and 12 then s::int
    else array_position(array['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'], s) end
  from t;
$$;

-- 'History & Civics', 'HISTORY AND CIVICS', 'History&Civics' -> 'historyandcivics'.
create or replace function public.subject_key(p_subject text)
returns text
language sql immutable
as $$
  select nullif(regexp_replace(lower(replace(coalesce(p_subject, ''), '&', ' and ')), '[^a-z0-9]', '', 'g'), '');
$$;

-- ICSE, ISC, CISCE are one family; CBSE and Kendriya Vidyalaya another.
create or replace function public.board_family(p_board text)
returns text
language sql immutable
as $$
  select case
    when upper(coalesce(p_board, '')) in ('ICSE', 'ISC', 'CISCE') then 'CISCE'
    when upper(coalesce(p_board, '')) like 'CBSE%' or upper(coalesce(p_board, '')) like 'KENDRIYA%'
         or upper(coalesce(p_board, '')) = 'KVS' then 'CBSE'
    when btrim(coalesce(p_board, '')) = '' then null
    else upper(btrim(p_board)) end;
$$;

-- An admin or HOD records a verifier's details (when they get access, and
-- each year after the valid_until date).
create or replace function public.hod_set_verifier_profile(p_user_id uuid, p_full_name text, p_grade integer,
  p_school text, p_board text, p_valid_until date default date '2027-03-31')
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_grade is null or p_grade not between 1 and 12 then
    raise exception 'Grade must be 1 to 12' using errcode = '22023';
  end if;
  insert into public.verifier_profiles (user_id, full_name, grade, school, board, valid_until, updated_by, updated_at)
  values (p_user_id, nullif(btrim(p_full_name), ''), p_grade, nullif(btrim(p_school), ''), nullif(btrim(p_board), ''),
          coalesce(p_valid_until, date '2027-03-31'), auth.uid(), now())
  on conflict (user_id) do update
    set full_name = excluded.full_name, grade = excluded.grade, school = excluded.school,
        board = excluded.board, valid_until = excluded.valid_until,
        updated_by = auth.uid(), updated_at = now();
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), null, null, 'hod_set_verifier_profile',
          format('%s: grade %s, %s, %s, valid until %s', p_user_id, p_grade, coalesce(p_board, '?'),
                 coalesce(p_school, '?'), coalesce(p_valid_until, date '2027-03-31')));
end;
$$;

-- Preferred subjects: set (or a request approved) by an HOD only.
create or replace function public.hod_set_preferred_subjects(p_user_id uuid, p_subjects text[])
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  insert into public.verifier_profiles (user_id, preferred_subjects, updated_by, updated_at)
  values (p_user_id, nullif(p_subjects, '{}'), auth.uid(), now())
  on conflict (user_id) do update
    set preferred_subjects = nullif(p_subjects, '{}'), requested_subjects = null, requested_at = null,
        updated_by = auth.uid(), updated_at = now();
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), null, null, 'hod_set_preferred_subjects',
          format('%s: %s', p_user_id, coalesce(array_to_string(p_subjects, ', '), 'none')));
end;
$$;

-- A verifier may ASK for preferred subjects; nothing changes until an HOD approves.
create or replace function public.verifier_request_subjects(p_subjects text[])
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  insert into public.verifier_profiles (user_id, requested_subjects, requested_at, updated_at)
  values (auth.uid(), nullif(p_subjects, '{}'), now(), now())
  on conflict (user_id) do update
    set requested_subjects = nullif(p_subjects, '{}'), requested_at = now();
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), null, null, 'verifier_request_subjects',
          coalesce(array_to_string(p_subjects, ', '), 'none'));
end;
$$;

create or replace function public.verifier_my_profile()
returns table(full_name text, grade integer, school text, board text, valid_until date, expired boolean,
              preferred_subjects text[], requested_subjects text[])
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select p.full_name, p.grade, p.school, p.board, p.valid_until, p.valid_until < current_date,
           p.preferred_subjects, p.requested_subjects
    from public.verifier_profiles p where p.user_id = auth.uid();
end;
$$;

-- Every verifier with their profile, for HODs (who fill and approve it).
create or replace function public.hod_verifier_profiles()
returns table(user_id uuid, email text, name text, active boolean, full_name text, grade integer, school text,
              board text, valid_until date, expired boolean, missing boolean,
              preferred_subjects text[], requested_subjects text[], requested_at timestamptz)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select pc.user_id, u.email::text, public.history_actor_from_key(pc.user_id::text) ->> 'name', pc.active,
           p.full_name, p.grade, p.school, p.board, p.valid_until,
           coalesce(p.valid_until < current_date, false),
           (p.grade is null),
           p.preferred_subjects, p.requested_subjects, p.requested_at
    from public.paper_checkers pc
    join auth.users u on u.id = pc.user_id
    left join public.verifier_profiles p on p.user_id = pc.user_id
    where not exists (select 1 from public.admins ad where ad.id = pc.user_id)
    order by pc.active desc, (p.grade is null) desc, p.full_name nulls last;
end;
$$;

-- ---------------------------------------------------------------- distribution
--
-- A whole paper always goes to one verifier (one holder per paper, enforced
-- by the unique index). Rules, in order:
--   strict   the verifier is active, not an admin, has a profile with a grade
--            that is still valid (valid_until not passed), and the paper's
--            grade is known and no higher than the verifier's grade.
--            Otherwise the paper waits for an HOD to give it by hand.
--   prefer   1. a preferred subject (HOD-approved), when the verifier has any
--            2. the verifier's own board family
--            3. a subject they hold the fewest papers of (spread across subjects)
--            4. the fewest questions waiting overall (even load)
--            5. a grade they hold the fewest papers of (spread across standards)
-- Papers are handed out subject by subject in turn, so every verifier sees a
-- mix from the start.

create or replace function public.distribute_unassigned_papers()
returns integer
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  p record;
  v_user uuid;
  v_min int;
  n int := 0;
begin
  if not (public.is_paper_checker() or public.is_hod() or auth.role() = 'service_role') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  -- One distributor at a time.
  perform pg_advisory_xact_lock(hashtext('distribute_unassigned_papers'));

  create temp table if not exists _dist_papers
    (paper_id uuid, subject text, grade int, board text, n int, rank bigint) on commit drop;
  truncate _dist_papers;
  insert into _dist_papers
  select x.paper_id, x.subject, x.grade, x.board, x.n,
         row_number() over (order by x.turn, x.subject)
  from (
    select c.paper_id, public.subject_key(ap.subject) as subject, public.class_grade(ap.class) as grade,
           public.board_family(ap.board) as board, c.n,
           row_number() over (partition by public.subject_key(ap.subject)
                              order by case when ap.source = 'live_copy' then 0 else 1 end, ap.created_at) as turn
    from (select q.paper_id, count(*)::int as n from public.audit_questions q
          where q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question'
            and public.checker_question_servable(q)
          group by q.paper_id) c
    join public.audit_papers ap on ap.id = c.paper_id
    where not exists (select 1 from public.checker_assignments a
                      where a.audit_paper_id = c.paper_id and a.status in ('queued', 'assigned'))
      and public.class_grade(ap.class) is not null
  ) x;
  if not found then
    return 0;
  end if;

  -- Each eligible verifier and what they already hold.
  create temp table if not exists _dist_load
    (user_id uuid, grade int, board text, preferred text[], load int, papers int) on commit drop;
  truncate _dist_load;
  insert into _dist_load
  select pc.user_id, vp.grade, public.board_family(vp.board),
         (select array_agg(public.subject_key(s)) from unnest(vp.preferred_subjects) s),
         coalesce((select count(*)::int
                   from public.checker_assignments a
                   join public.audit_questions q on q.paper_id = a.audit_paper_id
                   where a.user_id = pc.user_id and a.status in ('queued', 'assigned')
                     and q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question'
                     and public.checker_question_servable(q)), 0),
         (select count(*)::int from public.checker_assignments a
          where a.user_id = pc.user_id and a.status in ('queued', 'assigned'))
  from public.paper_checkers pc
  join public.verifier_profiles vp on vp.user_id = pc.user_id
  where pc.active
    and vp.grade is not null
    and vp.valid_until >= current_date
    and not exists (select 1 from public.admins ad where ad.id = pc.user_id);

  create temp table if not exists _dist_held (user_id uuid, subject text, grade int) on commit drop;
  truncate _dist_held;
  insert into _dist_held
  select a.user_id, public.subject_key(ap.subject), public.class_grade(ap.class)
  from public.checker_assignments a
  join public.audit_papers ap on ap.id = a.audit_paper_id
  where a.status in ('queued', 'assigned')
    and a.user_id in (select user_id from _dist_load);

  for p in select * from _dist_papers order by rank loop
    v_user := null;
    -- Even playing field first: only verifiers within one paper's worth of
    -- the lightest eligible load are considered (a strict board-first order
    -- left a CBSE verifier with nothing in testing, since most papers are
    -- ICSE). Among those, the preferences decide.
    select min(d.load) into v_min from _dist_load d
    where p.grade <= d.grade and d.papers < public.verifier_paper_cap();
    continue when v_min is null;
    select d.user_id into v_user
    from _dist_load d
    where p.grade <= d.grade
      and d.papers < public.verifier_paper_cap()
      and d.load <= v_min + greatest(p.n, 15)
    order by
      (coalesce(array_length(d.preferred, 1), 0) > 0 and p.subject = any(d.preferred)) desc,
      (p.board is not null and p.board = d.board) desc,
      (select count(*) from _dist_held h where h.user_id = d.user_id and h.subject = p.subject),
      (select count(*) from _dist_held h where h.user_id = d.user_id and h.grade = p.grade),
      d.load,
      d.user_id
    limit 1;

    continue when v_user is null;   -- nobody's grade is high enough; an HOD can give it by hand

    insert into public.checker_assignments (audit_paper_id, user_id, assigned_by, status, started_at)
    values (p.paper_id, v_user, null, 'assigned', now())
    on conflict do nothing;
    if found then
      update _dist_load set load = load + p.n, papers = papers + 1 where user_id = v_user;
      insert into _dist_held values (v_user, p.subject, p.grade);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- HOD moves must respect the grade rule too.
create or replace function public.verifier_can_take(p_user_id uuid, p_paper_id uuid)
returns text
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select case
    when vp.user_id is null or vp.grade is null then 'This verifier has no grade recorded yet'
    when vp.valid_until < current_date then 'This verifier''s details expired on ' || vp.valid_until || '; update them first'
    when public.class_grade(ap.class) is null then null   -- unknown paper grade: the HOD decides
    when public.class_grade(ap.class) > vp.grade then
      format('This paper is Class %s; the verifier is in Class %s', public.class_grade(ap.class), vp.grade)
    else null end
  from public.audit_papers ap
  left join public.verifier_profiles vp on vp.user_id = p_user_id
  where ap.id = p_paper_id;
$$;

-- Close papers with nothing left to verify.
create or replace function public.verifier_close_finished(p_uid uuid)
returns void
language sql security definer
set search_path to 'public', 'pg_temp'
as $$
  update public.checker_assignments a
  set status = 'done', closed_at = now(), closed_reason = 'all questions checked'
  where a.user_id = p_uid and a.status in ('queued', 'assigned')
    and not exists (select 1 from public.audit_questions q
                    where q.paper_id = a.audit_paper_id and q.review_bucket = 'kid'
                      and q.question_passed = false and q.kind = 'question'
                      and public.checker_question_servable(q))
    and not exists (select 1 from public.audit_questions q
                    where q.paper_id = a.audit_paper_id and q.review_bucket = 'escalated'
                      and q.question_passed = false and q.set_aside_at is null);
$$;

-- The verifier's papers, oldest assignment first. Gives out unassigned papers first.
create or replace function public.verifier_my_papers()
returns table(assignment_id bigint, paper_id uuid, subject text, school text, cls text, exam text, year text,
              given_by_hod boolean, assigned_at timestamptz,
              total integer, done integer, remaining integer, with_hod integer)
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
             (select count(distinct l.question_id)::int from public.audit_review_log l
               where l.paper_id = m.audit_paper_id and l.actor_user_id = v_uid
                 and l.at >= m.assigned_at
                 and l.action in ('checker_pass', 'checker_fix', 'checker_printed_typo', 'checker_split')) as done,
             (select count(*)::int from public.audit_questions q
               where q.paper_id = m.audit_paper_id and q.review_bucket = 'escalated'
                 and q.question_passed = false and q.set_aside_at is null) as with_hod
      from mine m
    )
    select m.id, m.audit_paper_id, ap.subject, ap.school, ap.class, ap.exam_type, ap.year,
           m.assigned_by is not null, m.assigned_at,
           c.done + c.remaining + c.with_hod, c.done, c.remaining, c.with_hod
    from mine m
    join c on c.id = m.id
    join public.audit_papers ap on ap.id = m.audit_paper_id
    order by m.assigned_at, m.id;
end;
$$;

-- Every question of one paper, for the top-level view. The verifier must
-- hold the paper; HODs and admins may open any.
create or replace function public.verifier_paper_questions(p_paper_id uuid)
returns table(id uuid, ord integer, display_number text, number_path text, body text, options jsonb,
              marks numeric, instructions text, page integer, page_path text, snippet_path text,
              state text, version integer)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
begin
  if not (public.is_hod() or exists (
            select 1 from public.checker_assignments a
            where a.audit_paper_id = p_paper_id and a.user_id = auth.uid()
              and a.status in ('queued', 'assigned', 'done'))) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select q.id, q.ord, q.display_number, q.number_path, q.body, q.options, q.marks, q.instructions,
           case when (q.source ->> 'page') ~ '^[0-9]{1,6}$' then (q.source ->> 'page')::integer end,
           pg.object_path,
           coalesce(nullif(q.source ->> 'snippet_object', ''), nullif(q.source ->> 'whole_snippet_object', '')),
           case when q.set_aside_at is not null then 'set_aside'
                when q.question_passed then 'done'
                when q.review_bucket = 'escalated' then 'with_hod'
                when q.review_bucket = 'kid' and public.checker_question_servable(q) then 'to_verify'
                else 'not_for_verifiers' end,
           q.version
    from public.audit_questions q
    left join public.audit_paper_pages pg
           on pg.audit_paper_id = q.paper_id
          and (q.source ->> 'page') ~ '^[0-9]{1,6}$'
          and pg.page = (q.source ->> 'page')::integer
    where q.paper_id = p_paper_id and q.kind = 'question'
    order by q.ord, q.id;
end;
$$;

-- "Start verifying": the next question of one paper the caller holds, leased
-- to them for 10 minutes. Same shape as checker_next_question plus the page
-- picture path, so the screen can show the right page beside it.
create or replace function public.verifier_next_in_paper(p_paper_id uuid)
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
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.checker_assignments a
                 where a.audit_paper_id = p_paper_id and a.user_id = v_uid
                   and a.status in ('queued', 'assigned')) then
    raise exception 'This paper is not assigned to you' using errcode = '42501';
  end if;

  for attempt in 1..5 loop
    v_id := null;
    select aq.id into v_id
    from public.audit_questions aq
    where aq.paper_id = p_paper_id
      and aq.review_bucket = 'kid' and aq.question_passed = false and aq.kind = 'question'
      and public.checker_question_servable(aq)
      and (aq.locked_until is null or aq.locked_until < now() or aq.locked_by = v_uid)
      and not exists (select 1 from public.audit_question_skips s
                      where s.question_id = aq.id and s.user_id = v_uid
                        and s.skipped_at > now() - interval '24 hours')
    order by case when aq.locked_by = v_uid and aq.locked_until > now() then 0 else 1 end, aq.ord, aq.id
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

-- Kept for the existing screen: the next question from the caller's own
-- papers, oldest assignment first.
create or replace function public.checker_next_question()
returns table(id uuid, paper_id uuid, ord integer, display_number text, number_path text, body text,
              options jsonb, marks numeric, instructions text, flag_reasons text[], flag_detail text,
              source jsonb, subject text, school text, cls text, exam text, year text, version integer)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  p record;
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform public.distribute_unassigned_papers();
  for p in select a.audit_paper_id from public.checker_assignments a
           where a.user_id = v_uid and a.status in ('queued', 'assigned')
           order by a.assigned_at, a.id loop
    return query
      select n.id, n.paper_id, n.ord, n.display_number, n.number_path, n.body, n.options, n.marks,
             n.instructions, n.flag_reasons, n.flag_detail, n.source, n.subject, n.school, n.cls,
             n.exam, n.year, n.version
      from public.verifier_next_in_paper(p.audit_paper_id) n;
    if found then
      return;
    end if;
  end loop;
end;
$$;

-- First paper with something left, for older callers.
create or replace function public.checker_my_assignment()
returns table(assignment_id bigint, paper_id uuid, subject text, school text, cls text, exam text,
              year text, given_by_hod boolean, started_at timestamptz,
              done_count integer, remaining_count integer, queued_count integer)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
begin
  return query
    select m.assignment_id, m.paper_id, m.subject, m.school, m.cls, m.exam, m.year, m.given_by_hod,
           m.assigned_at, m.done, m.remaining,
           ((select count(*) from public.checker_assignments x
             where x.user_id = auth.uid() and x.status in ('queued', 'assigned')) - 1)::int
    from public.verifier_my_papers() m
    where m.remaining > 0
    order by m.assigned_at
    limit 1;
end;
$$;

-- Move a paper to a verifier (or give an unheld one). Always 'assigned'.
create or replace function public.hod_assign_paper(p_paper_id uuid, p_user_id uuid)
returns text
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_prev public.checker_assignments;
  v_block text;
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.paper_checkers pc where pc.user_id = p_user_id and pc.active) then
    raise exception 'That person is not an active verifier' using errcode = '22023';
  end if;
  if not exists (select 1 from public.audit_papers ap where ap.id = p_paper_id) then
    raise exception 'Paper not found' using errcode = '22023';
  end if;
  v_block := public.verifier_can_take(p_user_id, p_paper_id);
  if v_block is not null then
    raise exception '%', v_block using errcode = '22023';
  end if;

  select * into v_prev from public.checker_assignments
  where audit_paper_id = p_paper_id and status in ('queued', 'assigned') for update;
  if v_prev.id is not null then
    if v_prev.user_id = p_user_id then
      return 'assigned';
    end if;
    update public.checker_assignments
    set status = 'returned', closed_at = now(), closed_reason = 'moved by the HOD'
    where id = v_prev.id;
    update public.audit_questions set locked_by = null, locked_until = null
    where paper_id = p_paper_id and locked_by = v_prev.user_id;
  end if;

  insert into public.checker_assignments (audit_paper_id, user_id, assigned_by, status, started_at)
  values (p_paper_id, p_user_id, auth.uid(), 'assigned', now());

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), p_paper_id, null, 'hod_assign_paper',
          p_user_id::text || coalesce(' (moved from ' || v_prev.user_id::text || ')', ''));
  return 'assigned';
end;
$$;

-- Per verifier: what they hold and how they are doing.
drop function if exists public.hod_team();
create or replace function public.hod_team()
returns table(user_id uuid, name text, email text, active boolean, subjects text[], classes text[],
              papers_held integer, questions_waiting integer,
              reviewed_today integer, reviewed_7d integer, reviewed_all integer, papers_reviewed integer,
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
      select l.actor_user_id as uid, l.action, l.at, l.question_id, l.paper_id
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
      select m.uid, count(distinct m.row_id)::int as n
      from mine m
      where exists (select 1 from public.content_checks k2
                    where k2.table_name = 'audit_questions' and k2.row_id = m.row_id
                      and k2.created_at > m.created_at
                      and k2.actor_user_id is distinct from m.uid
                      and k2.verdict in ('fix', 'printed_typo'))
      group by m.uid
    ),
    held as (
      select a.user_id, count(*)::int as papers,
             sum((select count(*) from public.audit_questions q
                  where q.paper_id = a.audit_paper_id and q.review_bucket = 'kid'
                    and q.question_passed = false and q.kind = 'question'
                    and public.checker_question_servable(q)))::int as waiting
      from public.checker_assignments a
      where a.status in ('queued', 'assigned')
      group by a.user_id
    )
    select p.user_id,
           public.history_actor_from_key(p.user_id::text) ->> 'name',
           u.email::text, p.active, p.subjects, p.classes,
           coalesce(h.papers, 0), coalesce(h.waiting, 0),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action <> 'checker_skip' and a.at >= v_today),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action <> 'checker_skip' and a.at >= now() - interval '7 days'),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action <> 'checker_skip'),
           (select count(distinct a.paper_id)::int from acts a where a.uid = p.user_id and a.action <> 'checker_skip'),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action = 'checker_pass'),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action in ('checker_fix', 'checker_printed_typo', 'checker_split')),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action = 'checker_ask_help'),
           (select count(*)::int from acts a where a.uid = p.user_id and a.action = 'checker_skip'),
           coalesce(o.n, 0),
           (select max(a.at) from acts a where a.uid = p.user_id)
    from people p
    join auth.users u on u.id = p.user_id
    left join held h on h.user_id = p.user_id
    left join over o on o.uid = p.user_id
    order by p.active desc, 11 desc, 2;
end;
$$;

-- Every person's actions (verifiers, HODs, admins), newest first, for HODs
-- and admins. p_actor narrows to one person; p_role to 'verifier' | 'hod' | 'admin'.
create or replace function public.hod_action_history(p_actor uuid default null, p_role text default null,
                                                     p_limit integer default 200, p_before timestamptz default null)
returns table(at timestamptz, actor_id uuid, actor_name text, actor_role text, action text, meaning text,
              paper_id uuid, paper_label text, question_id uuid, question_number text, note text)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    with l as (
      select x.*,
             case when exists (select 1 from public.admins ad where ad.id = x.actor_user_id) then 'admin'
                  when exists (select 1 from public.paper_hods h where h.user_id = x.actor_user_id) then 'hod'
                  else 'verifier' end as role
      from public.audit_review_log x
      where x.actor_user_id is not null
        and (p_actor is null or x.actor_user_id = p_actor)
        and (p_before is null or x.at < p_before)
      order by x.at desc
      limit greatest(1, least(coalesce(p_limit, 200), 1000)) * 3
    )
    select l.at, l.actor_user_id, public.history_actor_from_key(l.actor_user_id::text) ->> 'name', l.role,
           l.action, c.meaning, l.paper_id,
           case when ap.id is null then null
                else concat_ws(' ', ap.subject, case when ap.class is not null then 'Class ' || ap.class end, ap.school, ap.year) end,
           l.question_id, q.display_number, l.note
    from l
    left join public.log_action_catalog c on c.action = l.action
    left join public.audit_papers ap on ap.id = l.paper_id
    left join public.audit_questions q on q.id = l.question_id
    where p_role is null or l.role = p_role
    order by l.at desc
    limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.distribute_unassigned_papers()',
    'public.verifier_my_papers()',
    'public.verifier_paper_questions(uuid)',
    'public.verifier_next_in_paper(uuid)',
    'public.checker_next_question()',
    'public.checker_my_assignment()',
    'public.hod_assign_paper(uuid, uuid)',
    'public.hod_team()',
    'public.hod_action_history(uuid, text, integer, timestamptz)',
    'public.hod_set_verifier_profile(uuid, text, integer, text, text, date)',
    'public.hod_set_preferred_subjects(uuid, text[])',
    'public.hod_verifier_profiles()',
    'public.verifier_request_subjects(text[])',
    'public.verifier_my_profile()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.verifier_close_finished(uuid)',
    'public.verifier_can_take(uuid, uuid)',
    'public.class_grade(text)',
    'public.board_family(text)',
    'public.subject_key(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  execute 'grant execute on function public.distribute_unassigned_papers() to service_role';
end;
$$;

insert into public.log_action_catalog (action, kind, meaning) values
  ('hod_set_verifier_profile',   'admin',   'An HOD recorded a verifier''s grade, school and board'),
  ('hod_set_preferred_subjects', 'admin',   'An HOD set a verifier''s preferred subjects'),
  ('verifier_request_subjects',  'checker', 'A verifier asked for preferred subjects')
on conflict (action) do nothing;

-- ---------------------------------------------------------------- cap (applied live as verifier_distribution_cap)
-- A verifier holds at most 10 unfinished papers at a time, so the first one
-- to sign in cannot take everything (seen in testing: one verifier got all 94
-- papers at or below their grade). More are given as they finish. In
-- distribute_unassigned_papers, _dist_load also carries `papers` (held now),
-- a verifier is eligible only while papers < verifier_paper_cap(), and the
-- count goes up by one with each paper given. Verified in a rolled-back
-- transaction with 4 made-up verifiers: 10 papers each across 3 to 10
-- subjects, 0 above grade, a second run gave out 0.
create or replace function public.verifier_paper_cap()
returns integer language sql immutable as $$ select 10; $$;
revoke all on function public.verifier_paper_cap() from public, anon, authenticated;
