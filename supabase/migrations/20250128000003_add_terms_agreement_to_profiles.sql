-- Add terms_agreement column to profiles table
-- This stores whether the user has agreed to Terms and Privacy Policy

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS terms_agreement BOOLEAN DEFAULT false;

-- Add comment
COMMENT ON COLUMN public.profiles.terms_agreement IS 
'Indicates whether the user has agreed to the Terms and Privacy Policy to connect with teachers. Set to true when user checks the agreement checkbox during role selection.';

