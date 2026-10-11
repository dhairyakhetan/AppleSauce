-- Revert check_user_has_password function to state from commit 9c8e6d4
-- This removes changes made in migration 20250128000005_fix_check_user_has_password_permissions.sql
-- Restores the function to its original definition with SET search_path = public (without auth schema)
-- and without service_role grant

-- Drop the function
DROP FUNCTION IF EXISTS public.check_user_has_password(TEXT);

-- Recreate with original definition from 9c8e6d4
CREATE OR REPLACE FUNCTION public.check_user_has_password(user_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_exists BOOLEAN;
  has_password BOOLEAN;
BEGIN
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

-- Grant execute permission to authenticated and anon users (original grants)
GRANT EXECUTE ON FUNCTION public.check_user_has_password(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_user_has_password(TEXT) TO anon;

-- Revoke service_role grant if it was added
REVOKE EXECUTE ON FUNCTION public.check_user_has_password(TEXT) FROM service_role;

-- Add comment
COMMENT ON FUNCTION public.check_user_has_password(TEXT) IS 
'Checks if a user with the given email exists and has a password set. Returns true if user has password, false if user doesn''t exist or doesn''t have a password (e.g., Google Auth user).';

