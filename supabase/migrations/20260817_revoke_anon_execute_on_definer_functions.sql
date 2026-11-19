-- Revoke anonymous EXECUTE on SECURITY DEFINER functions
--
-- STATUS: APPLIED to project uvtifolnsneitetzohtn and verified against
-- pg_proc.proacl. This file reproduces what was actually run.
--
-- SEVERITY: hardening / defence-in-depth. NOT an incident.
-- The privileged RPCs were read before writing this and already authorize
-- correctly, so none of them was exploitable:
--   approve_teacher_application  -- raises unless auth.uid() = admin_id
--   assign_teacher_role_by_email -- raises unless auth.uid() = target, or is_admin()
--   get_teacher_email            -- WHERE id = auth.uid(), own row only
-- An anonymous caller reached an exception, not an escalation. The value here is
-- narrowing the surface so a function added later WITHOUT an auth.uid() check is
-- not anon-exposed by default, and so trigger-only functions stop being
-- REST-reachable at all.
--
-- TWO THINGS THAT MAKE THIS EASY TO GET WRONG (both were got wrong first time):
--
-- 1. `revoke execute ... from anon, authenticated` DOES NOTHING on its own.
--    Postgres grants EXECUTE to PUBLIC by default and both roles inherit it, so
--    has_function_privilege() still returns true afterwards. The revoke must
--    target PUBLIC, then grant EXECUTE back to `authenticated` for the RPCs the
--    application actually calls.
--
-- 2. Some functions ALSO carry an explicit `anon=X` grant on top of the PUBLIC
--    one, which a PUBLIC-only revoke leaves untouched.
--    sync_teachers_list_from_shikshaqmine was the one that mattered: an
--    anonymous caller could kick off a full teachers_list rebuild.
--    Always check proacl afterwards; do not trust a single privilege check.

begin;

-- ---------------------------------------------------------------------------
-- GROUP A · trigger-only functions
-- Triggers fire as the table owner, so removing the PUBLIC grant does not
-- affect trigger execution. Nothing should ever call these over REST.
-- ---------------------------------------------------------------------------
revoke execute on function public.auto_assign_teacher_role() from public;
revoke execute on function public.auto_update_area_from_student_tutor_areas() from public;
revoke execute on function public.compute_place_of_teaching() from public;
revoke execute on function public.enforce_recommendation_rate_limit() from public;
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_shikshaqmine_delete() from public;
revoke execute on function public.prevent_duplicate_pending_application() from public;
revoke execute on function public.prevent_user_approval_change() from public;
revoke execute on function public.protect_teacher_fields() from public;
revoke execute on function public.rate_limit_feedback() from public;
revoke execute on function public.rate_limit_teacher_applications() from public;
revoke execute on function public.revert_teacher_profile_role_on_shikshaqmine_delete() from public;
revoke execute on function public.sync_auth_to_profiles() from public;
revoke execute on function public.sync_auth_updates_to_profiles() from public;
revoke execute on function public.sync_shikshaqmine_email_to_profiles() from public;
revoke execute on function public.sync_shikshaqmine_to_teachers_list() from public;
revoke execute on function public.update_teacher_comments_approval() from public;
revoke execute on function public.cleanup_rate_limit_log() from public;

-- ---------------------------------------------------------------------------
-- GROUP B · privileged operations the app calls while signed in
-- Drop the blanket PUBLIC grant, hand EXECUTE back to `authenticated` only.
-- ---------------------------------------------------------------------------
revoke execute on function public.approve_teacher_application(uuid, uuid) from public;
grant  execute on function public.approve_teacher_application(uuid, uuid) to authenticated;

revoke execute on function public.assign_teacher_role_by_email(text) from public;
grant  execute on function public.assign_teacher_role_by_email(text) to authenticated;

revoke execute on function public.check_existing_users_for_teacher_role() from public;
grant  execute on function public.check_existing_users_for_teacher_role() to authenticated;

revoke execute on function public.get_teacher_email() from public;
grant  execute on function public.get_teacher_email() to authenticated;

-- Carried an explicit anon grant as well as the PUBLIC one, so it needs both.
revoke execute on function public.sync_teachers_list_from_shikshaqmine() from public;
revoke execute on function public.sync_teachers_list_from_shikshaqmine() from anon;
grant  execute on function public.sync_teachers_list_from_shikshaqmine() to authenticated;

-- ---------------------------------------------------------------------------
-- GROUP C · deliberately left anon-callable
-- The sign-in flow needs these before a session exists (e.g. "does this email
-- already have a password?" decides which auth path to show). They remain a
-- user-enumeration vector and should stay behind check_rate_limit.
--   check_rate_limit, check_user_exists, check_user_has_password,
--   get_public_profile_data, is_admin, is_teacher
-- Listed so the next reader knows this was a decision, not an oversight.
-- ---------------------------------------------------------------------------

commit;

-- Verification used after applying:
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
--          p.proacl::text
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef
--     and has_function_privilege('anon', p.oid, 'EXECUTE');
-- Expected: only the six GROUP C functions come back.
</content>
