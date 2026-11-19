-- Step 1: Add the "Sir/Ma'am?" column to teachers_list table
-- Run this FIRST
ALTER TABLE public.teachers_list 
ADD COLUMN IF NOT EXISTS "Sir/Ma'am?" TEXT;

-- Step 2: Verify the column was added (optional check)
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'teachers_list' AND column_name = 'Sir/Ma''am?';

-- Step 3: Update existing teachers based on their names
-- Update teachers with "Sir" in their name
UPDATE public.teachers_list 
SET "Sir/Ma'am?" = 'Sir' 
WHERE name ILIKE '%sir%' AND ("Sir/Ma'am?" IS NULL OR "Sir/Ma'am?" = '');

-- Update teachers with "Mr" in their name
UPDATE public.teachers_list 
SET "Sir/Ma'am?" = 'Sir' 
WHERE (name ILIKE '%mr%' OR name ILIKE '%mr.%') 
  AND ("Sir/Ma'am?" IS NULL OR "Sir/Ma'am?" = '');

-- Update remaining teachers to "Ma'am" (assuming they're female if no "Sir" or "Mr")
-- You may want to review this and update manually for accuracy
UPDATE public.teachers_list 
SET "Sir/Ma'am?" = 'Ma''am' 
WHERE "Sir/Ma'am?" IS NULL OR "Sir/Ma'am?" = '';

-- Step 4: Verify the updates (optional check)
SELECT name, "Sir/Ma'am?" 
FROM public.teachers_list 
ORDER BY name 
LIMIT 10;

