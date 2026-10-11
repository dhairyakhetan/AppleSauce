-- Allow public_profiles to show author info for non-anonymous reviews
--
-- Problem: public_profiles was created with security_invoker = on, so it runs
-- with the querying user's permissions. RLS on profiles only allows users to
-- see their own profile (and admins to see all). So when a student/guardian/
-- teacher loads the reviews section, the view returns rows only for themselves,
-- and all other comment authors get profiles = null -> displayed as "Anonymous".
--
-- Fix: Recreate the view WITHOUT security_invoker so it runs with the view
-- owner's permissions and can read all profiles. The view still exposes ONLY
-- non-PII columns (full_name, role, school_college, grade, avatar_url). The
-- profiles table itself remains protected by RLS for direct access; only this
-- view exposes limited data for comment/studies-with display.

DROP VIEW IF EXISTS public.public_profiles;

CREATE VIEW public.public_profiles
  AS
  SELECT
    id,
    full_name,
    role,
    school_college,
    grade,
    avatar_url
  FROM public.profiles;

GRANT SELECT ON public.public_profiles TO anon;
GRANT SELECT ON public.public_profiles TO authenticated;

COMMENT ON VIEW public.public_profiles IS
'Public-facing view of profiles: only non-PII fields. Used for comment author display and "I''ve studied here" lists. Runs with view owner permissions so students/guardians/teachers can see names for non-anonymous reviews.';
