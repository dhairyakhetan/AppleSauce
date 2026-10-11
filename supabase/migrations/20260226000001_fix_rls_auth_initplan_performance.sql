-- Migration: Fix RLS auth initplan performance (Supabase lint: auth_rls_initplan)
-- Replace auth.uid() / auth.role() with (select auth.uid()) / (select auth.role())
-- so they are evaluated once per query (init plan) instead of per row.
-- See: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select

-- =============================================================================
-- 1. Update is_admin() so policies that use it benefit from init plan
--    Set search_path to avoid "role mutable search_path" security lint.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins
    WHERE admins.id = (SELECT auth.uid())
  );
$$;

-- =============================================================================
-- 2. profiles
-- =============================================================================
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = id);

-- =============================================================================
-- 3. liked_teachers
-- =============================================================================
DROP POLICY IF EXISTS "Users can view their own likes" ON public.liked_teachers;
CREATE POLICY "Users can view their own likes"
  ON public.liked_teachers FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own likes" ON public.liked_teachers;
CREATE POLICY "Users can insert their own likes"
  ON public.liked_teachers FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their own likes" ON public.liked_teachers;
CREATE POLICY "Users can delete their own likes"
  ON public.liked_teachers FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

-- =============================================================================
-- 4. teacher_recommendations
-- =============================================================================
DROP POLICY IF EXISTS "Authenticated users can submit teacher recommendations" ON public.teacher_recommendations;
CREATE POLICY "Authenticated users can submit teacher recommendations"
  ON public.teacher_recommendations FOR INSERT
  WITH CHECK ((SELECT auth.role()) = 'authenticated');

DROP POLICY IF EXISTS "Users can view own recommendations" ON public.teacher_recommendations;
CREATE POLICY "Users can view own recommendations"
  ON public.teacher_recommendations FOR SELECT
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND user_id IS NOT NULL
    AND (SELECT auth.uid()) = user_id
  );

-- =============================================================================
-- 5. admins
-- =============================================================================
DROP POLICY IF EXISTS "Users can check their own admin status" ON public.admins;
CREATE POLICY "Users can check their own admin status"
  ON public.admins FOR SELECT
  USING (id = (SELECT auth.uid()));

-- =============================================================================
-- 6. student_subjects
-- =============================================================================
DROP POLICY IF EXISTS "Students can view own subjects" ON public.student_subjects;
CREATE POLICY "Students can view own subjects"
  ON public.student_subjects FOR SELECT
  USING ((SELECT auth.uid()) = student_id);

DROP POLICY IF EXISTS "Students can insert own subjects" ON public.student_subjects;
CREATE POLICY "Students can insert own subjects"
  ON public.student_subjects FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = student_id);

DROP POLICY IF EXISTS "Students can delete own subjects" ON public.student_subjects;
CREATE POLICY "Students can delete own subjects"
  ON public.student_subjects FOR DELETE
  USING ((SELECT auth.uid()) = student_id);

-- =============================================================================
-- 7. guardian_student_subjects
-- =============================================================================
DROP POLICY IF EXISTS "Guardians can view own student subjects" ON public.guardian_student_subjects;
CREATE POLICY "Guardians can view own student subjects"
  ON public.guardian_student_subjects FOR SELECT
  USING ((SELECT auth.uid()) = guardian_id);

DROP POLICY IF EXISTS "Guardians can insert own student subjects" ON public.guardian_student_subjects;
CREATE POLICY "Guardians can insert own student subjects"
  ON public.guardian_student_subjects FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = guardian_id);

DROP POLICY IF EXISTS "Guardians can delete own student subjects" ON public.guardian_student_subjects;
CREATE POLICY "Guardians can delete own student subjects"
  ON public.guardian_student_subjects FOR DELETE
  USING ((SELECT auth.uid()) = guardian_id);

-- =============================================================================
-- 8. teacher_comments
-- =============================================================================
DROP POLICY IF EXISTS "Users can view own comments" ON public.teacher_comments;
CREATE POLICY "Users can view own comments"
  ON public.teacher_comments FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins can view all comments" ON public.teacher_comments;
CREATE POLICY "Admins can view all comments"
  ON public.teacher_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.admins
      WHERE admins.id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Authenticated users can insert comments" ON public.teacher_comments;
CREATE POLICY "Authenticated users can insert comments"
  ON public.teacher_comments FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (approved = false OR approved IS NULL)
  );

