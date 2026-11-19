-- Migration: Sync Shikshaqmine Email ID changes to profiles.email
-- 
-- Problem: When an admin changes a teacher's email in Shikshaqmine, the profiles.email
-- doesn't get updated. This causes:
-- 1. Teacher loses access to their dashboard (can't find their record)
-- 2. RLS policies block access (email mismatch)
-- 3. Data inconsistency across tables
--
-- Solution: Add a trigger that syncs Shikshaqmine."Email ID" changes to profiles.email
-- when an admin updates it. This ensures teachers can always access their profile.

-- Function to sync email from Shikshaqmine to profiles
CREATE OR REPLACE FUNCTION public.sync_shikshaqmine_email_to_profiles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_email TEXT;
  new_email TEXT;
  profile_user_id UUID;
BEGIN
  -- Only sync if Email ID actually changed
  IF OLD."Email ID" IS DISTINCT FROM NEW."Email ID" THEN
    old_email := OLD."Email ID";
    new_email := NEW."Email ID";
    
    -- Skip if new email is NULL or empty
    IF new_email IS NULL OR TRIM(new_email) = '' THEN
      RETURN NEW;
    END IF;
    
    -- Find the profile by old email (to get the user_id)
    -- We need to find the profile that matches the OLD email to update it
    SELECT id INTO profile_user_id
    FROM public.profiles
    WHERE LOWER(TRIM(email)) = LOWER(TRIM(old_email))
      AND role = 'teacher'
    LIMIT 1;
    
    -- If we found a profile with the old email, update it to the new email
    IF profile_user_id IS NOT NULL THEN
      UPDATE public.profiles
      SET 
        email = new_email,
        updated_at = now()
      WHERE id = profile_user_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists, then create
DROP TRIGGER IF EXISTS trigger_sync_shikshaqmine_email_to_profiles ON public."Shikshaqmine";

CREATE TRIGGER trigger_sync_shikshaqmine_email_to_profiles
  AFTER UPDATE ON public."Shikshaqmine"
  FOR EACH ROW
  WHEN (OLD."Email ID" IS DISTINCT FROM NEW."Email ID")
  EXECUTE FUNCTION public.sync_shikshaqmine_email_to_profiles();

COMMENT ON FUNCTION public.sync_shikshaqmine_email_to_profiles() IS 
'Syncs email changes from Shikshaqmine to profiles table when an admin updates a teacher''s Email ID. Ensures teachers can always access their dashboard by keeping email addresses consistent across tables.';

COMMENT ON TRIGGER trigger_sync_shikshaqmine_email_to_profiles ON public."Shikshaqmine" IS 
'Automatically syncs Shikshaqmine Email ID changes to profiles.email to maintain data consistency and prevent teachers from losing access to their dashboard.';

