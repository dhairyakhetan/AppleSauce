-- Migration: Sync teachers_list with Shikshaqmine table
-- This ensures teachers_list stays in sync with Shikshaqmine (source of truth)
-- Updates all relevant columns and adds new teachers from Shikshaqmine
-- Matches teachers by name (case-insensitive)

-- Helper function to extract and normalize phone number
-- All phone numbers should be in format: 91 (2 digits country code) + 10 digits = 12 digits total
-- Example: +918777420147 or 918777420147 -> 918777420147
CREATE OR REPLACE FUNCTION extract_phone_from_link(link_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
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
  IF length(extracted_digits) > 12 AND extracted_digits LIKE '91%' THEN
    RETURN substring(extracted_digits, 1, 12);
  END IF;
  
  -- If it's 11 digits and starts with 91, might be missing a digit - return as is (might need review)
  IF length(extracted_digits) = 11 AND extracted_digits LIKE '91%' THEN
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

-- Step 1: Update existing teachers' data to match Shikshaqmine
-- This matches by name (case-insensitive) since slugs might have changed
-- The name column in Shikshaqmine is "Title"
UPDATE public.teachers_list tl
SET 
  name = COALESCE(s."Title", tl.name),
  slug = COALESCE(s."Slug", tl.slug),
  image_url = COALESCE(
    NULLIF(s."Hero Image", ''),
    tl.image_url
  ),
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

-- Step 2: Insert new teachers from Shikshaqmine that don't exist in teachers_list
-- Match by name to avoid duplicates
-- The name column in Shikshaqmine is "Title"
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

-- Step 3: Also update by slug for cases where slug exists and matches
-- This handles cases where slug was already correct but other data changed
UPDATE public.teachers_list tl
SET 
  name = COALESCE(
    (SELECT s."Title" FROM public."Shikshaqmine" s WHERE s."Slug" = tl.slug LIMIT 1),
    tl.name
  ),
  location = COALESCE(
    NULLIF((SELECT s."Area" FROM public."Shikshaqmine" s WHERE s."Slug" = tl.slug LIMIT 1), ''),
    NULLIF((SELECT s."LOCATION V2" FROM public."Shikshaqmine" s WHERE s."Slug" = tl.slug LIMIT 1), ''),
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

-- Step 4: Create a function to sync teachers_list from Shikshaqmine
-- This can be called periodically or manually to keep tables in sync
CREATE OR REPLACE FUNCTION sync_teachers_list_from_shikshaqmine()
RETURNS TABLE(
  updated_count INTEGER,
  inserted_count INTEGER,
  total_processed INTEGER
) 
LANGUAGE plpgsql
SECURITY DEFINER
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
      NULLIF(s."Location V2", ''),
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
    image_url = COALESCE(
      NULLIF((SELECT s."Hero Image" FROM public."Shikshaqmine" s WHERE s."Slug" = tl.slug LIMIT 1), ''),
      tl.image_url
    ),
    location = COALESCE(
      NULLIF((SELECT s."Area" FROM public."Shikshaqmine" s WHERE s."Slug" = tl.slug LIMIT 1), ''),
      NULLIF((SELECT s."LOCATION V2" FROM public."Shikshaqmine" s WHERE s."Slug" = tl.slug LIMIT 1), ''),
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

-- Grant execute permission to authenticated users (or restrict to admins only)
-- GRANT EXECUTE ON FUNCTION sync_teachers_list_from_shikshaqmine() TO authenticated;

-- Add comment
COMMENT ON FUNCTION sync_teachers_list_from_shikshaqmine() IS 
'Syncs teachers_list table with Shikshaqmine table. Updates slugs and adds new teachers. Returns counts of updated and inserted records.';
