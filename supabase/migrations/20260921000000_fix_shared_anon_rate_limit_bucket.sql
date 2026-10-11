-- =========================================================================
-- FIX: check_user_exists / check_user_has_password's "global" rate limit
-- was one shared bucket across every anonymous caller on the whole site,
-- not a per-caller limit.
--
-- THE BUG. Both functions already have real, working rate limiting via
-- check_rate_limit() (a persistent rate_limit_log table, genuine fixed
-- 15-minute windows) -- this is not adding rate limiting where none
-- existed. The per-email limit (5 attempts / 15 min, keyed on the email
-- argument) is correct as written. The "global" limit is not:
--
--   session_id := COALESCE(auth.uid()::TEXT, 'anon_global');
--
-- For every signed-in caller this is their own uid -- correct, per-caller.
-- For every ANONYMOUS caller, auth.uid() is NULL for all of them, so this
-- collapses to the literal string 'anon_global' for the entire site's
-- anonymous traffic combined. The "20 calls per 15 minutes" limit is
-- therefore not 20-per-attacker, it is 20-per-SITE: confirmed live against
-- public.rate_limit_log, real usage has already hit 6 in a single window
-- pre-launch with no real traffic yet. Once launch traffic arrives, any
-- ordinary cluster of sign-in attempts (a handful of parents and students
-- signing up in the same 15 minutes -- the exact thing a launch is
-- supposed to cause) hits this ceiling, and check_user_exists starts
-- returning false for every anonymous caller sitewide until the window
-- rolls over. Since sign-in reads this value to decide whether an email
-- already has an account, that is a self-inflicted outage of the sign-in
-- flow's email check for every anonymous visitor, not a defense against
-- one attacker.
--
-- THE FIX. Give anonymous callers a real per-caller identifier instead of
-- a shared literal: the same ip_hash expression already used elsewhere in
-- this codebase for read_events (teacher_whatsapp_link, bank_paper_questions)
-- -- sha256 of the x-forwarded-for header, empty string if the header is
-- not exposed. Confirmed live and WORKING on this project (non-empty,
-- distinct hashes already present in read_events), so this is reusing a
-- technique already proven to work here, not introducing an unverified one.
-- Requires 'extensions' on the search_path (pgcrypto's digest() lives
-- there, not public -- the same gotcha the read_events work already hit
-- once and documented).
--
-- WHAT THIS DOES NOT CHANGE. The per-email limit, the artificial timing-
-- attack delay, and the underlying check_rate_limit()/rate_limit_log
-- mechanism are all untouched and already correct. Function signatures,
-- return types and grants are unchanged -- this only replaces one
-- identifier expression inside each function body.
--
-- SAFETY. CREATE OR REPLACE resets a function's ACL to the default, and
-- this project's own documented gotcha is that Supabase's default grants
-- EXECUTE to anon/authenticated by role name regardless of what the
-- previous ACL said. Both functions must stay anon-callable (sign-in calls
-- them pre-auth), so the grants below are explicit rather than assumed,
-- matching the existing grant these functions already carry.
-- =========================================================================

begin;

