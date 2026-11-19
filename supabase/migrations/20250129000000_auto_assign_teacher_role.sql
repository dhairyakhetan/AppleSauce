-- Migration: Auto-assign teacher role based on email match with Shikshaqmine table
-- When a user signs up, if their email matches a teacher email in Shikshaqmine,
-- automatically assign them the "teacher" role

-- Function to auto-assign teacher role based on email match
CREATE OR REPLACE FUNCTION auto_assign_teacher_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_email TEXT;
  v_user_email TEXT;
  v_user_full_name TEXT;
  v_user_avatar_url TEXT;
BEGIN
  -- Get user's email from auth.users
  v_user_email := NEW.email;
  
  -- Get user metadata if available
  v_user_full_name := NEW.raw_user_meta_data->>'full_name';
  v_user_avatar_url := NEW.raw_user_meta_data->>'avatar_url';
  
  -- Check if email exists in Shikshaqmine table (case-insensitive, trimmed)
  IF v_user_email IS NOT NULL AND v_user_email != '' THEN
    SELECT "Email ID" INTO v_teacher_email
    FROM public."Shikshaqmine"
    WHERE LOWER(TRIM("Email ID")) = LOWER(TRIM(v_user_email))
      AND "Email ID" IS NOT NULL
      AND "Email ID" != ''
    LIMIT 1;
    
    -- If email matches, assign teacher role
    IF v_teacher_email IS NOT NULL THEN
      -- Insert or update profile with teacher role
      -- This will override any default 'student' role set by handle_new_user
      -- Note: terms_agreement is NOT set automatically - teachers must consent via UI
      INSERT INTO public.profiles (id, role, email, full_name, avatar_url, created_at, updated_at)
      VALUES (
        NEW.id,
        'teacher',
        v_user_email,
        v_user_full_name,
        v_user_avatar_url,
        now(),
        now()
      )
      ON CONFLICT (id) 
      DO UPDATE SET 
        role = 'teacher',
        email = COALESCE(v_user_email, profiles.email),
        full_name = COALESCE(v_user_full_name, profiles.full_name),
        avatar_url = COALESCE(v_user_avatar_url, profiles.avatar_url),
        updated_at = now();
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger on new user creation in auth.users
-- Note: This trigger runs AFTER handle_new_user() which sets default role to 'student'
-- This trigger will override the role to 'teacher' if email matches a teacher in Shikshaqmine
DROP TRIGGER IF EXISTS on_auth_user_created_assign_teacher_role ON auth.users;
CREATE TRIGGER on_auth_user_created_assign_teacher_role
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_teacher_role();

-- Function to manually check existing users and assign teacher role
-- This can be run to assign roles to users who signed up before this trigger was created
CREATE OR REPLACE FUNCTION check_existing_users_for_teacher_role()
RETURNS TABLE(
  user_id UUID,
  user_email TEXT,
  assigned_role BOOLEAN,
  teacher_email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_record RECORD;
  v_teacher_email TEXT;
  v_assigned BOOLEAN;
BEGIN
  -- Loop through all users
  FOR v_user_record IN
    SELECT 
      u.id,
      u.email,
      u.raw_user_meta_data,
      p.role
    FROM auth.users u
    LEFT JOIN public.profiles p ON u.id = p.id
    WHERE u.email IS NOT NULL
      AND u.email != ''
  LOOP
    v_assigned := false;
    v_teacher_email := NULL;
    
    -- Check if email matches any teacher
    SELECT "Email ID" INTO v_teacher_email
    FROM public."Shikshaqmine"
    WHERE LOWER(TRIM("Email ID")) = LOWER(TRIM(v_user_record.email))
      AND "Email ID" IS NOT NULL
      AND "Email ID" != ''
    LIMIT 1;
    
    -- If match found and user doesn't already have teacher role, assign it
    IF v_teacher_email IS NOT NULL THEN
      IF v_user_record.role IS NULL OR v_user_record.role != 'teacher' THEN
        INSERT INTO public.profiles (id, role, email, full_name, avatar_url, created_at, updated_at)
        VALUES (
          v_user_record.id,
          'teacher',
          v_user_record.email,
          v_user_record.raw_user_meta_data->>'full_name',
          v_user_record.raw_user_meta_data->>'avatar_url',
          now(),
          now()
        )
        ON CONFLICT (id) 
        DO UPDATE SET 
          role = 'teacher',
          email = COALESCE(v_user_record.email, profiles.email),
          full_name = COALESCE(v_user_record.raw_user_meta_data->>'full_name', profiles.full_name),
          avatar_url = COALESCE(v_user_record.raw_user_meta_data->>'avatar_url', profiles.avatar_url),
          updated_at = now();
        
        v_assigned := true;
      ELSE
        -- User already has teacher role
        v_assigned := false;
      END IF;
    END IF;
    
    -- Return result
    RETURN QUERY SELECT 
      v_user_record.id,
      v_user_record.email,
      v_assigned,
      v_teacher_email;
  END LOOP;
END;
$$;

-- Function to assign teacher role to a specific user by email
-- Useful for manual assignment
CREATE OR REPLACE FUNCTION assign_teacher_role_by_email(user_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_teacher_email TEXT;
  v_user_record RECORD;
BEGIN
  -- Find user by email
  SELECT id, email, raw_user_meta_data INTO v_user_record
  FROM auth.users
  WHERE LOWER(TRIM(email)) = LOWER(TRIM(user_email))
  LIMIT 1;
  
  IF v_user_record.id IS NULL THEN
    RETURN false;
  END IF;
  
  -- Check if email matches any teacher
  SELECT "Email ID" INTO v_teacher_email
  FROM public."Shikshaqmine"
  WHERE LOWER(TRIM("Email ID")) = LOWER(TRIM(user_email))
    AND "Email ID" IS NOT NULL
    AND "Email ID" != ''
  LIMIT 1;
  
  -- If match found, assign teacher role
  IF v_teacher_email IS NOT NULL THEN
    INSERT INTO public.profiles (id, role, email, full_name, avatar_url, created_at, updated_at)
    VALUES (
      v_user_record.id,
      'teacher',
      v_user_record.email,
      v_user_record.raw_user_meta_data->>'full_name',
      v_user_record.raw_user_meta_data->>'avatar_url',
      now(),
      now()
    )
    ON CONFLICT (id) 
    DO UPDATE SET 
      role = 'teacher',
      email = COALESCE(v_user_record.email, profiles.email),
      full_name = COALESCE(v_user_record.raw_user_meta_data->>'full_name', profiles.full_name),
      avatar_url = COALESCE(v_user_record.raw_user_meta_data->>'avatar_url', profiles.avatar_url),
      updated_at = now();
    
    RETURN true;
  END IF;
  
  RETURN false;
END;
$$;

-- Grant execute permissions to authenticated users (for manual assignment)
GRANT EXECUTE ON FUNCTION assign_teacher_role_by_email(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION check_existing_users_for_teacher_role() TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION auto_assign_teacher_role() IS 'Automatically assigns teacher role to users whose email matches a teacher email in Shikshaqmine table. Teachers must still complete terms agreement via UI.';
COMMENT ON FUNCTION check_existing_users_for_teacher_role() IS 'Checks all existing users and assigns teacher role if their email matches a teacher in Shikshaqmine. Teachers must still complete terms agreement via UI.';
COMMENT ON FUNCTION assign_teacher_role_by_email(TEXT) IS 'Manually assigns teacher role to a user by their email address if it matches a teacher in Shikshaqmine. Teachers must still complete terms agreement via UI.';

