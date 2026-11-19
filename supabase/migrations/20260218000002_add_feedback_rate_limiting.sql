-- Migration: Add rate limiting to feedback submissions
--
-- Problem: The feedback table has no rate limiting on INSERT.
-- An attacker could spam thousands of feedback entries, especially
-- as a guest (is_guest = true) since no authentication is required.
--
-- Fix: Add a rate-limiting trigger that limits:
--   - Authenticated users: 5 feedback submissions per 24 hours
--   - Guest users: 5 feedback submissions per 24 hours
--     (tracked by guest_email or grouped as 'anonymous_guest')

-- ============================================================================
-- 1. Create rate limiting function for feedback
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rate_limit_feedback()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count INTEGER;
  identifier TEXT;
  max_allowed INTEGER;
  window_interval INTERVAL;
BEGIN
  IF NEW.is_guest = true THEN
    -- Guest submissions: rate limit by guest_email or 'anonymous_guest'
    identifier := COALESCE(NULLIF(TRIM(NEW.guest_email), ''), 'anonymous_guest');
    max_allowed := 5;
    window_interval := INTERVAL '24 hours';
  ELSE
    -- Authenticated submissions: rate limit by user_id
    identifier := COALESCE(NEW.user_id::TEXT, 'unknown_user');
    max_allowed := 5;
    window_interval := INTERVAL '24 hours';
  END IF;

  -- Count recent feedback from this identifier
  SELECT COUNT(*)
  INTO recent_count
  FROM public.feedback
  WHERE
    CASE
      WHEN NEW.is_guest = true THEN
        is_guest = true
        AND COALESCE(NULLIF(TRIM(guest_email), ''), 'anonymous_guest') = identifier
      ELSE
        user_id = NEW.user_id
    END
    AND created_at > now() - window_interval;

  -- Check if limit exceeded
  IF recent_count >= max_allowed THEN
    RAISE EXCEPTION 'Too many feedback submissions. Please try again later.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. Create trigger
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_rate_limit_feedback ON public.feedback;

CREATE TRIGGER trigger_rate_limit_feedback
  BEFORE INSERT ON public.feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.rate_limit_feedback();

-- ============================================================================
-- 3. Documentation
-- ============================================================================

COMMENT ON FUNCTION public.rate_limit_feedback() IS 
'Rate limits feedback submissions: 5 per 24h for both authenticated users and guests. Prevents spam.';

