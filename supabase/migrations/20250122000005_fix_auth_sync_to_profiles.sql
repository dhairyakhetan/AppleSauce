-- Fix auth to profiles sync to automatically update profile picture and name from Google OAuth
-- This ensures profiles are always in sync with auth.users metadata

-- Update the handle_new_user function to work with current profiles table structure
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Insert or update profile with Google auth data
  INSERT INTO public.profiles (id, email, full_name, avatar_url, role)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    'student' -- Default role for new users
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = COALESCE(EXCLUDED.email, profiles.email),
    full_name = COALESCE(
      EXCLUDED.full_name,
      profiles.full_name,
      COALESCE(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
    ),
    avatar_url = COALESCE(
      EXCLUDED.avatar_url,
      profiles.avatar_url,
      new.raw_user_meta_data ->> 'avatar_url'
    ),
    updated_at = now();
  
  RETURN new;
END;
$$;

-- Create or replace function to sync auth updates to profiles
CREATE OR REPLACE FUNCTION sync_auth_updates_to_profiles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update profile when auth user metadata changes (e.g., Google OAuth sign-in)
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
  
  -- If profile doesn't exist, create it
  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, email, full_name, avatar_url, role)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
      NEW.raw_user_meta_data->>'avatar_url',
      'student'
    )
    ON CONFLICT (id) DO UPDATE
    SET
      email = COALESCE(EXCLUDED.email, profiles.email),
      full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
      avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
      updated_at = now();
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS sync_auth_updates_to_profiles_trigger ON auth.users;

-- Create trigger for new user creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW 
  EXECUTE FUNCTION public.handle_new_user();

-- Create trigger to sync on user update (when Google OAuth signs in again)
CREATE TRIGGER sync_auth_updates_to_profiles_trigger
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (
    OLD.raw_user_meta_data IS DISTINCT FROM NEW.raw_user_meta_data OR
    OLD.email IS DISTINCT FROM NEW.email
  )
  EXECUTE FUNCTION sync_auth_updates_to_profiles();

-- Sync existing users' data immediately
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
  ),
  updated_at = now()
WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = p.id);

