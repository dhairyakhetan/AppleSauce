-- A wider grade list for verifiers: Under grade 6 up to Beyond UG.
--
-- Owner, 2026-10-08, on the verifier "Grade" dropdown (Not given, Grade 1 to
-- 12): "start grade from 6 up until UG 4th year / add 2 more options - under
-- grade 6 and beyond UG".
--
-- The grade stays one plain integer, so the hand-out rule "never a paper above
-- the verifier's grade" is still a number compare against public.class_grade
-- (paper classes, 1 to 12; NOT touched here):
--   5         Under grade 6   (1 to 4 stay valid: older rows read the same)
--   6 to 12   Grade 6 to Grade 12
--   13 to 16  UG 1st year to UG 4th year
--   17        Beyond UG
--   null      not given: no class limit (unchanged)
-- Every verifier grade of 13 or more is above every paper, so those verifiers
-- can take any paper; Under grade 6 can take classes up to 5.
--
-- 1. verifier_profiles.grade check: null or 1 to 17 (existing rows stay valid).
-- 2. hod_set_verifier_profile and verifier_set_my_profile: same signatures and
--    behaviour, range 1 to 17, message "Grade is out of range".
-- Nothing else reads a verifier grade in a way that cares about the top end:
-- distribute_unassigned_papers and verifier_can_take only compare it with a
-- paper's class (at most 12) and coalesce a missing grade to 12.

-- 1. The check. The original was an unnamed inline check, so find it by what
--    it says rather than by a guessed name.
do $check$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.verifier_profiles'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%grade%'
  loop
    execute format('alter table public.verifier_profiles drop constraint %I', c.conname);
  end loop;
end;
$check$;

alter table public.verifier_profiles
  add constraint verifier_profiles_grade_check
  check (grade is null or grade between 1 and 17);

-- 2. The two setters.
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
  if p_grade is null or p_grade not between 1 and 17 then
    raise exception 'Grade is out of range' using errcode = '22023';
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

create or replace function public.verifier_set_my_profile(
  p_full_name text, p_grade integer, p_school text, p_board text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_grade is not null and p_grade not between 1 and 17 then
    raise exception 'Grade is out of range' using errcode = '22023';
  end if;
  insert into public.verifier_profiles (user_id, full_name, grade, school, board, updated_by, updated_at)
  values (auth.uid(), nullif(btrim(p_full_name), ''), p_grade, nullif(btrim(p_school), ''),
          nullif(btrim(p_board), ''), auth.uid(), now())
  on conflict (user_id) do update
    set full_name = excluded.full_name, grade = excluded.grade, school = excluded.school,
        board = excluded.board, updated_by = auth.uid(), updated_at = now();
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), null, null, 'verifier_set_my_profile',
          format('own details: grade %s, %s, %s', coalesce(p_grade::text, 'not given'),
                 coalesce(nullif(btrim(p_board), ''), 'no board'), coalesce(nullif(btrim(p_school), ''), 'no school')));
end;
$$;

-- Closed to every client role by name, then opened to signed-in users only,
-- exactly as 20261007130000 and 20261008100000 left them.
do $grants$
declare f text;
begin
  foreach f in array array[
    'public.hod_set_verifier_profile(uuid, text, integer, text, text, date)',
    'public.verifier_set_my_profile(text, integer, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$grants$;

-- Refuse to half-apply: the check and both setters must now say 1 to 17.
do $verify$
begin
  if not exists (
    select 1 from pg_constraint con
    where con.conrelid = 'public.verifier_profiles'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%17%'
  ) then
    raise exception 'patch did not apply: grade check';
  end if;
  if position('between 1 and 17' in pg_get_functiondef('public.hod_set_verifier_profile(uuid, text, integer, text, text, date)'::regprocedure)) = 0
     or position('between 1 and 17' in pg_get_functiondef('public.verifier_set_my_profile(text, integer, text, text)'::regprocedure)) = 0 then
    raise exception 'patch did not apply: setters';
  end if;
  if has_function_privilege('anon', 'public.hod_set_verifier_profile(uuid, text, integer, text, text, date)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'public.verifier_set_my_profile(text, integer, text, text)'::regprocedure, 'EXECUTE') then
    raise exception 'patch did not apply: anon can still execute';
  end if;
end;
$verify$;
