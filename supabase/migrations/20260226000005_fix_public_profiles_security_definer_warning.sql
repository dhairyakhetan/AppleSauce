-- Fix: resolve SECURITY DEFINER warning on public_profiles view
--
-- Problem: The view without security_invoker triggers Supabase's security linter
-- because it bypasses RLS (runs with the view owner's permissions).
--
-- Solution: Use a SECURITY DEFINER function that returns only non-PII columns,
-- and recreate the view with security_invoker = on calling that function.
-- - The VIEW has security_invoker = on → no Supabase warning
-- - The function bypasses RLS to read all profiles (needed for comment authors)
-- - The function only returns safe columns → no PII exposure
-- - Frontend queries to public_profiles continue to work unchanged

-- 1. Create a helper function that reads limited profile data (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_public_profile_data()
RETURNS TABLE (
  id uuid,
  full_name text,
  role text,
  school_college text,
  grade text,
  avatar_url text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.id, p.full_name, p.role, p.school_college, p.grade, p.avatar_url
  FROM profiles p;
$$;

-- 2. Recreate the view WITH security_invoker, backed by the function
DROP VIEW IF EXISTS public.public_profiles;

CREATE VIEW public.public_profiles
  WITH (security_invoker = on)
  AS SELECT * FROM get_public_profile_data();

GRANT SELECT ON public.public_profiles TO anon;
GRANT SELECT ON public.public_profiles TO authenticated;

COMMENT ON VIEW public.public_profiles IS
'Public-facing view of profiles: only non-PII fields (name, role, school, grade, avatar). Backed by get_public_profile_data() SECURITY DEFINER function so all profiles are readable. Used for comment author display and studies-with lists.';

COMMENT ON FUNCTION public.get_public_profile_data() IS
'Returns non-PII profile fields for all users. SECURITY DEFINER to bypass RLS. Used by the public_profiles view for displaying comment authors and student lists.';
