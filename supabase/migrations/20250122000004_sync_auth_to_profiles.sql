-- Sync avatar_url and full_name from auth.users to profiles table
-- This ensures profiles have the latest data from Google OAuth

-- Function to sync auth data to profiles
CREATE OR REPLACE FUNCTION sync_auth_to_profiles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET 
    full_name = COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      profiles.full_name
    ),
    avatar_url = COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      profiles.avatar_url
    ),
    email = COALESCE(NEW.email, profiles.email),
    updated_at = now()
  WHERE id = NEW.id;
  
  RETURN NEW;
END;
$$;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS sync_auth_to_profiles_trigger ON auth.users;

-- Create trigger to sync on user update
CREATE TRIGGER sync_auth_to_profiles_trigger
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.raw_user_meta_data IS DISTINCT FROM NEW.raw_user_meta_data)
  EXECUTE FUNCTION sync_auth_to_profiles();

-- Sync existing users' data
UPDATE public.profiles p
SET 
  full_name = COALESCE(
    p.full_name,
    (SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = p.id),
    (SELECT raw_user_meta_data->>'name' FROM auth.users WHERE id = p.id)
  ),
  avatar_url = COALESCE(
    p.avatar_url,
    (SELECT raw_user_meta_data->>'avatar_url' FROM auth.users WHERE id = p.id)
  ),
  email = COALESCE(
    p.email,
    (SELECT email FROM auth.users WHERE id = p.id)
  )
WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = p.id);