create or replace function public.check_user_exists(user_email text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
DECLARE
  user_exists BOOLEAN;
  rate_limit_ok BOOLEAN;
  global_rate_ok BOOLEAN;
  identifier TEXT;
  session_id TEXT;
BEGIN
  -- Per-email rate limit (unchanged)
  identifier := COALESCE(user_email, 'anonymous');

  SELECT public.check_rate_limit(
    'check_user_exists',
    identifier,
    5,
    15
  ) INTO rate_limit_ok;

  IF NOT rate_limit_ok THEN
    RETURN false;
  END IF;

  -- Global rate limit: now per-caller for anonymous callers too, via the
  -- same ip_hash expression read_events already uses. auth.uid() still
  -- wins when the caller is signed in, so an authenticated attacker is
  -- still keyed on their own account, not their IP.
  session_id := COALESCE(
    auth.uid()::TEXT,
    encode(extensions.digest(coalesce(
      current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''
    ), 'sha256'), 'hex')
  );

  SELECT public.check_rate_limit(
    'check_user_exists_global',
    session_id,
    20,
    15
  ) INTO global_rate_ok;

  IF NOT global_rate_ok THEN
    RETURN false;
  END IF;

  -- Artificial delay to prevent timing attacks (unchanged)
  PERFORM pg_sleep(0.05 + random() * 0.1);

  SELECT EXISTS(
    SELECT 1
    FROM auth.users
    WHERE email = user_email
  ) INTO user_exists;

  RETURN user_exists;
END;
$function$;

revoke all on function public.check_user_exists(text) from public;
grant execute on function public.check_user_exists(text) to anon, authenticated;

create or replace function public.check_user_has_password(user_email text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
DECLARE
  user_exists BOOLEAN;
  has_password BOOLEAN;
  rate_limit_ok BOOLEAN;
  global_rate_ok BOOLEAN;
  identifier TEXT;
  session_id TEXT;
BEGIN
  -- Per-email rate limit (unchanged)
  identifier := COALESCE(user_email, 'anonymous');

  SELECT public.check_rate_limit(
    'check_user_has_password',
    identifier,
    5,
    15
  ) INTO rate_limit_ok;

  IF NOT rate_limit_ok THEN
    RETURN false;
  END IF;

  -- Global rate limit: same fix as check_user_exists above.
  session_id := COALESCE(
    auth.uid()::TEXT,
    encode(extensions.digest(coalesce(
      current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''
    ), 'sha256'), 'hex')
  );

  SELECT public.check_rate_limit(
    'check_user_has_password_global',
    session_id,
    20,
    15
  ) INTO global_rate_ok;

  IF NOT global_rate_ok THEN
    RETURN false;
  END IF;

  -- Artificial delay to prevent timing attacks (unchanged)
  PERFORM pg_sleep(0.05 + random() * 0.1);

  SELECT EXISTS(
    SELECT 1
    FROM auth.users
    WHERE email = user_email
  ) INTO user_exists;

  IF NOT user_exists THEN
    RETURN false;
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM auth.users
    WHERE email = user_email
    AND encrypted_password IS NOT NULL
    AND encrypted_password != ''
  ) INTO has_password;

  RETURN has_password;
END;
$function$;

revoke all on function public.check_user_has_password(text) from public;
grant execute on function public.check_user_has_password(text) to anon, authenticated;

commit;

-- =========================================================================
-- VERIFICATION
-- =========================================================================
-- 1. Both functions still answer normally for a real call (not rate
--    limited, since this migration doesn't touch the per-email bucket):
--      select public.check_user_exists('a-real-account-email@example.com');
--      -- EXPECT true
--      select public.check_user_exists('definitely-not-a-user@example.invalid');
--      -- EXPECT false
--
-- 2. The global bucket is now keyed per-caller, not on the literal string
--    'anon_global'. Calling either function repeatedly from this SQL editor
--    (which has no request.headers, so ip_hash is sha256('') = the same
--    empty-header hash every time) still shares one bucket -- that is
--    expected and correct: it's now "one bucket per distinct caller", and
--    the SQL editor is one caller with no forwarded-for header, same as
--    the old code's blind spot when request.headers isn't exposed at all.
--    The real fix only shows up in production traffic, where PostgREST
--    exposes real x-forwarded-for values per request. Confirm no exception
--    is raised by either function on repeated calls:
--      select public.check_user_exists('a-real-account-email@example.com')
--        from generate_series(1, 3);
--
-- 3. anon can still execute both (has_function_privilege, not proacl):
--      select has_function_privilege('anon', 'public.check_user_exists(text)', 'EXECUTE'),
--             has_function_privilege('anon', 'public.check_user_has_password(text)', 'EXECUTE');
--      -- EXPECT true, true
--
-- ROLLBACK: re-apply the two CREATE OR REPLACE bodies from before this
-- migration (COALESCE(auth.uid()::TEXT, 'anon_global'), no 'extensions' on
-- search_path) and re-run the same two grant statements above.
-- =========================================================================
