-- Function to check if a user has a password set
-- This helps distinguish between Google Auth users and email/password users
-- Returns true if user exists and has a password, false otherwise

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

-- Grant execute permission to authenticated and anon users
GRANT EXECUTE ON FUNCTION public.check_user_has_password(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_user_has_password(TEXT) TO anon;

-- Add comment
COMMENT ON FUNCTION public.check_user_has_password(TEXT) IS 
'Checks if a user with the given email exists and has a password set. Returns true if user has password, false if user doesn''t exist or doesn''t have a password (e.g., Google Auth user).';

