-- Migration: Restrict public access to profiles table
--
-- Problem: The "Anyone can view profiles for comments" policy (USING (true))
-- exposes ALL profile fields to anyone with the anon key, including:
--   - email, phone, address, date_of_birth, guardian_email, etc.
--
-- Fix:
--   1. Drop the overly permissive USING(true) SELECT policy
--   2. Keep the existing "Users can view own profile" policy (auth.uid() = id)
--   3. Add "Admins can view all profiles" policy (for AdminFeedback/AdminComments)
--   4. Create a public_profiles VIEW exposing only safe, non-PII fields
--   5. Grant anon/authenticated access to the view
--
-- Frontend queries that read OTHER users' profiles (TeacherComments, TeacherProfile)
-- will use the public_profiles view instead of the profiles table directly.

-- ============================================================================
-- 1. Drop the overly permissive policy
-- ============================================================================
DROP POLICY IF EXISTS "Anyone can view profiles for comments" ON public.profiles;

-- Also drop the duplicate from the initial migration if it exists
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;

-- ============================================================================
-- 2. Ensure the self-access policy exists
-- ============================================================================
-- Users can always read their own profile (for dashboards, navbar, auth, etc.)
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- ============================================================================
-- 3. Add admin policy — admins can view all profiles
--    (needed for AdminFeedback, AdminComments pages)
-- ============================================================================
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  USING (public.is_admin());

-- ============================================================================
-- 4. Create public_profiles VIEW with ONLY safe, non-PII fields
--    This is what public/unauthenticated queries should use
--    Uses security_invoker = on so the view runs with the querying user's
--    permissions, ensuring RLS policies on the profiles table are respected
-- ============================================================================
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

-- Grant access to the view for both anon and authenticated roles
GRANT SELECT ON public.public_profiles TO anon;
GRANT SELECT ON public.public_profiles TO authenticated;

-- ============================================================================
-- 5. Documentation
-- ============================================================================
COMMENT ON VIEW public.public_profiles IS 
'Public-facing view of profiles exposing only non-PII fields (name, role, school, grade, avatar). Used for comment author display and studies-with lists. Private fields (email, phone, address, DOB, guardian_email) are NOT exposed.';

COMMENT ON POLICY "Users can view own profile" ON public.profiles IS 
'Users can read their own full profile (all fields). Used by dashboards, navbar, auth flows.';

COMMENT ON POLICY "Admins can view all profiles" ON public.profiles IS 
'Admins can read all profiles including PII. Used by AdminFeedback, AdminComments pages.';

