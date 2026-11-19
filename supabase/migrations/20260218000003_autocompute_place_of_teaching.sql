-- Auto-compute "Place of Teaching" from "LOCATION V2" in Shikshaqmine
-- Mapping:
--   "TEACHER'S HOME TUTORING"       → "Teacher's place"
--   "STUDENT'S HOME TUTORING ONLY"  → "Student's Home"
--   "BOTH OPTIONS LISTED"           → "Teacher's place, Student's Home"

CREATE OR REPLACE FUNCTION public.compute_place_of_teaching()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Auto-compute "Place of Teaching" based on "LOCATION V2"
  IF NEW."LOCATION V2" = 'TEACHER''S HOME TUTORING' THEN
    NEW."Place of Teaching" := 'Teacher''s place';
  ELSIF NEW."LOCATION V2" = 'STUDENT''S HOME TUTORING ONLY' THEN
    NEW."Place of Teaching" := 'Student''s Home';
  ELSIF NEW."LOCATION V2" = 'BOTH OPTIONS LISTED' THEN
    NEW."Place of Teaching" := 'Teacher''s place, Student''s Home';
  ELSE
    NEW."Place of Teaching" := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_compute_place_of_teaching ON public."Shikshaqmine";

-- Create trigger: fires on INSERT or UPDATE of "LOCATION V2"
CREATE TRIGGER trigger_compute_place_of_teaching
  BEFORE INSERT OR UPDATE OF "LOCATION V2" ON public."Shikshaqmine"
  FOR EACH ROW
  EXECUTE FUNCTION public.compute_place_of_teaching();

-- Backfill existing rows based on current "LOCATION V2" values
UPDATE public."Shikshaqmine"
SET "Place of Teaching" = CASE
  WHEN "LOCATION V2" = 'TEACHER''S HOME TUTORING' THEN 'Teacher''s place'
  WHEN "LOCATION V2" = 'STUDENT''S HOME TUTORING ONLY' THEN 'Student''s Home'
  WHEN "LOCATION V2" = 'BOTH OPTIONS LISTED' THEN 'Teacher''s place, Student''s Home'
  ELSE NULL
END
WHERE "LOCATION V2" IS NOT NULL;

COMMENT ON FUNCTION public.compute_place_of_teaching() IS
'Auto-computes "Place of Teaching" from "LOCATION V2" column in Shikshaqmine table.';

