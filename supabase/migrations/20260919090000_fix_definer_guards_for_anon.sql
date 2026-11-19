-- =========================================================================
-- SUPERSEDED. Do not run this file on its own.
--
-- Its contents are section 2 of `supabase/RUN_THIS_LAST.sql`, which is the
-- single file to paste into the SQL editor. Running that file and then this
-- one would FAIL: the `alter function ... rename to` here is not repeatable, and
-- RUN_THIS_LAST.sql has already done it behind a check.
--
-- Kept because it is the migration of record for what changed and why.
-- =========================================================================

-- Make the in-body guards actually stop an anonymous caller.
--
-- 20260818120000 added two SECURITY DEFINER functions with this guard:
--
--   IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
--     RAISE EXCEPTION 'Not authorized';
--   END IF;
--
-- For an anonymous caller auth.uid() is NULL, so the left side is false, the
-- whole condition is false, and NO exception is raised. The guard stops a
-- signed-in non-admin and waves through anon -- the opposite order to the one
-- you would choose if only one could be caught.
--
-- It matters because of what the file claims. 20260818120000 describes these
-- guards as a second layer that "a future GRANT cannot silently reopen", and
-- for anon that is not true. The functions are closed today: EXECUTE is
-- revoked from public, anon and authenticated and granted only to
-- service_role, so this is not exploitable now. It is precisely the kind of
-- protection that gets leaned on later by someone who reads the comment
-- rather than the condition, at the moment a grant is being restored.
--
-- What sits behind the guard is worth the correction:
--   check_existing_users_for_teacher_role()  returns the id and EMAIL of every
--                                            account
--   sync_teachers_list_from_shikshaqmine()   writes to teachers_list
--
-- `NOT public.is_admin()` alone is the right condition: is_admin() returns
-- false for anon, so anon is rejected, and the signed-in non-admin case is
-- unchanged. Admin behaviour does not move.
--
-- ON NOT RETYPING THE BODIES. 20260818120000 wrapped the sync function rather
-- than restating it, for the reason written there: "Less risk of a
-- transcription error than retyping the UPDATE/INSERT block, and the merge
-- behaviour is provably unchanged because it is the same function." That
-- reasoning applies with more force here, because
-- check_existing_users_for_teacher_role carries a 50-line INSERT ... ON
-- CONFLICT merge that assigns teacher roles. So it gets the same treatment:
-- renamed aside, wrapped, body untouched. The sync wrapper is three lines of
-- delegation and is simply rewritten.

begin;

-- ---------------------------------------------------------------------------
-- check_existing_users_for_teacher_role: rename aside, wrap with a real guard.
-- ---------------------------------------------------------------------------
alter function public.check_existing_users_for_teacher_role()
  rename to check_existing_users_for_teacher_role_unguarded;

/* The inner function keeps its own weak guard. Harmless: it is only ever
   reached through the wrapper below, which has already established that the
   caller is an admin, so the weak condition passes for the only caller that
   can get there. Leaving it also means this migration touches no merge logic
   at all. */
revoke all on function public.check_existing_users_for_teacher_role_unguarded()
  from public, anon, authenticated;

create or replace function public.check_existing_users_for_teacher_role()
returns table(user_id uuid, user_email text, assigned_role boolean, teacher_email text)
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  -- Admin-only, and that now includes rejecting anon. The previous form,
  -- `auth.uid() IS NOT NULL AND NOT is_admin()`, passed for an anonymous
  -- caller because auth.uid() is NULL there.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY SELECT * FROM public.check_existing_users_for_teacher_role_unguarded();
END;
$function$;

-- ---------------------------------------------------------------------------
-- sync_teachers_list_from_shikshaqmine: already a thin wrapper over
-- _unguarded, so rewriting it risks nothing. Same one-word correction.
-- ---------------------------------------------------------------------------
create or replace function public.sync_teachers_list_from_shikshaqmine()
returns table(updated_count integer, inserted_count integer, total_processed integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY SELECT * FROM public.sync_teachers_list_from_shikshaqmine_unguarded();
END;
$function$;

-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE resets a function's ACL to the default, and Supabase's
-- default privileges grant EXECUTE to anon and authenticated BY ROLE NAME. So
-- replacing these without re-revoking hands back exactly the access
-- 20260818120000 removed -- the same trap 20260918140000 exists to close.
-- Revoke from all three, then restore the single grant these are meant to
-- carry.
-- ---------------------------------------------------------------------------
revoke all on function public.check_existing_users_for_teacher_role() from public, anon, authenticated;
revoke all on function public.sync_teachers_list_from_shikshaqmine()  from public, anon, authenticated;

grant execute on function public.check_existing_users_for_teacher_role() to service_role;
grant execute on function public.sync_teachers_list_from_shikshaqmine()  to service_role;

commit;

-- ===========================================================================
-- VERIFY
--   select p.proname,
--          case when p.proacl is null then 'DEFAULT (execute to public)'
--               else pg_catalog.array_to_string(p.proacl, ' | ') end as acl
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname like 'check_existing_users%'
--      or p.proname like 'sync_teachers_list%'
--   order by p.proname;
--
-- All four -- both wrappers and both _unguarded bodies -- must show NEITHER
-- anon nor authenticated. The two wrappers should show service_role.
--
-- A NULL acl is the failure to look for: it reads as "no explicit grants"
-- while actually meaning EXECUTE TO PUBLIC, which is how a replaced function
-- quietly reopens.
--
-- And from outside, as an anonymous caller, both should refuse:
--   POST /rest/v1/rpc/check_existing_users_for_teacher_role  -> 401/404
-- ===========================================================================
