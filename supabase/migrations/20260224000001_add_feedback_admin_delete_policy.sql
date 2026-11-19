-- Migration: Add RLS policy so admins can delete feedback
-- AdminFeedback page uses supabase client (anon key) to delete feedback; without this policy, deletes are blocked by RLS.

CREATE POLICY "Admins can delete feedback"
  ON public.feedback
  FOR DELETE
  USING (public.is_admin());

COMMENT ON POLICY "Admins can delete feedback" ON public.feedback IS
  'Allows admins to delete any feedback from the Admin Feedback page.';
