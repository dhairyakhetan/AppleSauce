-- Revert all changes after commit 35976ea
-- This migration removes:
-- 1. has_password column and related functions/triggers (from migrations 20250128000000 and 20250128000001)
-- 2. terms_agreement column (from migration 20250127000007)

-- Drop the check_has_password_by_email function if it exists
DROP FUNCTION IF EXISTS public.check_has_password_by_email(TEXT);

-- Drop the trigger that updates has_password on password change
DROP TRIGGER IF EXISTS on_auth_user_password_change ON auth.users;
DROP FUNCTION IF EXISTS public.update_has_password_on_password_change();

-- Drop the trigger that sets has_password on user creation
DROP TRIGGER IF EXISTS on_auth_user_created_with_password ON auth.users;
DROP FUNCTION IF EXISTS public.set_has_password_on_user_creation();

-- Remove the has_password column from profiles table
ALTER TABLE public.profiles DROP COLUMN IF EXISTS has_password;

-- Remove the terms_agreement column from profiles table
ALTER TABLE public.profiles DROP COLUMN IF EXISTS terms_agreement;

-- Note: This migration reverts the following changes:
-- 1. Removes has_password column from profiles table
-- 2. Removes update_has_password_on_password_change() function and trigger
-- 3. Removes set_has_password_on_user_creation() function and trigger
-- 4. Removes check_has_password_by_email() function
-- 5. Removes terms_agreement column from profiles table

