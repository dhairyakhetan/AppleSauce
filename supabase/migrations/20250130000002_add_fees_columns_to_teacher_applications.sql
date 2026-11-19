-- Migration: Add min_fees and max_fees columns to teacher_applications table
-- These columns store the teacher's fee range per month (optional)

ALTER TABLE public.teacher_applications
ADD COLUMN IF NOT EXISTS min_fees INTEGER,
ADD COLUMN IF NOT EXISTS max_fees INTEGER;

-- Add comments for documentation
COMMENT ON COLUMN public.teacher_applications.min_fees IS 'Minimum fees per month in rupees. Optional field for applicants to specify their fee range.';
COMMENT ON COLUMN public.teacher_applications.max_fees IS 'Maximum fees per month in rupees. Optional field for applicants to specify their fee range.';

