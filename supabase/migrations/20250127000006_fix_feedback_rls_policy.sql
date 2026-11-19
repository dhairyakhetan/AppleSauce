-- Fix overly permissive RLS policy on feedback table
-- The current policy uses WITH CHECK (true) which is flagged as a security concern
-- We'll replace it with a more restrictive policy that still allows public feedback
-- but validates the data being inserted

-- Drop the existing overly permissive policy
DROP POLICY IF EXISTS "Anyone can submit feedback" ON public.feedback;

-- Create a new policy that allows feedback submission but validates the data
-- This policy:
-- 1. Allows both authenticated and anonymous users to submit feedback
-- 2. Validates that rating is between 1 and 5 (enforced by CHECK constraint, but good to be explicit)
-- 3. Ensures user_id matches auth.uid() if provided (prevents users from submitting as other users)
-- 4. Allows guest submissions (user_id can be NULL)
CREATE POLICY "Anyone can submit feedback" ON public.feedback
  FOR INSERT
  WITH CHECK (
    -- Rating must be between 1 and 5 (enforced by table constraint, but explicit here)
    rating >= 1 AND rating <= 5
    AND
    (
      -- Guest submission: is_guest must be true, user_id must be NULL
      (is_guest = true AND user_id IS NULL)
      OR
      -- Authenticated submission: is_guest must be false, user_id must match authenticated user
      (is_guest = false AND user_id IS NOT NULL AND user_id = auth.uid())
    )
  );

-- Add comment explaining the policy
COMMENT ON POLICY "Anyone can submit feedback" ON public.feedback IS 
'Allows both authenticated and anonymous users to submit feedback. Validates that rating is valid, user_id matches authenticated user if provided, and guest flag is consistent with user_id.';

