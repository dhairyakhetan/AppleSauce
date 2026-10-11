-- Subjects are spelt many ways in audit_papers ('English', 'English
-- Language', 'Literature in English', 'English Core'; 'History & Civics',
-- 'History/Civics', 'History'; 'Economics (030)'; ...). subject_key only
-- folds case and punctuation, so a preferred subject of 'English' missed
-- every 'English Language' paper, 'Maths' matched nothing at all, and the
-- "spread across subjects" rule counted one subject as several. Found in the
-- 7 Oct edge-case run.
--
--   subject_family()  folds the spellings into one family per subject.
--   distribute_unassigned_papers uses it for preferred subjects and spread.
--   hod_set_preferred_subjects / verifier_request_subjects refuse a subject
--   with no papers at all (say which, and what there is), and store the
--   spelling papers use, so 'maths' saves as 'Mathematics'.

create or replace function public.subject_family(p_subject text)
returns text
language sql immutable
as $$
  with k as (select regexp_replace(coalesce(public.subject_key(p_subject), ''), '([0-9]+|ncert)$', '') as s)
  select case
    when s = '' then null
    when s like '%english%' or s like '%literature%' then 'english'
    when s like 'history%' or s = 'civics' then 'historyandcivics'
    when s like '%math%' then 'mathematics'
    when s like 'economic%' then 'economics'
    when s like 'account%' then 'accounts'
    when s like 'computer%' or s = 'informationtechnology' then 'computers'
    when s like 'physicaleducation%' then 'physicaleducation'
    when s in ('commerce', 'commercialstudies') then 'commerce'
    else s end
  from k;
$$;

-- The usual spelling of each family, for messages and for what is stored.
create or replace function public.subject_family_name(p_family text)
returns text
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select ap.subject from public.audit_papers ap
  where public.subject_family(ap.subject) = p_family
  group by ap.subject order by count(*) desc, ap.subject limit 1;
$$;

-- Clean a list of subjects typed by an HOD or a verifier: every one must be
-- a subject there are papers for. Returns the papers' own spellings.
create or replace function public.clean_subject_list(p_subjects text[])
returns text[]
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  s text;
  fam text;
  name text;
  out text[] := '{}';
  bad text[] := '{}';
begin
  foreach s in array coalesce(p_subjects, '{}') loop
    continue when btrim(coalesce(s, '')) = '';
    fam := public.subject_family(s);
    name := case when fam is null then null else public.subject_family_name(fam) end;
    if name is null then
      bad := bad || btrim(s);
    elsif not name = any(out) then
      out := out || name;
    end if;
  end loop;
  if array_length(bad, 1) > 0 then
    raise exception 'No papers in %. Subjects with papers: %', array_to_string(bad, ', '),
      (select string_agg(n, ', ' order by c desc)
       from (select public.subject_family_name(f) n, count(*) c
             from (select public.subject_family(subject) f from public.audit_papers) z
             where f is not null group by f order by count(*) desc limit 15) t)
      using errcode = '22023';
  end if;
  return out;
end;
$$;

create or replace function public.hod_set_preferred_subjects(p_user_id uuid, p_subjects text[])
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v text[];
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  v := public.clean_subject_list(p_subjects);
  insert into public.verifier_profiles (user_id, preferred_subjects, updated_by, updated_at)
  values (p_user_id, nullif(v, '{}'), auth.uid(), now())
  on conflict (user_id) do update
    set preferred_subjects = nullif(v, '{}'), requested_subjects = null, requested_at = null,
        updated_by = auth.uid(), updated_at = now();
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), null, null, 'hod_set_preferred_subjects',
          format('%s: %s', p_user_id, coalesce(nullif(array_to_string(v, ', '), ''), 'none')));
end;
$$;

create or replace function public.verifier_request_subjects(p_subjects text[])
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v text[];
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  v := public.clean_subject_list(p_subjects);
  insert into public.verifier_profiles (user_id, requested_subjects, requested_at, updated_at)
  values (auth.uid(), nullif(v, '{}'), now(), now())
  on conflict (user_id) do update
    set requested_subjects = nullif(v, '{}'), requested_at = now();
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), null, null, 'verifier_request_subjects',
          coalesce(nullif(array_to_string(v, ', '), ''), 'none'));
end;
$$;

