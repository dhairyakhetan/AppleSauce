-- Migration: Fix public_profiles view to use security_invoker
--
-- Problem: The public_profiles view was created without security_invoker = on.
-- By default, PostgreSQL views run with the view OWNER's permissions (like
-- SECURITY DEFINER for functions), which bypasses RLS on the underlying
-- profiles table. This means anyone querying the view could see all rows
-- regardless of RLS policies.
--
-- Fix: Recreate the view with security_invoker = on so it runs with the
-- QUERYING USER's permissions, ensuring RLS policies are enforced.

DROP VIEW IF EXISTS public.public_profiles;

CREATE VIEW public.public_profiles
  WITH (security_invoker = on)
  AS
  SELECT
    id,
    full_name,
    role,
    school_college,
    grade,
    avatar_url
  FROM public.profiles;

-- Re-grant access
GRANT SELECT ON public.public_profiles TO anon;
GRANT SELECT ON public.public_profiles TO authenticated;

COMMENT ON VIEW public.public_profiles IS 
'Public-facing view of profiles exposing only non-PII fields (name, role, school, grade, avatar). Uses security_invoker = on to respect RLS policies on the profiles table.';

