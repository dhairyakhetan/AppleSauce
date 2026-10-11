-- Fix teacher_comments INSERT policy: allow non-anonymous (approved=true) and anonymous (approved=false)
-- The previous performance migration only allowed approved = false OR approved IS NULL,
-- which blocked authenticated users from posting non-anonymous reviews.

DROP POLICY IF EXISTS "Authenticated users can insert comments" ON public.teacher_comments;

CREATE POLICY "Authenticated users can insert comments"
  ON public.teacher_comments FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (
      (is_anonymous = false AND approved = true)
      OR
      (is_anonymous = true AND approved = false)
    )
  );

COMMENT ON POLICY "Authenticated users can insert comments" ON public.teacher_comments IS
  'Authenticated users can insert their own comments. Non-anonymous comments are approved immediately (approved=true); anonymous comments require review (approved=false).';
