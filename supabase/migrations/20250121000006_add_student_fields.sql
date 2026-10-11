-- Add student-specific fields to profiles table
-- This migration adds fields for student profile information

-- Add columns if they don't exist
DO $$ 
BEGIN
  -- Phone number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'phone'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN phone TEXT;
  END IF;

  -- Address
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'address'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN address TEXT;
  END IF;

  -- Date of birth
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'date_of_birth'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN date_of_birth DATE;
  END IF;

  -- Age (calculated from DOB)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'age'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN age INTEGER;
  END IF;

  -- School/College
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'school_college'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN school_college TEXT;
  END IF;

  -- Grade
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'grade'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN grade TEXT;
  END IF;

  -- School Board
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'school_board'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN school_board TEXT;
  END IF;

  -- Guardian Email
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'guardian_email'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN guardian_email TEXT;
  END IF;

  -- Full name (denormalized from auth.users)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'full_name'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN full_name TEXT;
  END IF;

  -- Email (denormalized from auth.users)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'email'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN email TEXT;
  END IF;
END $$;

-- Create function to calculate age from date of birth
CREATE OR REPLACE FUNCTION calculate_age_from_dob()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.date_of_birth IS NOT NULL THEN
    NEW.age := EXTRACT(YEAR FROM AGE(NEW.date_of_birth));
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists (for idempotency)
DROP TRIGGER IF EXISTS update_age_from_dob ON public.profiles;

-- Trigger to automatically calculate age when DOB is set/updated
CREATE TRIGGER update_age_from_dob
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (NEW.date_of_birth IS NOT NULL)
  EXECUTE FUNCTION calculate_age_from_dob();

-- Create student_subjects table for many-to-many relationship
CREATE TABLE IF NOT EXISTS public.student_subjects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(student_id, subject_id)
);

-- Enable RLS
ALTER TABLE public.student_subjects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Students can view own subjects" ON public.student_subjects;
DROP POLICY IF EXISTS "Students can insert own subjects" ON public.student_subjects;
DROP POLICY IF EXISTS "Students can delete own subjects" ON public.student_subjects;

-- Policy: Students can view their own subject selections
CREATE POLICY "Students can view own subjects"
  ON public.student_subjects FOR SELECT
  USING (auth.uid() = student_id);

-- Policy: Students can insert their own subject selections
CREATE POLICY "Students can insert own subjects"
  ON public.student_subjects FOR INSERT
  WITH CHECK (auth.uid() = student_id);

-- Policy: Students can delete their own subject selections
CREATE POLICY "Students can delete own subjects"
  ON public.student_subjects FOR DELETE
  USING (auth.uid() = student_id);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS student_subjects_student_id_idx ON public.student_subjects(student_id);
CREATE INDEX IF NOT EXISTS student_subjects_subject_id_idx ON public.student_subjects(subject_id);

