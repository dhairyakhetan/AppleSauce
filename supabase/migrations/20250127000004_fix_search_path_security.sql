-- Fix search_path security issues for all functions
-- Functions without a fixed search_path are vulnerable to search path injection attacks
-- Setting search_path prevents malicious users from manipulating the schema search order

-- 1. Fix prevent_user_approval_change function
CREATE OR REPLACE FUNCTION public.prevent_user_approval_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If approval status is being changed, check if user is admin
  IF OLD.approved IS DISTINCT FROM NEW.approved THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.admins 
      WHERE admins.id = auth.uid()
    ) THEN
      -- User is not an admin, revert approval status to original
      NEW.approved := OLD.approved;
      NEW.approved_by := OLD.approved_by;
      NEW.approved_at := OLD.approved_at;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 2. Fix update_teacher_comments_approval function
CREATE OR REPLACE FUNCTION public.update_teacher_comments_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When approved is set to true, set approved_at and approved_by
  IF NEW.approved = true AND OLD.approved = false THEN
    NEW.approved_at = now();
    NEW.approved_by = auth.uid();
  END IF;
  
  -- When approved is set to false, clear approved_at and approved_by
  IF NEW.approved = false AND OLD.approved = true THEN
    NEW.approved_at = NULL;
    NEW.approved_by = NULL;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 3. Fix calculate_student_age_from_dob function
CREATE OR REPLACE FUNCTION public.calculate_student_age_from_dob()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.student_date_of_birth IS NOT NULL THEN
    NEW.student_age := EXTRACT(YEAR FROM AGE(NEW.student_date_of_birth));
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 4. Fix calculate_age_from_dob function
CREATE OR REPLACE FUNCTION public.calculate_age_from_dob()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.date_of_birth IS NOT NULL THEN
    NEW.age := EXTRACT(YEAR FROM AGE(NEW.date_of_birth));
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 5. Fix sync_shikshaqmine_to_teachers_list function
CREATE OR REPLACE FUNCTION public.sync_shikshaqmine_to_teachers_list()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- 6. Fix handle_shikshaqmine_delete function
CREATE OR REPLACE FUNCTION public.handle_shikshaqmine_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete from teachers_list when removed from Shikshaqmine
  -- This will cascade delete related data (upvotes, comments, likes) due to foreign key constraints
  DELETE FROM public.teachers_list WHERE slug = OLD."Slug";
  
  RETURN OLD;
END;
$$;

