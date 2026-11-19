-- Migration: teachers_list.location syncs from Shikshaqmine."Area" only (no LOCATION V2 fallback)
-- 1) One-off backfill: set location = Area for existing rows matched by slug.
-- 2) Trigger sync: sync_shikshaqmine_to_teachers_list() sets location from "Area" only.
-- 3) Batch sync: sync_teachers_list_from_shikshaqmine() sets location from "Area" only.

SET search_path = public;

-- ---------------------------------------------------------------------------
-- 1) One-off backfill: teachers_list.location = Shikshaqmine."Area" by slug
-- ---------------------------------------------------------------------------
UPDATE public.teachers_list tl
SET location = NULLIF(TRIM(s."Area"), '')
FROM public."Shikshaqmine" s
WHERE s."Slug" = tl.slug
  AND s."Slug" IS NOT NULL
  AND s."Slug" != '';

-- When Area is null or empty, clear location so it stays in sync
UPDATE public.teachers_list tl
SET location = NULL
FROM public."Shikshaqmine" s
WHERE s."Slug" = tl.slug
  AND s."Slug" IS NOT NULL
  AND s."Slug" != ''
  AND (s."Area" IS NULL OR TRIM(s."Area") = '');

-- ---------------------------------------------------------------------------
-- 2) Trigger: sync_shikshaqmine_to_teachers_list() — location from "Area" only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_shikshaqmine_to_teachers_list()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_number TEXT;
BEGIN
  IF NEW."Link" IS NOT NULL AND NEW."Link" != '' THEN
    v_phone_number := extract_phone_from_link(NEW."Link");
  ELSE
    v_phone_number := NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.teachers_list
    WHERE slug = NEW."Slug"
       OR (LOWER(TRIM(name)) = LOWER(TRIM(NEW."Title")) AND NEW."Title" IS NOT NULL AND NEW."Title" != '')
  ) THEN
    UPDATE public.teachers_list
    SET
      name = COALESCE(NEW."Title", teachers_list.name),
      slug = COALESCE(NEW."Slug", teachers_list.slug),
      image_url = COALESCE(NULLIF(NEW."Hero Image", ''), teachers_list.image_url),
      location = NULLIF(TRIM(NEW."Area"), ''),
      whatsapp_number = COALESCE(v_phone_number, NULLIF(NEW."Link", ''), teachers_list.whatsapp_number),
      subjects = COALESCE(NULLIF(NEW."Subjects", ''), teachers_list.subjects),
      classes = COALESCE(NULLIF(NEW."Classes Taught", ''), teachers_list.classes),
      "Sir/Ma'am?" = COALESCE(NULLIF(NEW."Sir/Ma'am?", ''), teachers_list."Sir/Ma'am?")
    WHERE slug = NEW."Slug"
       OR (LOWER(TRIM(name)) = LOWER(TRIM(NEW."Title")) AND NEW."Title" IS NOT NULL AND NEW."Title" != '');
  ELSE
    IF NEW."Title" IS NOT NULL AND NEW."Title" != '' AND NEW."Slug" IS NOT NULL AND NEW."Slug" != '' THEN
      INSERT INTO public.teachers_list (
        name, slug, image_url, bio, location, whatsapp_number, subjects, classes, "Sir/Ma'am?"
      )
      VALUES (
        NEW."Title",
        NEW."Slug",
        NULLIF(NEW."Hero Image", ''),
        NULL,
        NULLIF(TRIM(NEW."Area"), ''),
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

-- ---------------------------------------------------------------------------
-- 3) Batch sync: sync_teachers_list_from_shikshaqmine() — location from "Area" only
-- ---------------------------------------------------------------------------
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
  -- Update existing teachers by name
  UPDATE public.teachers_list tl
  SET
    name = COALESCE(s."Title", tl.name),
    slug = COALESCE(s."Slug", tl.slug),
    location = NULLIF(TRIM(s."Area"), ''),
    whatsapp_number = COALESCE(extract_phone_from_link(s."Link"), NULLIF(s."Link", ''), tl.whatsapp_number),
    subjects = COALESCE(NULLIF(s."Subjects", ''), tl.subjects),
    classes = COALESCE(NULLIF(s."Classes Taught", ''), tl.classes),
    "Sir/Ma'am?" = COALESCE(NULLIF(s."Sir/Ma'am?", ''), tl."Sir/Ma'am?")
  FROM public."Shikshaqmine" s
  WHERE LOWER(TRIM(tl.name)) = LOWER(TRIM(s."Title"))
    AND s."Title" IS NOT NULL
    AND s."Title" != '';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Insert new teachers
  INSERT INTO public.teachers_list (
    name, slug, image_url, bio, location, whatsapp_number, subjects, classes, "Sir/Ma'am?"
  )
  SELECT
    s."Title",
    COALESCE(NULLIF(s."Slug", ''), LOWER(REGEXP_REPLACE(s."Title", '[^a-zA-Z0-9]+', '-', 'g'))),
    NULLIF(s."Hero Image", ''),
    NULL,
    NULLIF(TRIM(s."Area"), ''),
    extract_phone_from_link(s."Link"),
    NULLIF(s."Subjects", ''),
    NULLIF(s."Classes Taught", ''),
    NULLIF(s."Sir/Ma'am?", '')
  FROM public."Shikshaqmine" s
  WHERE s."Title" IS NOT NULL
    AND s."Title" != ''
    AND NOT EXISTS (
      SELECT 1 FROM public.teachers_list tl
      WHERE LOWER(TRIM(tl.name)) = LOWER(TRIM(s."Title"))
    )
  ON CONFLICT (slug) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Update by slug: location from Area only
  UPDATE public.teachers_list tl
  SET
    name = COALESCE(
      (SELECT s."Title" FROM public."Shikshaqmine" s WHERE s."Slug" = tl.slug LIMIT 1),
      tl.name
    ),
    location = (SELECT NULLIF(TRIM(s."Area"), '') FROM public."Shikshaqmine" s WHERE s."Slug" = tl.slug LIMIT 1),
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

COMMENT ON COLUMN public.teachers_list.location IS 'Teacher area/locality; synced from Shikshaqmine."Area" only (by slug).';
COMMENT ON FUNCTION public.sync_shikshaqmine_to_teachers_list() IS 'Syncs Shikshaqmine to teachers_list on INSERT/UPDATE. location = Shikshaqmine."Area" only.';
COMMENT ON FUNCTION public.sync_teachers_list_from_shikshaqmine() IS 'Batch sync teachers_list from Shikshaqmine. location = Shikshaqmine."Area" only.';
