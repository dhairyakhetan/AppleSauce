-- SQL to delete all profiles-related tables and data
-- Run this in Supabase SQL Editor to clean up

-- Drop tables in reverse order of dependencies (child tables first)
DROP TABLE IF EXISTS public.student_subjects CASCADE;
DROP TABLE IF EXISTS public.guardian_student_relationships CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- Drop functions if they exist
DROP FUNCTION IF EXISTS calculate_age_from_dob() CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- Note: This will permanently delete all profile data
-- Make sure you have a backup if needed before running this

