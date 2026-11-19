-- Two SECURITY DEFINER functions had no authorization check of any kind and
-- were executable by every signed-in user. Found by the Supabase security
-- advisor, then confirmed by reading the function bodies rather than trusting
-- the lint (an earlier pass in this project reported a similar finding that
-- turned out to be already guarded, so the bodies get read now).
--
-- 1. check_existing_users_for_teacher_role()
--    Loops every row of auth.users and RETURNS TABLE(user_id, user_email, ...).
--    Any authenticated user could POST /rest/v1/rpc/check_existing_users_for_teacher_role
--    and receive the id and email address of every account on the platform.
--    That is a user-enumeration and email-disclosure hole, not merely a
--    privilege smell. It also writes profiles.role = 'teacher'.
--
-- 2. sync_teachers_list_from_shikshaqmine()
--    Bulk UPDATE and INSERT across teachers_list. Any authenticated user could
--    trigger a full re-sync of the public directory at will.
--
-- By contrast approve_teacher_application and assign_teacher_role_by_email were
-- checked and DO verify auth.uid() already; they are deliberately left alone.
--
-- Neither function is called from application code — grep over src/ finds only
-- the generated type definitions. They are hand-run maintenance routines, so
-- locking them down breaks no user-facing path.
--
-- Two layers, because either alone is brittle:
--   a) revoke EXECUTE from PUBLIC. Postgres grants EXECUTE to PUBLIC by
--      default and anon/authenticated inherit it, so revoking from those roles
--      by name is a no-op — a mistake made earlier in this project's history
--      and worth not repeating.
--   b) an in-body admin check, so a future GRANT cannot silently reopen it.
--
-- The in-body check deliberately allows auth.uid() IS NULL. That is the
-- service_role / SQL-editor context an operator actually runs these from; it is
-- not reachable over REST once (a) has removed the anon and authenticated
-- grants.

create or replace function public.check_existing_users_for_teacher_role()
returns table(user_id uuid, user_email text, assigned_role boolean, teacher_email text)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_user_record RECORD;
  v_teacher_email TEXT;
  v_assigned BOOLEAN;
BEGIN
  -- Admin-only. Without this any signed-in user could enumerate every account.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  FOR v_user_record IN
    SELECT u.id, u.email, u.raw_user_meta_data, p.role
    FROM auth.users u
    LEFT JOIN public.profiles p ON u.id = p.id
    WHERE u.email IS NOT NULL AND u.email != ''
  LOOP
    v_assigned := false;
    v_teacher_email := NULL;

    SELECT "Email ID" INTO v_teacher_email
    FROM public."Shikshaqmine"
    WHERE LOWER(TRIM("Email ID")) = LOWER(TRIM(v_user_record.email))
      AND "Email ID" IS NOT NULL
      AND "Email ID" != ''
    LIMIT 1;

    IF v_teacher_email IS NOT NULL THEN
      IF v_user_record.role IS NULL OR v_user_record.role != 'teacher' THEN
        INSERT INTO public.profiles (id, role, email, full_name, avatar_url, created_at, updated_at)
        VALUES (
          v_user_record.id,
          'teacher',
          v_user_record.email,
          v_user_record.raw_user_meta_data->>'full_name',
          v_user_record.raw_user_meta_data->>'avatar_url',
          now(),
          now()
        )
        ON CONFLICT (id)
        DO UPDATE SET
          role = 'teacher',
          email = COALESCE(v_user_record.email, profiles.email),
          full_name = COALESCE(v_user_record.raw_user_meta_data->>'full_name', profiles.full_name),
          avatar_url = COALESCE(v_user_record.raw_user_meta_data->>'avatar_url', profiles.avatar_url),
          updated_at = now();

        v_assigned := true;
      ELSE
        v_assigned := false;
      END IF;
    END IF;

    RETURN QUERY SELECT v_user_record.id, v_user_record.email, v_assigned, v_teacher_email;
  END LOOP;
END;
$function$;

-- Guard the sync without restating its ~90 lines of merge logic: rename the
-- existing body aside and wrap it. Less risk of a transcription error than
-- retyping the UPDATE/INSERT block, and the merge behaviour is provably
-- unchanged because it is the same function.
alter function public.sync_teachers_list_from_shikshaqmine()
  rename to sync_teachers_list_from_shikshaqmine_unguarded;

revoke all on function public.sync_teachers_list_from_shikshaqmine_unguarded() from public;
revoke all on function public.sync_teachers_list_from_shikshaqmine_unguarded() from anon, authenticated;

create or replace function public.sync_teachers_list_from_shikshaqmine()
returns table(updated_count integer, inserted_count integer, total_processed integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY SELECT * FROM public.sync_teachers_list_from_shikshaqmine_unguarded();
END;
$function$;

-- Layer (a): PUBLIC, not the role names. anon and authenticated inherit from
-- PUBLIC, so revoking from them alone would change nothing.
revoke all on function public.check_existing_users_for_teacher_role() from public;
revoke all on function public.check_existing_users_for_teacher_role() from anon, authenticated;

revoke all on function public.sync_teachers_list_from_shikshaqmine() from public;
revoke all on function public.sync_teachers_list_from_shikshaqmine() from anon, authenticated;

grant execute on function public.check_existing_users_for_teacher_role() to service_role;
grant execute on function public.sync_teachers_list_from_shikshaqmine() to service_role;

comment on function public.check_existing_users_for_teacher_role() is
  'Admin/service maintenance only. Enumerates auth.users, so EXECUTE is revoked from PUBLIC and the body refuses any JWT that is not an admin.';
comment on function public.sync_teachers_list_from_shikshaqmine() is
  'Admin/service maintenance only. Guard wrapper around sync_teachers_list_from_shikshaqmine_unguarded, which holds the unchanged merge logic.';
