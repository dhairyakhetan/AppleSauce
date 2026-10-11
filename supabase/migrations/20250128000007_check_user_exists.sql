-- Function to check if a user exists (regardless of password)
-- This helps distinguish between non-existent users and Google Auth users
-- Returns true if user exists, false if user doesn't exist

CREATE OR REPLACE FUNCTION public.check_user_exists(user_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_exists BOOLEAN;
BEGIN
  -- Check if user exists in auth.users
  SELECT EXISTS(
    SELECT 1 
    FROM auth.users 
    WHERE email = user_email
  ) INTO user_exists;

  RETURN user_exists;
END;
$$;

-- Grant execute permission to authenticated and anon users
GRANT EXECUTE ON FUNCTION public.check_user_exists(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_user_exists(TEXT) TO anon;

-- Add comment
COMMENT ON FUNCTION public.check_user_exists(TEXT) IS 
'Checks if a user with the given email exists in auth.users. Returns true if user exists, false if user doesn''t exist.';

