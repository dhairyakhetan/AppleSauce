-- Migration: Create function to generate unique slugs for teacher names
-- Ensures no duplicate slugs in Shikshaqmine table

CREATE OR REPLACE FUNCTION public.generate_unique_slug(name_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INTEGER := 0;
BEGIN
  -- Validate input
  IF name_text IS NULL OR TRIM(name_text) = '' THEN
    RAISE EXCEPTION 'Name cannot be empty';
  END IF;
  
  -- Generate base slug: lowercase, replace non-alphanumeric with hyphens
  base_slug := LOWER(REGEXP_REPLACE(TRIM(name_text), '[^a-zA-Z0-9]+', '-', 'g'));
  
  -- Remove leading/trailing hyphens
  base_slug := TRIM(BOTH '-' FROM base_slug);
  
  -- Ensure slug is not empty after processing
  IF base_slug = '' THEN
    base_slug := 'teacher';
  END IF;
  
  final_slug := base_slug;
  
  -- Check if slug exists, append number if needed
  WHILE EXISTS (
    SELECT 1 FROM public."Shikshaqmine" WHERE "Slug" = final_slug
  ) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
    
    -- Safety check: prevent infinite loop (max 1000 attempts)
    IF counter > 1000 THEN
      RAISE EXCEPTION 'Unable to generate unique slug after 1000 attempts';
    END IF;
  END LOOP;
  
  RETURN final_slug;
END;
$$;

-- Add comment for documentation
COMMENT ON FUNCTION public.generate_unique_slug(TEXT) IS 'Generates a unique slug from a teacher name. If the base slug exists, appends a number (e.g., john-doe-1, john-doe-2) until a unique slug is found.';

