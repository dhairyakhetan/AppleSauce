-- Verifiers fill in their own details, and papers are handed out without them.
--
-- Owner, 2026-10-08, on the /checker "My details" card ("Set by your HOD. You
-- cannot change these here."): "om this page give the chcker an option to
-- inpuit the detials, also allow alotoment without details".
--
-- 1. verifier_set_my_profile: a verifier sets their own name, grade, school and
--    board. Grade may be left blank. valid_until is NOT theirs to move: a new
--    row gets the default (31 March 2027), an existing row keeps its date, so
--    an expired verifier still needs the HOD to renew. Preferred subjects stay
--    HOD-only (verifier_request_subjects is unchanged). Every save is logged.
-- 2. distribute_unassigned_papers: a verifier with no profile, or no grade, is
--    now eligible. No grade means no class limit (treated as Class 12, the
--    top). An explicitly expired profile still gets no new papers (owner's
--    answer of 2026-10-07 stands).
-- 3. verifier_can_take (HOD moves): no profile or no grade is no longer a
--    refusal; the class check applies only when a grade is recorded; expiry
--    still refuses.
-- The distribute change is a patch of the live definition (as 20261007180000)
-- and refuses to half-apply.

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
  if p_grade is not null and p_grade not between 1 and 12 then
    raise exception 'Grade must be 1 to 12' using errcode = '22023';
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

create or replace function public.verifier_can_take(p_user_id uuid, p_paper_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select case
    when vp.valid_until is not null and vp.valid_until < current_date
      then 'This verifier''s details expired on ' || vp.valid_until || '; update them first'
    when vp.grade is null then null
    when public.class_grade(ap.class) is null then null
    when public.class_grade(ap.class) > vp.grade then
      format('This paper is Class %s; the verifier is in Class %s', public.class_grade(ap.class), vp.grade)
    else null end
  from public.audit_papers ap
  left join public.verifier_profiles vp on vp.user_id = p_user_id
  where ap.id = p_paper_id;
$$;

do $patch$
declare
  v_def text := pg_get_functiondef('public.distribute_unassigned_papers()'::regprocedure);
  v_new text;
  v_old_from text := 'from public.paper_checkers pc join public.verifier_profiles vp on vp.user_id = pc.user_id';
  v_old_where text := 'where pc.active and vp.grade is not null and vp.valid_until >= current_date';
  v_old_sel text := 'select pc.user_id, vp.grade, public.board_family(vp.board),';
begin
  if position(v_old_from in v_def) = 0 or position(v_old_where in v_def) = 0 or position(v_old_sel in v_def) = 0 then
    raise exception 'patch did not apply: distribute_unassigned_papers is not the expected definition';
  end if;
  v_new := replace(v_def, v_old_from,
    'from public.paper_checkers pc left join public.verifier_profiles vp on vp.user_id = pc.user_id');
  v_new := replace(v_new, v_old_where,
    'where pc.active and (vp.valid_until is null or vp.valid_until >= current_date)');
  v_new := replace(v_new, v_old_sel,
    'select pc.user_id, coalesce(vp.grade, 12), public.board_family(vp.board),');
  execute v_new;
  v_def := pg_get_functiondef('public.distribute_unassigned_papers()'::regprocedure);
  if position('left join public.verifier_profiles vp' in v_def) = 0
     or position('coalesce(vp.grade, 12)' in v_def) = 0
     or position('vp.valid_until is null or vp.valid_until >= current_date' in v_def) = 0 then
    raise exception 'patch did not apply';
  end if;
end;
$patch$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.verifier_set_my_profile(text, integer, text, text)',
    'public.verifier_can_take(uuid, uuid)',
    'public.distribute_unassigned_papers()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$grants$;
grant execute on function public.verifier_set_my_profile(text, integer, text, text) to authenticated;
grant execute on function public.distribute_unassigned_papers() to authenticated;
grant execute on function public.verifier_can_take(uuid, uuid) to service_role;
