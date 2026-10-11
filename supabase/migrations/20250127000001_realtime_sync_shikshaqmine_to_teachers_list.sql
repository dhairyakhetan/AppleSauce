-- Migration: Real-time sync from Shikshaqmine to teachers_list
-- This creates triggers that automatically sync changes from Shikshaqmine to teachers_list
-- When a row is inserted, updated, or deleted in Shikshaqmine, teachers_list is automatically updated

-- Function to sync a single Shikshaqmine record to teachers_list
CREATE OR REPLACE FUNCTION sync_shikshaqmine_to_teachers_list()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_phone_number TEXT;
BEGIN
  -- Extract and normalize phone number
  IF NEW."Link" IS NOT NULL AND NEW."Link" != '' THEN
    v_phone_number := extract_phone_from_link(NEW."Link");
  ELSE
    v_phone_number := NULL;
  END IF;

  -- Try to find existing teacher by slug first, then by name
  IF EXISTS (
    SELECT 1 FROM public.teachers_list 
    WHERE slug = NEW."Slug" 
       OR (LOWER(TRIM(name)) = LOWER(TRIM(NEW."Title")) AND NEW."Title" IS NOT NULL AND NEW."Title" != '')
  ) THEN
    -- Update existing teacher
    UPDATE public.teachers_list
    SET 
      name = COALESCE(NEW."Title", teachers_list.name),
      slug = COALESCE(NEW."Slug", teachers_list.slug),
      image_url = COALESCE(
        NULLIF(NEW."Hero Image", ''),
        teachers_list.image_url
      ),
      location = COALESCE(
        NULLIF(NEW."Area", ''),
        NULLIF(NEW."LOCATION V2", ''),
        teachers_list.location
      ),
      whatsapp_number = COALESCE(
        v_phone_number,
        NULLIF(NEW."Link", ''),
        teachers_list.whatsapp_number
      ),
      subjects = COALESCE(
        NULLIF(NEW."Subjects", ''),
        teachers_list.subjects
      ),
      classes = COALESCE(
        NULLIF(NEW."Classes Taught", ''),
        teachers_list.classes
      ),
      "Sir/Ma'am?" = COALESCE(
        NULLIF(NEW."Sir/Ma'am?", ''),
        teachers_list."Sir/Ma'am?"
      )
    WHERE slug = NEW."Slug" 
       OR (LOWER(TRIM(name)) = LOWER(TRIM(NEW."Title")) AND NEW."Title" IS NOT NULL AND NEW."Title" != '');
  ELSE
    -- Insert new teacher if Title and Slug are present
    IF NEW."Title" IS NOT NULL AND NEW."Title" != '' AND NEW."Slug" IS NOT NULL AND NEW."Slug" != '' THEN
      INSERT INTO public.teachers_list (
        name,
        slug,
        image_url,
        bio,
        location,
        whatsapp_number,
        subjects,
        classes,
        "Sir/Ma'am?"
      )
      VALUES (
        NEW."Title",
        NEW."Slug",
        NULLIF(NEW."Hero Image", ''),
        NULL,
        COALESCE(
          NULLIF(NEW."Area", ''),
          NULLIF(NEW."LOCATION V2", '')
        ),
        v_phone_number,
        NULLIF(NEW."Subjects", ''),
        NULLIF(NEW."Classes Taught", ''),
        NULLIF(NEW."Sir/Ma'am?", '')
      )
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        image_url = EXCLUDED.image_url,
        location = EXCLUDED.location,
        whatsapp_number = EXCLUDED.whatsapp_number,
        subjects = EXCLUDED.subjects,
        classes = EXCLUDED.classes,
        "Sir/Ma'am?" = EXCLUDED."Sir/Ma'am?";
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Function to handle deletion - deletes from teachers_list when removed from Shikshaqmine
-- WARNING: This will cascade delete all related data (upvotes, comments, likes) due to foreign key constraints
CREATE OR REPLACE FUNCTION handle_shikshaqmine_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete from teachers_list when removed from Shikshaqmine
  -- This will cascade delete related data (upvotes, comments, likes) due to foreign key constraints
  DELETE FROM public.teachers_list WHERE slug = OLD."Slug";
  
  RETURN OLD;
END;
$$;

-- Create triggers
-- Trigger for INSERT and UPDATE
DROP TRIGGER IF EXISTS trigger_sync_shikshaqmine_to_teachers_list ON public."Shikshaqmine";
CREATE TRIGGER trigger_sync_shikshaqmine_to_teachers_list
  AFTER INSERT OR UPDATE ON public."Shikshaqmine"
  FOR EACH ROW
  WHEN (
    NEW."Title" IS NOT NULL 
    AND NEW."Title" != ''
    AND (NEW."Slug" IS NOT NULL AND NEW."Slug" != '')
  )
  EXECUTE FUNCTION sync_shikshaqmine_to_teachers_list();

-- Trigger for DELETE - removes teacher from teachers_list when deleted from Shikshaqmine
DROP TRIGGER IF EXISTS trigger_handle_shikshaqmine_delete ON public."Shikshaqmine";
CREATE TRIGGER trigger_handle_shikshaqmine_delete
  AFTER DELETE ON public."Shikshaqmine"
  FOR EACH ROW
  EXECUTE FUNCTION handle_shikshaqmine_delete();

-- Add comments
COMMENT ON FUNCTION sync_shikshaqmine_to_teachers_list() IS 
'Automatically syncs Shikshaqmine records to teachers_list when inserted or updated. Matches by slug or name.';

COMMENT ON FUNCTION handle_shikshaqmine_delete() IS 
'Handles deletion from Shikshaqmine. Deletes teacher from teachers_list and cascades to related data (upvotes, comments, likes).';

COMMENT ON TRIGGER trigger_sync_shikshaqmine_to_teachers_list ON public."Shikshaqmine" IS 
'Automatically syncs changes from Shikshaqmine to teachers_list in real-time.';

COMMENT ON TRIGGER trigger_handle_shikshaqmine_delete ON public."Shikshaqmine" IS 
'Handles deletion from Shikshaqmine. Removes teacher from teachers_list and all related data.';

