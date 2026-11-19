-- Migration: Update comment insert policy to allow approved=true for non-anonymous comments
-- Non-anonymous comments are approved immediately, only anonymous comments need review

-- Drop the existing insert policy
DROP POLICY IF EXISTS "Authenticated users can insert comments" ON public.teacher_comments;

-- New policy: Allow users to insert their own comments
-- - Non-anonymous comments can be inserted with approved = true (immediate approval)
-- - Anonymous comments must be inserted with approved = false (requires review)
CREATE POLICY "Authenticated users can insert comments"
  ON public.teacher_comments FOR INSERT
  WITH CHECK (
    auth.uid() = user_id 
    AND (
      -- Non-anonymous comments can be approved immediately
      (is_anonymous = false AND approved = true)
      OR
      -- Anonymous comments must be pending approval
      (is_anonymous = true AND approved = false)
    )
  );

-- Add comment for documentation
COMMENT ON POLICY "Authenticated users can insert comments" ON public.teacher_comments IS 
  'Allows authenticated users to insert their own comments. Non-anonymous comments are approved immediately (approved=true), anonymous comments require review (approved=false)';

