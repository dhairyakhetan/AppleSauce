-- Migration: Fix 4 medium-severity security issues
-- 1. Recommendations: any authenticated user can UPDATE any recommendation
-- 2. Teacher field restrictions: Title, Slug, Sir/Ma'am, EXPANDED not protected at DB level
-- 3. Email enumeration: rate limit is per-email (attacker can check thousands of unique emails)
-- 4. Application spam: no rate limit on teacher_applications inserts


-- ============================================================================
-- FIX 1: Restrict recommendation updates to admins only
-- ============================================================================
-- Previously: "Authenticated users can update recommendations" allowed ANY logged-in user
-- to change status/notes on any recommendation.
-- Fix: Only admins can update recommendations.

DROP POLICY IF EXISTS "Authenticated users can update recommendations" ON public.teacher_recommendations;

CREATE POLICY "Only admins can update recommendations"
  ON public.teacher_recommendations
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Also restrict SELECT to: own recommendations OR admin
-- Previously any authenticated user could see ALL recommendations
DROP POLICY IF EXISTS "Authenticated users can view recommendations" ON public.teacher_recommendations;

CREATE POLICY "Users can view own recommendations"
  ON public.teacher_recommendations
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL 
    AND user_id IS NOT NULL
    AND auth.uid() = user_id  -- Users can see their own submissions
  );

CREATE POLICY "Admins can view all recommendations"
  ON public.teacher_recommendations
  FOR SELECT
  USING (public.is_admin());


