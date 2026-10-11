-- Comprehensive RLS Policies for all tables
-- This migration creates proper security policies for teachers_list, Shikshaqmine, and teacher_upvotes

-- Helper function to check if user is admin
-- Checks both admins table and profiles.role = 'admin'
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admins
    WHERE id = auth.uid()
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Helper function to check if user is teacher
CREATE OR REPLACE FUNCTION public.is_teacher()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND role = 'teacher'
  );
$$;

-- ============================================================================
-- TEACHERS_LIST TABLE POLICIES
-- ============================================================================

-- Ensure RLS is enabled
ALTER TABLE public.teachers_list ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can view teachers_list" ON public.teachers_list;
DROP POLICY IF EXISTS "Admins can insert teachers" ON public.teachers_list;
DROP POLICY IF EXISTS "Admins can update teachers" ON public.teachers_list;
DROP POLICY IF EXISTS "Admins can delete teachers" ON public.teachers_list;
DROP POLICY IF EXISTS "Teachers can update own profile" ON public.teachers_list;

-- Policy: Anyone can view teachers (public read access)
CREATE POLICY "Anyone can view teachers_list"
  ON public.teachers_list FOR SELECT
  USING (true);

-- Policy: Only admins can insert new teachers
CREATE POLICY "Admins can insert teachers"
  ON public.teachers_list FOR INSERT
  WITH CHECK (public.is_admin());

-- Policy: Admins can update any teacher
CREATE POLICY "Admins can update teachers"
  ON public.teachers_list FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Policy: Admins can delete teachers
CREATE POLICY "Admins can delete teachers"
  ON public.teachers_list FOR DELETE
  USING (public.is_admin());

-- Policy: Teachers can update their own profile (for future teacher dashboard)
-- This allows teachers to edit certain fields of their own profile
-- Note: This requires a way to link teachers_list.id to profiles.id
-- For now, we'll create a policy that can be enabled when teacher dashboard is ready
-- You'll need to add a user_id column to teachers_list or create a mapping table
-- CREATE POLICY "Teachers can update own profile"
--   ON public.teachers_list FOR UPDATE
--   USING (
--     public.is_teacher() AND 
--     EXISTS (
--       SELECT 1 FROM public.teacher_user_mapping 
--       WHERE teacher_id = teachers_list.id AND user_id = auth.uid()
--     )
--   )
--   WITH CHECK (
--     public.is_teacher() AND 
--     EXISTS (
--       SELECT 1 FROM public.teacher_user_mapping 
--       WHERE teacher_id = teachers_list.id AND user_id = auth.uid()
--     )
--   );

-- ============================================================================
-- SHIKSHAQMINE TABLE POLICIES
-- ============================================================================

-- Ensure RLS is enabled (if table exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'Shikshaqmine'
  ) THEN
    ALTER TABLE public."Shikshaqmine" ENABLE ROW LEVEL SECURITY;
    
    -- Drop existing policies if they exist
    DROP POLICY IF EXISTS "Anyone can view Shikshaqmine" ON public."Shikshaqmine";
    DROP POLICY IF EXISTS "Admins can insert Shikshaqmine" ON public."Shikshaqmine";
    DROP POLICY IF EXISTS "Admins can update Shikshaqmine" ON public."Shikshaqmine";
    DROP POLICY IF EXISTS "Admins can delete Shikshaqmine" ON public."Shikshaqmine";
    
    -- Policy: Anyone can view Shikshaqmine data (public read access)
    CREATE POLICY "Anyone can view Shikshaqmine"
      ON public."Shikshaqmine" FOR SELECT
      USING (true);
    
    -- Policy: Only admins can insert Shikshaqmine data
    CREATE POLICY "Admins can insert Shikshaqmine"
      ON public."Shikshaqmine" FOR INSERT
      WITH CHECK (public.is_admin());
    
    -- Policy: Only admins can update Shikshaqmine data
    CREATE POLICY "Admins can update Shikshaqmine"
      ON public."Shikshaqmine" FOR UPDATE
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
    
    -- Policy: Only admins can delete Shikshaqmine data
    CREATE POLICY "Admins can delete Shikshaqmine"
      ON public."Shikshaqmine" FOR DELETE
      USING (public.is_admin());
  END IF;
END $$;

-- ============================================================================
-- TEACHER_UPVOTES TABLE POLICIES (Enhance existing policies)
-- ============================================================================

-- Drop existing policies to recreate with better names
DROP POLICY IF EXISTS "Anyone can view upvotes" ON public.teacher_upvotes;
DROP POLICY IF EXISTS "Users can upvote teachers" ON public.teacher_upvotes;
DROP POLICY IF EXISTS "Users can remove their upvotes" ON public.teacher_upvotes;

-- Policy: Anyone can view upvotes (for displaying counts)
CREATE POLICY "Anyone can view upvotes"
  ON public.teacher_upvotes FOR SELECT
  USING (true);

-- Policy: Authenticated users can insert their own upvotes
CREATE POLICY "Authenticated users can upvote teachers"
  ON public.teacher_upvotes FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL AND 
    auth.uid() = user_id
  );

-- Policy: Users can delete their own upvotes
CREATE POLICY "Users can remove their upvotes"
  ON public.teacher_upvotes FOR DELETE
  USING (auth.uid() = user_id);

-- Policy: Admins can delete any upvote (for moderation)
CREATE POLICY "Admins can delete any upvote"
  ON public.teacher_upvotes FOR DELETE
  USING (public.is_admin());

-- ============================================================================
-- ADDITIONAL SECURITY: Prevent updates to teacher_upvotes
-- ============================================================================

-- Policy: No one can update upvotes (upvotes are immutable once created)
-- Users can only insert or delete
CREATE POLICY "No updates allowed on upvotes"
  ON public.teacher_upvotes FOR UPDATE
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- GRANTS FOR VIEWS
-- ============================================================================

-- Ensure teacher_upvote_stats view is accessible
GRANT SELECT ON public.teacher_upvote_stats TO authenticated;
GRANT SELECT ON public.teacher_upvote_stats TO anon;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON FUNCTION public.is_admin() IS 'Check if current user has admin role';
COMMENT ON FUNCTION public.is_teacher() IS 'Check if current user has teacher role';
COMMENT ON POLICY "Anyone can view teachers_list" ON public.teachers_list IS 'Public read access for teacher listings';
COMMENT ON POLICY "Admins can insert teachers" ON public.teachers_list IS 'Only admins can add new teachers';
COMMENT ON POLICY "Admins can update teachers" ON public.teachers_list IS 'Only admins can modify teacher data';
COMMENT ON POLICY "Admins can delete teachers" ON public.teachers_list IS 'Only admins can remove teachers';

