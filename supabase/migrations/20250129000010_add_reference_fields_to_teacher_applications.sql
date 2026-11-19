-- Migration: Add reference fields to teacher_applications table
-- Add reference_name and reference_number fields for student references

ALTER TABLE public.teacher_applications
ADD COLUMN IF NOT EXISTS reference_name TEXT,
ADD COLUMN IF NOT EXISTS reference_number TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.teacher_applications.reference_name IS 'Name of the student who referred this teacher';
COMMENT ON COLUMN public.teacher_applications.reference_number IS 'Phone number of the student who referred this teacher';

