-- Add rate limiting for sensitive RPC functions to prevent email enumeration
-- This creates a rate limiting mechanism at the database level

-- Create a table to track rate limit attempts
CREATE TABLE IF NOT EXISTS public.rate_limit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  function_name TEXT NOT NULL,
  identifier TEXT NOT NULL, -- IP address, email, or user ID
  attempt_count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(function_name, identifier, window_start)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_rate_limit_log_lookup 
  ON public.rate_limit_log(function_name, identifier, window_start);

-- Enable RLS on rate_limit_log
ALTER TABLE public.rate_limit_log ENABLE ROW LEVEL SECURITY;

-- Policy: Only service role can read/write rate limit logs (prevents tampering)
CREATE POLICY "Service role only for rate_limit_log"
  ON public.rate_limit_log
  FOR ALL
  USING (false); -- No one can read/write directly, only via functions

-- Function to check and update rate limit
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_function_name TEXT,
  p_identifier TEXT,
  p_max_attempts INTEGER DEFAULT 10,
  p_window_minutes INTEGER DEFAULT 15
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMP WITH TIME ZONE;
  v_attempt_count INTEGER;
  v_current_time TIMESTAMP WITH TIME ZONE := now();
BEGIN
  -- Calculate window start (round down to nearest window)
  -- Example: If current time is 14:37 and window is 15 minutes, round to 14:30
  v_window_start := date_trunc('hour', v_current_time) + 
    (FLOOR(EXTRACT(MINUTE FROM v_current_time)::INTEGER / p_window_minutes) * p_window_minutes || ' minutes')::INTERVAL;
  
  -- Get or create rate limit record
  INSERT INTO public.rate_limit_log (function_name, identifier, attempt_count, window_start)
  VALUES (p_function_name, p_identifier, 1, v_window_start)
  ON CONFLICT (function_name, identifier, window_start)
  DO UPDATE SET 
    attempt_count = rate_limit_log.attempt_count + 1,
    created_at = v_current_time
  RETURNING attempt_count INTO v_attempt_count;
  
  -- Check if limit exceeded
  IF v_attempt_count > p_max_attempts THEN
    RETURN false; -- Rate limit exceeded
  END IF;
  
  RETURN true; -- Within rate limit
END;
$$;

-- Function to clean up old rate limit records (run periodically)
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_log()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete records older than 1 hour
  DELETE FROM public.rate_limit_log
  WHERE created_at < now() - INTERVAL '1 hour';
END;
$$;

-- Update check_user_exists to include rate limiting
CREATE OR REPLACE FUNCTION public.check_user_exists(user_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_exists BOOLEAN;
  rate_limit_ok BOOLEAN;
  identifier TEXT;
BEGIN
  -- Use email as identifier for rate limiting
  identifier := COALESCE(user_email, 'anonymous');
  
  -- Check rate limit: 10 attempts per 15 minutes per email
  SELECT public.check_rate_limit(
    'check_user_exists',
    identifier,
    10, -- max attempts
    15  -- window in minutes
  ) INTO rate_limit_ok;
  
  -- If rate limit exceeded, return false (prevent enumeration)
  IF NOT rate_limit_ok THEN
    -- Log the rate limit violation (optional, for monitoring)
    -- For now, just return false to prevent enumeration
    RETURN false;
  END IF;
  
  -- Check if user exists in auth.users
  SELECT EXISTS(
    SELECT 1 
    FROM auth.users 
    WHERE email = user_email
  ) INTO user_exists;

  RETURN user_exists;
END;
$$;

-- Update check_user_has_password to include rate limiting
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
  identifier TEXT;
BEGIN
  -- Use email as identifier for rate limiting
  identifier := COALESCE(user_email, 'anonymous');
  
  -- Check rate limit: 10 attempts per 15 minutes per email
  SELECT public.check_rate_limit(
    'check_user_has_password',
    identifier,
    10, -- max attempts
    15  -- window in minutes
  ) INTO rate_limit_ok;
  
  -- If rate limit exceeded, return false (prevent enumeration)
  IF NOT rate_limit_ok THEN
    RETURN false;
  END IF;
  
  -- Check if user exists in auth.users
  SELECT EXISTS(
    SELECT 1 
    FROM auth.users 
    WHERE email = user_email
  ) INTO user_exists;

  -- If user doesn't exist, return false
  IF NOT user_exists THEN
    RETURN false;
  END IF;

  -- Check if user has a password (encrypted_password is not null)
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

-- Add comments
COMMENT ON FUNCTION public.check_rate_limit(TEXT, TEXT, INTEGER, INTEGER) IS 
'Checks if a request is within rate limits. Returns true if within limit, false if exceeded.';

COMMENT ON FUNCTION public.cleanup_rate_limit_log() IS 
'Cleans up old rate limit records. Should be run periodically via cron job.';

COMMENT ON TABLE public.rate_limit_log IS 
'Stores rate limit attempts for sensitive RPC functions to prevent abuse and email enumeration.';