DROP POLICY IF EXISTS "Users can update own comments" ON public.teacher_comments;
CREATE POLICY "Users can update own comments"
  ON public.teacher_comments FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins can update all comments" ON public.teacher_comments;
CREATE POLICY "Admins can update all comments"
  ON public.teacher_comments FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = (SELECT auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Users can delete own comments" ON public.teacher_comments;
CREATE POLICY "Users can delete own comments"
  ON public.teacher_comments FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins can delete any comment" ON public.teacher_comments;
CREATE POLICY "Admins can delete any comment"
  ON public.teacher_comments FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = (SELECT auth.uid()))
  );

-- =============================================================================
-- 9. teacher_upvotes
-- =============================================================================
DROP POLICY IF EXISTS "Authenticated users can upvote teachers" ON public.teacher_upvotes;
CREATE POLICY "Authenticated users can upvote teachers"
  ON public.teacher_upvotes FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND (SELECT auth.uid()) = user_id
  );

DROP POLICY IF EXISTS "Users can remove their upvotes" ON public.teacher_upvotes;
CREATE POLICY "Users can remove their upvotes"
  ON public.teacher_upvotes FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

-- =============================================================================
-- 10. feedback
-- =============================================================================
DROP POLICY IF EXISTS "Admins can view all feedback" ON public.feedback;
CREATE POLICY "Admins can view all feedback"
  ON public.feedback FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.admins
      WHERE admins.id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can view their own feedback" ON public.feedback;
CREATE POLICY "Users can view their own feedback"
  ON public.feedback FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Anyone can submit feedback" ON public.feedback;
CREATE POLICY "Anyone can submit feedback"
  ON public.feedback FOR INSERT
  WITH CHECK (
    rating >= 1 AND rating <= 5
    AND (
      (is_guest = true AND user_id IS NULL)
      OR (is_guest = false AND user_id IS NOT NULL AND user_id = (SELECT auth.uid()))
    )
  );

-- =============================================================================
-- 11. student_teachers
-- =============================================================================
DROP POLICY IF EXISTS "Students can view their own teacher relationships" ON public.student_teachers;
CREATE POLICY "Students can view their own teacher relationships"
  ON public.student_teachers FOR SELECT
  USING ((SELECT auth.uid()) = student_id);

DROP POLICY IF EXISTS "Students can add their own teacher relationships" ON public.student_teachers;
CREATE POLICY "Students can add their own teacher relationships"
  ON public.student_teachers FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = student_id
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid())
      AND role = 'student'
    )
  );

DROP POLICY IF EXISTS "Students can delete their own teacher relationships" ON public.student_teachers;
CREATE POLICY "Students can delete their own teacher relationships"
  ON public.student_teachers FOR DELETE
  USING ((SELECT auth.uid()) = student_id);

-- =============================================================================
-- 12. Shikshaqmine (quoted identifier)
-- =============================================================================
DROP POLICY IF EXISTS "Teachers can view own data" ON public."Shikshaqmine";
CREATE POLICY "Teachers can view own data"
  ON public."Shikshaqmine" FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role = 'teacher'
        AND LOWER(TRIM(p.email)) = LOWER(TRIM("Shikshaqmine"."Email ID"))
        AND "Shikshaqmine"."Email ID" IS NOT NULL
        AND "Shikshaqmine"."Email ID" != ''
    )
  );

DROP POLICY IF EXISTS "Teachers can update own data" ON public."Shikshaqmine";
CREATE POLICY "Teachers can update own data"
  ON public."Shikshaqmine" FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role = 'teacher'
        AND LOWER(TRIM(p.email)) = LOWER(TRIM("Shikshaqmine"."Email ID"))
        AND "Shikshaqmine"."Email ID" IS NOT NULL
        AND "Shikshaqmine"."Email ID" != ''
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role = 'teacher'
        AND LOWER(TRIM(p.email)) = LOWER(TRIM("Shikshaqmine"."Email ID"))
        AND "Shikshaqmine"."Email ID" IS NOT NULL
        AND "Shikshaqmine"."Email ID" != ''
    )
  );

-- =============================================================================
-- 13. teacher_applications
-- =============================================================================
DROP POLICY IF EXISTS "Users can view own teacher applications" ON public.teacher_applications;
CREATE POLICY "Users can view own teacher applications"
  ON public.teacher_applications FOR SELECT
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND LOWER(TRIM(p.email)) = LOWER(TRIM(teacher_applications.email))
    )
  );