-- ============================================================================
-- FIX 2: Protect teacher fields at DB level (Title, Slug, Sir/Ma'am, EXPANDED)
-- ============================================================================
-- The teacher dashboard correctly doesn't send these fields, but a malicious teacher
-- could bypass the frontend and use the Supabase client directly.
-- This trigger prevents non-admin users from changing protected fields.

CREATE OR REPLACE FUNCTION public.protect_teacher_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow admins to change anything
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- For non-admin users (teachers), prevent changes to protected fields
  -- If the old value differs from the new value, revert it
  IF OLD."Title" IS DISTINCT FROM NEW."Title" THEN
    NEW."Title" := OLD."Title";
  END IF;

  IF OLD."Slug" IS DISTINCT FROM NEW."Slug" THEN
    NEW."Slug" := OLD."Slug";
  END IF;

  IF OLD."Sir/Ma'am?" IS DISTINCT FROM NEW."Sir/Ma'am?" THEN
    NEW."Sir/Ma'am?" := OLD."Sir/Ma'am?";
  END IF;

  -- EXPANDED field (used for SEO/admin-managed content)
  IF OLD."EXPANDED" IS DISTINCT FROM NEW."EXPANDED" THEN
    NEW."EXPANDED" := OLD."EXPANDED";
  END IF;

  -- Also protect Email ID from being changed by the teacher
  IF OLD."Email ID" IS DISTINCT FROM NEW."Email ID" THEN
    NEW."Email ID" := OLD."Email ID";
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists, then create
DROP TRIGGER IF EXISTS trigger_protect_teacher_fields ON public."Shikshaqmine";

CREATE TRIGGER trigger_protect_teacher_fields
  BEFORE UPDATE ON public."Shikshaqmine"
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_teacher_fields();

COMMENT ON FUNCTION public.protect_teacher_fields() IS 
'Prevents non-admin users from modifying protected Shikshaqmine fields: Title, Slug, Sir/Ma''am?, EXPANDED, Email ID. Admins can modify all fields.';


-- ============================================================================
-- FIX 3: Strengthen email enumeration rate limiting
-- ============================================================================
-- Problem: Rate limit is per-email (10 per 15 min per email).
-- An attacker can check thousands of unique emails (10 each).
-- Fix: Add a GLOBAL rate limit across all emails using auth session/anon key.
-- This limits total enumeration attempts regardless of which email is checked.

-- Update check_user_exists with global rate limit
CREATE OR REPLACE FUNCTION public.check_user_exists(user_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_exists BOOLEAN;
  rate_limit_ok BOOLEAN;
  global_rate_ok BOOLEAN;
  identifier TEXT;
  session_id TEXT;
BEGIN
  -- Per-email rate limit
  identifier := COALESCE(user_email, 'anonymous');
  
  SELECT public.check_rate_limit(
    'check_user_exists',
    identifier,
    5,  -- reduced from 10 to 5 attempts per email
    15  -- window in minutes
  ) INTO rate_limit_ok;
  
  IF NOT rate_limit_ok THEN
    RETURN false;
  END IF;

  -- Global rate limit: max 20 total calls per 15 minutes regardless of email
  -- Uses the auth user ID if authenticated, or 'anon_global' for anonymous
  session_id := COALESCE(auth.uid()::TEXT, 'anon_global');
  
  SELECT public.check_rate_limit(
    'check_user_exists_global',
    session_id,
    20, -- max 20 total lookups per session per window
    15  -- window in minutes
  ) INTO global_rate_ok;
  
  IF NOT global_rate_ok THEN
    RETURN false;
  END IF;

  -- Artificial delay to prevent timing attacks (50-150ms random)
  PERFORM pg_sleep(0.05 + random() * 0.1);

  SELECT EXISTS(
    SELECT 1 
    FROM auth.users 
    WHERE email = user_email
  ) INTO user_exists;

  RETURN user_exists;
END;
$$;

-- Update check_user_has_password with global rate limit
CREATE OR REPLACE FUNCTION public.check_user_has_password(user_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_exists BOOLEAN;
  has_password BOOLEAN;
  rate_limit_ok BOOLEAN;
  global_rate_ok BOOLEAN;
  identifier TEXT;
  session_id TEXT;
BEGIN
  -- Per-email rate limit
  identifier := COALESCE(user_email, 'anonymous');
  
  SELECT public.check_rate_limit(
    'check_user_has_password',
    identifier,
    5,  -- reduced from 10 to 5 attempts per email
    15  -- window in minutes
  ) INTO rate_limit_ok;
  
  IF NOT rate_limit_ok THEN
    RETURN false;
  END IF;

  -- Global rate limit
  session_id := COALESCE(auth.uid()::TEXT, 'anon_global');
  
  SELECT public.check_rate_limit(
    'check_user_has_password_global',
    session_id,
    20,
    15
  ) INTO global_rate_ok;
  
  IF NOT global_rate_ok THEN
    RETURN false;
  END IF;

  -- Artificial delay to prevent timing attacks
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
$$;


-- ============================================================================
-- FIX 4: Rate limit teacher application submissions (prevent spam)
-- ============================================================================
-- Currently: INSERT policy is WITH CHECK (true) — anyone can insert unlimited applications.
-- Fix: Add a trigger that limits applications per email to 3 per day.

CREATE OR REPLACE FUNCTION public.rate_limit_teacher_applications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count INTEGER;
BEGIN
  -- Count applications from this email in the last 24 hours
  SELECT COUNT(*)
  INTO recent_count
  FROM public.teacher_applications
  WHERE LOWER(TRIM(email)) = LOWER(TRIM(NEW.email))
    AND created_at > now() - INTERVAL '24 hours';

  -- Allow max 3 applications per email per 24 hours
  IF recent_count >= 3 THEN
    RAISE EXCEPTION 'Too many applications submitted. Please try again later.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists, then create
DROP TRIGGER IF EXISTS trigger_rate_limit_applications ON public.teacher_applications;

CREATE TRIGGER trigger_rate_limit_applications
  BEFORE INSERT ON public.teacher_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.rate_limit_teacher_applications();

COMMENT ON FUNCTION public.rate_limit_teacher_applications() IS 
'Rate limits teacher application submissions to 3 per email per 24 hours to prevent spam.';

-- Also update the INSERT policy to require either authentication or a valid email format
-- This provides a basic level of spam prevention at the RLS level
DROP POLICY IF EXISTS "Anyone can submit teacher applications" ON public.teacher_applications;

CREATE POLICY "Authenticated or valid submissions for teacher applications"
  ON public.teacher_applications FOR INSERT
  WITH CHECK (
    -- Must provide a non-empty email
    email IS NOT NULL AND TRIM(email) != ''
    -- Basic email format check (contains @ and a dot after @)
    AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  );

