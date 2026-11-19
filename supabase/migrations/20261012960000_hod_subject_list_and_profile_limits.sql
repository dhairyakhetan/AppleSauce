-- 20261012960000: two gaps in the HOD desk Verifiers tab "Edit details" form (12 October 2026).
--
-- (a) hod_list_subjects(): the full subject list (id, name, slug) for the preferred-subjects boxes. Until now the tab could
--     only offer subjects already present on the desk. SECURITY DEFINER, is_hod() inside (an admin counts) refusing with
--     42501, closed to public, anon AND authenticated by name, then granted to authenticated only.
--
-- (b) hod_set_verifier_profile gets the same length limits and trimming rules as verifier_set_my_profile (20261011220000):
--     name 120, school 160, board 60 characters after trimming, refused with 22023. Signature, return shape, the grade rule,
--     the upsert and the audit row are exactly as they were; only the three limit lines are new. No data row is touched.

create or replace function public.hod_list_subjects()
returns table (id uuid, name text, slug text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.is_hod() then raise exception 'Not authorized' using errcode = '42501'; end if;
  return query
    select s.id, s.name, s.slug
    from public.subjects s
    order by s.name;
end;
$function$;

revoke all on function public.hod_list_subjects() from public, anon, authenticated;
grant execute on function public.hod_list_subjects() to authenticated;

create or replace function public.hod_set_verifier_profile(
  p_user_id uuid,
  p_full_name text,
  p_grade integer,
  p_school text,
  p_board text,
  p_valid_until date default '2027-03-31'::date
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.is_hod() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_grade is null or p_grade not between 1 and 17 then raise exception 'Grade is out of range' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_full_name, ''))) > 120 then raise exception 'The name is too long (120 characters at most)' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_school, ''))) > 160 then raise exception 'The school name is too long (160 characters at most)' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_board, ''))) > 60 then raise exception 'The board name is too long (60 characters at most)' using errcode = '22023'; end if;
  insert into public.verifier_profiles (user_id, full_name, grade, school, board, valid_until, updated_by, updated_at)
  values (p_user_id, nullif(btrim(p_full_name), ''), p_grade, nullif(btrim(p_school), ''), nullif(btrim(p_board), ''), coalesce(p_valid_until, date '2027-03-31'), auth.uid(), now())
  on conflict (user_id) do update set full_name = excluded.full_name, grade = excluded.grade, school = excluded.school, board = excluded.board, valid_until = excluded.valid_until, updated_by = auth.uid(), updated_at = now();
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), null, null, 'hod_set_verifier_profile', format('%s: grade %s, %s, %s, valid until %s', p_user_id, p_grade, coalesce(p_board, '?'), coalesce(p_school, '?'), coalesce(p_valid_until, date '2027-03-31')));
end;
$function$;

revoke all on function public.hod_set_verifier_profile(uuid, text, integer, text, text, date) from public, anon, authenticated;
grant execute on function public.hod_set_verifier_profile(uuid, text, integer, text, text, date) to authenticated;
