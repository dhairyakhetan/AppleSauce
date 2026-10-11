-- Add "Sir/Ma'am?" column to teachers_list table
ALTER TABLE public.teachers_list 
ADD COLUMN IF NOT EXISTS "Sir/Ma'am?" TEXT;

-- Add a comment to explain the column
COMMENT ON COLUMN public.teachers_list."Sir/Ma'am?" IS 'Gender indicator: "Sir" for male teachers, "Ma''am" for female teachers';

-- Optional: Create an index if you'll be filtering by this column
-- CREATE INDEX IF NOT EXISTS idx_teachers_list_gender ON public.teachers_list("Sir/Ma'am?");

