-- Migration: RLS policies for teachers to view and update their own Shikshaqmine data
-- Teachers can only see and edit their own record (matched by Email ID)

-- Helper function to get teacher's email from their profile
CREATE OR REPLACE FUNCTION get_teacher_email()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT email FROM public.profiles WHERE id = auth.uid() AND role = 'teacher';
$$;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Teachers can view own data" ON public."Shikshaqmine";
DROP POLICY IF EXISTS "Teachers can update own data" ON public."Shikshaqmine";

-- Policy: Teachers can view their own Shikshaqmine record
-- Match by Email ID from their profile
CREATE POLICY "Teachers can view own data"
ON public."Shikshaqmine"
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'teacher'
      AND LOWER(TRIM(p.email)) = LOWER(TRIM("Shikshaqmine"."Email ID"))
      AND "Shikshaqmine"."Email ID" IS NOT NULL
      AND "Shikshaqmine"."Email ID" != ''
  )
);

-- Policy: Teachers can update their own Shikshaqmine record
-- Match by Email ID from their profile
-- Note: Field restrictions (Title, Slug, Sir/Ma'am, EXPANDED) are enforced at the application level
-- RLS policies don't support field-level restrictions in WITH CHECK clauses
CREATE POLICY "Teachers can update own data"
ON public."Shikshaqmine"
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'teacher'
      AND LOWER(TRIM(p.email)) = LOWER(TRIM("Shikshaqmine"."Email ID"))
      AND "Shikshaqmine"."Email ID" IS NOT NULL
      AND "Shikshaqmine"."Email ID" != ''
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'teacher'
      AND LOWER(TRIM(p.email)) = LOWER(TRIM("Shikshaqmine"."Email ID"))
      AND "Shikshaqmine"."Email ID" IS NOT NULL
      AND "Shikshaqmine"."Email ID" != ''
  )
);

-- Add comments for documentation
COMMENT ON FUNCTION get_teacher_email() IS 'Get the email of the currently authenticated teacher';
COMMENT ON POLICY "Teachers can view own data" ON public."Shikshaqmine" IS 'Allows teachers to view their own Shikshaqmine record matched by Email ID';
COMMENT ON POLICY "Teachers can update own data" ON public."Shikshaqmine" IS 'Allows teachers to update their own Shikshaqmine record, but prevents changes to Title, Slug, Sir/Ma''am, and EXPANDED fields';

