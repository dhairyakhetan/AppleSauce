-- Migration: Fix "Function Search Path Mutable" linter warnings
-- 
-- The Supabase database linter flagged 5 functions with mutable search_path.
-- A mutable search_path can allow search-path injection attacks where an
-- attacker creates objects in a different schema to hijack function behavior.
--
-- Fix: SET search_path = public on all affected functions.
-- Using ALTER FUNCTION to avoid recreating the functions (preserves existing behavior).

-- ============================================================================
-- 1. get_teacher_email() — SECURITY DEFINER without SET search_path (CRITICAL)
-- ============================================================================
ALTER FUNCTION public.get_teacher_email()
  SET search_path = public;

-- ============================================================================
-- 2. prevent_role_escalation() — trigger function without SET search_path
-- ============================================================================
ALTER FUNCTION public.prevent_role_escalation()
  SET search_path = public;

-- ============================================================================
-- 3. generate_unique_slug(TEXT) — IMMUTABLE without SET search_path
-- ============================================================================
ALTER FUNCTION public.generate_unique_slug(TEXT)
  SET search_path = public;

-- ============================================================================
-- 4. combine_areas(TEXT, TEXT) — IMMUTABLE without SET search_path
-- ============================================================================
ALTER FUNCTION public.combine_areas(TEXT, TEXT)
  SET search_path = public;

-- ============================================================================
-- 5. normalize_phone_to_10_digits — created outside migrations
--    Using DO block to handle case where function doesn't exist locally
-- ============================================================================
DO $$
BEGIN
  -- Try to alter the function; skip gracefully if it doesn't exist
  EXECUTE 'ALTER FUNCTION public.normalize_phone_to_10_digits(TEXT) SET search_path = public';
EXCEPTION
  WHEN undefined_function THEN
    RAISE NOTICE 'Function normalize_phone_to_10_digits(TEXT) does not exist, skipping.';
END;
$$;

-- ============================================================================
-- Verification comments
-- ============================================================================
COMMENT ON FUNCTION public.get_teacher_email() IS 'Get the email of the currently authenticated teacher. SECURITY DEFINER with immutable search_path.';
COMMENT ON FUNCTION public.prevent_role_escalation() IS 'Prevents users from escalating their role via direct profile updates. Search path secured.';
COMMENT ON FUNCTION public.generate_unique_slug(TEXT) IS 'Generates a unique slug from a teacher name with secured search path.';
COMMENT ON FUNCTION public.combine_areas(TEXT, TEXT) IS 'Combines two comma-separated area strings into a single unique, sorted string. Search path secured.';

