-- Migration: Auto-compute Area field as union of Student's Home Areas and Tutor's Home Areas
-- The Area field will be automatically updated whenever STUDENT'S HOME IN THESE AREAS or TUTOR'S HOME IN THESE AREAS changes

-- Function to combine two comma-separated area strings and return unique areas
CREATE OR REPLACE FUNCTION combine_areas(
  student_areas TEXT,
  tutor_areas TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_result TEXT;
  v_area TEXT;
  v_areas_array TEXT[];
BEGIN
  v_areas_array := ARRAY[]::TEXT[];
  
  -- Add areas from student's home areas
  IF student_areas IS NOT NULL AND student_areas != '' THEN
    FOREACH v_area IN ARRAY string_to_array(student_areas, ',')
    LOOP
      v_area := TRIM(v_area);
      IF v_area != '' AND NOT (v_area = ANY(v_areas_array)) THEN
        v_areas_array := array_append(v_areas_array, v_area);
      END IF;
    END LOOP;
  END IF;
  
  -- Add areas from tutor's home areas
  IF tutor_areas IS NOT NULL AND tutor_areas != '' THEN
    FOREACH v_area IN ARRAY string_to_array(tutor_areas, ',')
    LOOP
      v_area := TRIM(v_area);
      IF v_area != '' AND NOT (v_area = ANY(v_areas_array)) THEN
        v_areas_array := array_append(v_areas_array, v_area);
      END IF;
    END LOOP;
  END IF;
  
  -- Sort and join with comma
  IF array_length(v_areas_array, 1) > 0 THEN
    SELECT array_to_string(ARRAY(SELECT unnest(v_areas_array) ORDER BY 1), ', ')
    INTO v_result;
  ELSE
    v_result := NULL;
  END IF;
  
  RETURN v_result;
END;
$$;

-- Function to auto-update Area field when student/tutor areas change
CREATE OR REPLACE FUNCTION auto_update_area_from_student_tutor_areas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_areas TEXT;
  v_tutor_areas TEXT;
  v_combined_area TEXT;
BEGIN
  -- Get the two area fields (exact column names as they exist in database)
  v_student_areas := NEW."STUDENT'S HOME IN THESE AREAS";
  v_tutor_areas := NEW."TUTOR'S HOME IN THESE AREAS";
  
  -- Combine the areas
  v_combined_area := combine_areas(v_student_areas, v_tutor_areas);
  
  -- Update the Area field
  NEW."Area" := v_combined_area;
  
  RETURN NEW;
END;
$$;

-- Create trigger to auto-update Area on INSERT or UPDATE
DROP TRIGGER IF EXISTS auto_update_area_trigger ON public."Shikshaqmine";
CREATE TRIGGER auto_update_area_trigger
  BEFORE INSERT OR UPDATE ON public."Shikshaqmine"
  FOR EACH ROW
  EXECUTE FUNCTION auto_update_area_from_student_tutor_areas();

-- Update existing records to compute Area from student/tutor areas
UPDATE public."Shikshaqmine"
SET "Area" = combine_areas(
  "STUDENT'S HOME IN THESE AREAS",
  "TUTOR'S HOME IN THESE AREAS"
)
WHERE "STUDENT'S HOME IN THESE AREAS" IS NOT NULL 
   OR "TUTOR'S HOME IN THESE AREAS" IS NOT NULL;

-- Add comments for documentation
COMMENT ON FUNCTION combine_areas(TEXT, TEXT) IS 'Combines two comma-separated area strings into a single unique, sorted comma-separated string';
COMMENT ON FUNCTION auto_update_area_from_student_tutor_areas() IS 'Automatically updates the Area field as a union of Student''s Home Areas and Tutor''s Home Areas whenever those fields change';

