-- Add approval columns to teacher_comments table
ALTER TABLE public.teacher_comments 
ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;

-- Create index for faster queries on approved status
CREATE INDEX IF NOT EXISTS teacher_comments_approved_idx ON public.teacher_comments(approved);
CREATE INDEX IF NOT EXISTS teacher_comments_approved_at_idx ON public.teacher_comments(approved_at DESC);

-- Function to prevent non-admins from changing approval status
CREATE OR REPLACE FUNCTION prevent_user_approval_change()
RETURNS TRIGGER AS $$
BEGIN
  -- If approval status is being changed, check if user is admin
  IF OLD.approved IS DISTINCT FROM NEW.approved THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.admins 
      WHERE admins.id = auth.uid()
    ) THEN
      -- User is not an admin, revert approval status to original
      NEW.approved := OLD.approved;
      NEW.approved_by := OLD.approved_by;
      NEW.approved_at := OLD.approved_at;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update the trigger to handle approved_at timestamp
CREATE OR REPLACE FUNCTION update_teacher_comments_approval()
RETURNS TRIGGER AS $$
BEGIN
  -- When approved is set to true, set approved_at and approved_by
  IF NEW.approved = true AND OLD.approved = false THEN
    NEW.approved_at = now();
    NEW.approved_by = auth.uid();
  END IF;
  
  -- When approved is set to false, clear approved_at and approved_by
  IF NEW.approved = false AND OLD.approved = true THEN
    NEW.approved_at = NULL;
    NEW.approved_by = NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers
-- First, prevent non-admins from changing approval status
DROP TRIGGER IF EXISTS prevent_user_approval_change_trigger ON public.teacher_comments;
CREATE TRIGGER prevent_user_approval_change_trigger
  BEFORE UPDATE ON public.teacher_comments
  FOR EACH ROW
  EXECUTE FUNCTION prevent_user_approval_change();

-- Then, track approval timestamp when status changes
DROP TRIGGER IF EXISTS update_teacher_comments_approval_trigger ON public.teacher_comments;
CREATE TRIGGER update_teacher_comments_approval_trigger
  BEFORE UPDATE ON public.teacher_comments
  FOR EACH ROW
  WHEN (OLD.approved IS DISTINCT FROM NEW.approved)
  EXECUTE FUNCTION update_teacher_comments_approval();

-- Drop existing policies that we'll replace
DROP POLICY IF EXISTS "Anyone can view comments" ON public.teacher_comments;
DROP POLICY IF EXISTS "Authenticated users can insert comments" ON public.teacher_comments;
DROP POLICY IF EXISTS "Users can update own comments" ON public.teacher_comments;
DROP POLICY IF EXISTS "Users can delete own comments" ON public.teacher_comments;

-- New RLS policies for comment approval system

-- Policy: Public can view approved comments
CREATE POLICY "Anyone can view approved comments"
  ON public.teacher_comments FOR SELECT
  USING (approved = true);

-- Policy: Users can view their own comments (including pending ones)
CREATE POLICY "Users can view own comments"
  ON public.teacher_comments FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Admins can view all comments
CREATE POLICY "Admins can view all comments"
  ON public.teacher_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.admins 
      WHERE admins.id = auth.uid()
    )
  );

-- Policy: Authenticated users can insert their own comments (always pending)
-- Note: The approved column defaults to false, but we explicitly check it
CREATE POLICY "Authenticated users can insert comments"
  ON public.teacher_comments FOR INSERT
  WITH CHECK (
    auth.uid() = user_id 
    AND (approved = false OR approved IS NULL)  -- New comments are always pending
  );

-- Policy: Users can update their own comments (but not approval status)
-- Note: We use a trigger function to prevent users from changing approval status
CREATE POLICY "Users can update own comments"
  ON public.teacher_comments FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Admins can update any comment (for approval/rejection)
CREATE POLICY "Admins can update all comments"
  ON public.teacher_comments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.admins 
      WHERE admins.id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admins 
      WHERE admins.id = auth.uid()
    )
  );

-- Policy: Users can delete their own comments
CREATE POLICY "Users can delete own comments"
  ON public.teacher_comments FOR DELETE
  USING (auth.uid() = user_id);

-- Policy: Admins can delete any comment
CREATE POLICY "Admins can delete any comment"
  ON public.teacher_comments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.admins 
      WHERE admins.id = auth.uid()
    )
  );

-- Function to check if user is admin (helper function)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.admins 
    WHERE admins.id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