-- 7. Fix extract_phone_from_link function
CREATE OR REPLACE FUNCTION public.extract_phone_from_link(link_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  extracted_digits TEXT;
BEGIN
  IF link_text IS NULL OR link_text = '' THEN
    RETURN NULL;
  END IF;
  
  -- Extract all digits from the input (removes +, spaces, dashes, etc.)
  extracted_digits := regexp_replace(link_text, '[^0-9]', '', 'g');
  
  IF extracted_digits IS NULL OR extracted_digits = '' THEN
    RETURN NULL;
  END IF;
  
  -- Normalize to 12 digits: 91 (2 digits country code) + 10 digits
  -- If it's 10 digits, add 91 prefix
  IF length(extracted_digits) = 10 THEN
    RETURN '91' || extracted_digits;
  END IF;
  
  -- If it's 12 digits and starts with 91, return as is (correct format)
  IF length(extracted_digits) = 12 AND extracted_digits LIKE '91%' THEN
    RETURN extracted_digits;
  END IF;
  
  -- If it's more than 12 digits and starts with 91, extract first 12 digits (91 + 10)
  IF length(extracted_digits) >= 12 AND extracted_digits LIKE '91%' THEN
    RETURN substring(extracted_digits, 1, 12);
  END IF;
  
  -- If it's 11 digits but doesn't start with 91, assume it's missing country code
  -- This shouldn't happen for Indian numbers, but handle it anyway
  IF length(extracted_digits) = 11 AND extracted_digits NOT LIKE '91%' THEN
    -- Return as is (might be a different format)
    RETURN extracted_digits;
  END IF;
  
  -- If it's less than 10 digits, return NULL (invalid)
  IF length(extracted_digits) < 10 THEN
    RETURN NULL;
  END IF;
  
  -- Default: return extracted digits (might need manual review)
  RETURN extracted_digits;
END;
$$;

-- 8. Fix sync_teachers_list_from_shikshaqmine function
CREATE OR REPLACE FUNCTION public.sync_teachers_list_from_shikshaqmine()
RETURNS TABLE(
  updated_count INTEGER,
  inserted_count INTEGER,
  total_processed INTEGER
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER := 0;
  v_inserted INTEGER := 0;
  v_total INTEGER := 0;
BEGIN
  -- Update existing teachers by name (using "Title" column)
  UPDATE public.teachers_list tl
  SET 
    name = COALESCE(s."Title", tl.name),
    slug = COALESCE(s."Slug", tl.slug),
    location = COALESCE(
      NULLIF(s."Area", ''),
      NULLIF(s."LOCATION V2", ''),
      tl.location
    ),
    whatsapp_number = COALESCE(
      extract_phone_from_link(s."Link"),
      NULLIF(s."Link", ''),
      tl.whatsapp_number
    ),
    subjects = COALESCE(
      NULLIF(s."Subjects", ''),
      tl.subjects
    ),
    classes = COALESCE(
      NULLIF(s."Classes Taught", ''),
      tl.classes
    ),
    "Sir/Ma'am?" = COALESCE(
      NULLIF(s."Sir/Ma'am?", ''),
      tl."Sir/Ma'am?"
    )
  FROM public."Shikshaqmine" s
  WHERE LOWER(TRIM(tl.name)) = LOWER(TRIM(s."Title"))
    AND s."Title" IS NOT NULL
    AND s."Title" != '';
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  
  -- Insert new teachers
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
  SELECT 
    s."Title" as name,
    COALESCE(NULLIF(s."Slug", ''), LOWER(REGEXP_REPLACE(s."Title", '[^a-zA-Z0-9]+', '-', 'g'))) as slug,
    NULLIF(s."Hero Image", '') as image_url,
    NULL as bio,
    COALESCE(
      NULLIF(s."Area", ''),
      NULLIF(s."LOCATION V2", '')
    ) as location,
    extract_phone_from_link(s."Link") as whatsapp_number,
    NULLIF(s."Subjects", '') as subjects,
    NULLIF(s."Classes Taught", '') as classes,
    NULLIF(s."Sir/Ma'am?", '') as "Sir/Ma'am?"
  FROM public."Shikshaqmine" s
  WHERE s."Title" IS NOT NULL
    AND s."Title" != ''
    AND NOT EXISTS (
      SELECT 1 FROM public.teachers_list tl 
      WHERE LOWER(TRIM(tl.name)) = LOWER(TRIM(s."Title"))
    )
  ON CONFLICT (slug) DO NOTHING;
  
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  
  -- Also update by slug
  UPDATE public.teachers_list tl
  SET 
    name = COALESCE(
      (SELECT s."Title" FROM public."Shikshaqmine" s WHERE s."Slug" = tl.slug LIMIT 1),
      tl.name
    ),
    location = COALESCE(
      NULLIF((SELECT s."Area" FROM public."Shikshaqmine" s WHERE s."Slug" = tl.slug LIMIT 1), ''),
      NULLIF((SELECT s."LOCATION V2" FROM public."Shikshaqmine" s WHERE s."Slug" = tl.slug LIMIT 1), ''),
      tl.location
    ),
    whatsapp_number = COALESCE(
      extract_phone_from_link((SELECT s."Link" FROM public."Shikshaqmine" s WHERE s."Slug" = tl.slug LIMIT 1)),
      NULLIF((SELECT s."Link" FROM public."Shikshaqmine" s WHERE s."Slug" = tl.slug LIMIT 1), ''),
      tl.whatsapp_number
    ),
    subjects = COALESCE(
      NULLIF((SELECT s."Subjects" FROM public."Shikshaqmine" s WHERE s."Slug" = tl.slug LIMIT 1), ''),
      tl.subjects
    ),
    classes = COALESCE(
      NULLIF((SELECT s."Classes Taught" FROM public."Shikshaqmine" s WHERE s."Slug" = tl.slug LIMIT 1), ''),
      tl.classes
    ),
    "Sir/Ma'am?" = COALESCE(
      NULLIF((SELECT s."Sir/Ma'am?" FROM public."Shikshaqmine" s WHERE s."Slug" = tl.slug LIMIT 1), ''),
      tl."Sir/Ma'am?"
    )
  WHERE EXISTS (
    SELECT 1 FROM public."Shikshaqmine" s 
    WHERE s."Slug" = tl.slug
      AND s."Slug" IS NOT NULL
      AND s."Slug" != ''
  );
  
  v_total := v_updated + v_inserted;
  
  RETURN QUERY SELECT v_updated, v_inserted, v_total;
END;
$$;

-- 9. Fix update_page_content_updated_at function
CREATE OR REPLACE FUNCTION public.update_page_content_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 10. Fix update_updated_at_column function (if it doesn't already have search_path)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 11. Fix is_admin function
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admins
    WHERE id = auth.uid()
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- 12. Fix is_teacher function
CREATE OR REPLACE FUNCTION public.is_teacher()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND role = 'teacher'
  );
$$;

-- 13. Fix get_teacher_upvote_count function
CREATE OR REPLACE FUNCTION public.get_teacher_upvote_count(teacher_uuid uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(COUNT(*)::INTEGER, 0)
  FROM public.teacher_upvotes
  WHERE teacher_id = teacher_uuid;
$$;

-- Add comments explaining the security fixes
COMMENT ON FUNCTION public.prevent_user_approval_change() IS 
'Prevents non-admin users from changing comment approval status. Uses SET search_path = public to prevent search path injection attacks.';

COMMENT ON FUNCTION public.update_teacher_comments_approval() IS 
'Tracks approval timestamp when comment approval status changes. Uses SET search_path = public to prevent search path injection attacks.';

COMMENT ON FUNCTION public.calculate_student_age_from_dob() IS 
'Automatically calculates student age from date of birth. Uses SET search_path = public to prevent search path injection attacks.';

COMMENT ON FUNCTION public.calculate_age_from_dob() IS 
'Automatically calculates age from date of birth. Uses SET search_path = public to prevent search path injection attacks.';

COMMENT ON FUNCTION public.sync_shikshaqmine_to_teachers_list() IS 
'Automatically syncs Shikshaqmine records to teachers_list when inserted or updated. Uses SET search_path = public to prevent search path injection attacks.';

COMMENT ON FUNCTION public.handle_shikshaqmine_delete() IS 
'Handles deletion from Shikshaqmine. Deletes teacher from teachers_list. Uses SET search_path = public to prevent search path injection attacks.';

COMMENT ON FUNCTION public.extract_phone_from_link(link_text TEXT) IS 
'Extracts and normalizes phone numbers from WhatsApp links. Uses SET search_path = public to prevent search path injection attacks.';

COMMENT ON FUNCTION public.sync_teachers_list_from_shikshaqmine() IS 
'Syncs teachers_list table with Shikshaqmine table. Uses SET search_path = public to prevent search path injection attacks.';

COMMENT ON FUNCTION public.update_page_content_updated_at() IS 
'Auto-updates updated_at timestamp for page_content. Uses SET search_path = public to prevent search path injection attacks.';

COMMENT ON FUNCTION public.update_updated_at_column() IS 
'Auto-updates updated_at timestamp. Uses SET search_path = public to prevent search path injection attacks.';

COMMENT ON FUNCTION public.is_admin() IS 
'Checks if current user is an admin. Uses SET search_path = public to prevent search path injection attacks.';

COMMENT ON FUNCTION public.is_teacher() IS 
'Checks if current user is a teacher. Uses SET search_path = public to prevent search path injection attacks.';

COMMENT ON FUNCTION public.get_teacher_upvote_count(uuid) IS 
'Returns the upvote count for a teacher. Uses SET search_path = public to prevent search path injection attacks.';

