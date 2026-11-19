-- Add guardian-specific fields to profiles table
-- This migration adds fields for guardian profile information and student details

-- Add columns if they don't exist
DO $$ 
BEGIN
  -- Guardian phone (already added in student migration, but add if not exists)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'phone'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN phone TEXT;
  END IF;

  -- Guardian address (already added in student migration, but add if not exists)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'address'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN address TEXT;
  END IF;

  -- Relationship to student
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'relationship_to_student'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN relationship_to_student TEXT CHECK (relationship_to_student IN ('parent', 'sister/brother', 'grandparent', 'other'));
  END IF;

  -- Student name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'student_name'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN student_name TEXT;
  END IF;

  -- Student date of birth
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'student_date_of_birth'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN student_date_of_birth DATE;
  END IF;

  -- Student age (calculated from DOB)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'student_age'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN student_age INTEGER;
  END IF;

  -- Student class/grade
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'student_grade'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN student_grade TEXT;
  END IF;

  -- Student school board
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'student_school_board'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN student_school_board TEXT;
  END IF;
END $$;

-- Create function to calculate student age from date of birth
CREATE OR REPLACE FUNCTION calculate_student_age_from_dob()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.student_date_of_birth IS NOT NULL THEN
    NEW.student_age := EXTRACT(YEAR FROM AGE(NEW.student_date_of_birth));
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists (for idempotency)
DROP TRIGGER IF EXISTS update_student_age_from_dob ON public.profiles;

-- Trigger to automatically calculate student age when DOB is set/updated
CREATE TRIGGER update_student_age_from_dob
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (NEW.student_date_of_birth IS NOT NULL)
  EXECUTE FUNCTION calculate_student_age_from_dob();

-- Create guardian_student_subjects table for many-to-many relationship
CREATE TABLE IF NOT EXISTS public.guardian_student_subjects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  guardian_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(guardian_id, subject_id)
);

-- Enable RLS
ALTER TABLE public.guardian_student_subjects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Guardians can view own student subjects" ON public.guardian_student_subjects;
DROP POLICY IF EXISTS "Guardians can insert own student subjects" ON public.guardian_student_subjects;
DROP POLICY IF EXISTS "Guardians can delete own student subjects" ON public.guardian_student_subjects;

-- Policy: Guardians can view their own student subject selections
CREATE POLICY "Guardians can view own student subjects"
  ON public.guardian_student_subjects FOR SELECT
  USING (auth.uid() = guardian_id);

-- Policy: Guardians can insert their own student subject selections
CREATE POLICY "Guardians can insert own student subjects"
  ON public.guardian_student_subjects FOR INSERT
  WITH CHECK (auth.uid() = guardian_id);

-- Policy: Guardians can delete their own student subject selections
CREATE POLICY "Guardians can delete own student subjects"
  ON public.guardian_student_subjects FOR DELETE
  USING (auth.uid() = guardian_id);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS guardian_student_subjects_guardian_id_idx ON public.guardian_student_subjects(guardian_id);
CREATE INDEX IF NOT EXISTS guardian_student_subjects_subject_id_idx ON public.guardian_student_subjects(subject_id);