-- Same as 20261007150000 with subject_family in place of subject_key.
create or replace function public.distribute_unassigned_papers()
returns integer language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare p record; v_user uuid; v_min int; n int := 0;
begin
  if not (public.is_paper_checker() or public.is_hod() or auth.role() = 'service_role') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('distribute_unassigned_papers'));
  perform public.verifier_return_idle();
  create temp table if not exists _dist_papers (paper_id uuid, subject text, grade int, board text, n int, rank bigint) on commit drop;
  truncate _dist_papers;
  insert into _dist_papers
  select x.paper_id, x.subject, x.grade, x.board, x.n, row_number() over (order by x.turn, x.subject)
  from (
    select c.paper_id, public.subject_family(ap.subject) as subject, coalesce(public.class_grade(ap.class), 12) as grade,
           public.board_family(ap.board) as board, c.n,
           row_number() over (partition by public.subject_family(ap.subject)
                              order by case when ap.source = 'live_copy' then 0 else 1 end, ap.created_at) as turn
    from (select q.paper_id, count(*)::int as n from public.audit_questions q
          where q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question'
            and public.checker_question_servable(q)
          group by q.paper_id) c
    join public.audit_papers ap on ap.id = c.paper_id
    where not exists (select 1 from public.checker_assignments a
                      where a.audit_paper_id = c.paper_id and a.status in ('queued', 'assigned'))
  ) x;
  if not found then return 0; end if;
  create temp table if not exists _dist_load (user_id uuid, grade int, board text, preferred text[], load int, papers int) on commit drop;
  truncate _dist_load;
  insert into _dist_load
  select pc.user_id, vp.grade, public.board_family(vp.board),
         (select array_agg(public.subject_family(s)) from unnest(vp.preferred_subjects) s),
         coalesce((select count(*)::int from public.checker_assignments a
                   join public.audit_questions q on q.paper_id = a.audit_paper_id
                   where a.user_id = pc.user_id and a.status in ('queued', 'assigned')
                     and q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question'
                     and public.checker_question_servable(q)), 0),
         (select count(*)::int from public.checker_assignments a
          where a.user_id = pc.user_id and a.status in ('queued', 'assigned')
            and public.verifier_has_work(a.audit_paper_id))
  from public.paper_checkers pc join public.verifier_profiles vp on vp.user_id = pc.user_id
  where pc.active and vp.grade is not null and vp.valid_until >= current_date
    and not exists (select 1 from public.admins ad where ad.id = pc.user_id);
  create temp table if not exists _dist_held (user_id uuid, subject text, grade int) on commit drop;
  truncate _dist_held;
  insert into _dist_held
  select a.user_id, public.subject_family(ap.subject), coalesce(public.class_grade(ap.class), 12)
  from public.checker_assignments a join public.audit_papers ap on ap.id = a.audit_paper_id
  where a.status in ('queued', 'assigned') and a.user_id in (select user_id from _dist_load);
  for p in select * from _dist_papers order by rank loop
    v_user := null;
    select min(d.load) into v_min from _dist_load d where p.grade <= d.grade and d.papers < public.verifier_paper_cap();
    continue when v_min is null;
    select d.user_id into v_user from _dist_load d
    where p.grade <= d.grade and d.papers < public.verifier_paper_cap() and d.load <= v_min + greatest(p.n, 15)
      and not exists (select 1 from public.checker_assignments x
                      where x.audit_paper_id = p.paper_id and x.user_id = d.user_id
                        and x.status = 'returned' and x.closed_reason like 'nothing done for %'
                        and x.closed_at > now() - make_interval(days => public.verifier_idle_days()))
    order by (coalesce(array_length(d.preferred, 1), 0) > 0 and p.subject = any(d.preferred)) desc,
      (p.board is not null and p.board = d.board) desc,
      (select count(*) from _dist_held h where h.user_id = d.user_id and h.subject = p.subject),
      (select count(*) from _dist_held h where h.user_id = d.user_id and h.grade = p.grade),
      d.load, d.user_id
    limit 1;
    continue when v_user is null;
    insert into public.checker_assignments (audit_paper_id, user_id, assigned_by, status, started_at)
    values (p.paper_id, v_user, null, 'assigned', now()) on conflict do nothing;
    if found then
      update _dist_load set load = load + p.n, papers = papers + 1 where user_id = v_user;
      insert into _dist_held values (v_user, p.subject, p.grade);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.subject_family(text)',
    'public.subject_family_name(text)',
    'public.clean_subject_list(text[])',
    'public.hod_set_preferred_subjects(uuid, text[])',
    'public.verifier_request_subjects(text[])',
    'public.distribute_unassigned_papers()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;
grant execute on function public.hod_set_preferred_subjects(uuid, text[]) to authenticated, service_role;
grant execute on function public.verifier_request_subjects(text[]) to authenticated, service_role;
grant execute on function public.distribute_unassigned_papers() to authenticated, service_role;
grant execute on function public.subject_family(text) to service_role;
grant execute on function public.subject_family_name(text) to service_role;
grant execute on function public.clean_subject_list(text[]) to service_role;
