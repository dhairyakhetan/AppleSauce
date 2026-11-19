-- Allow reading profiles for comment authors
-- This enables the comment section to display user names and info

-- Drop existing restrictive policy if it exists
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

-- Create new policy: Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Create new policy: Anyone can view profiles (needed for displaying comment author info)
-- This is safe because we only expose public info like name, school, grade
CREATE POLICY "Anyone can view profiles for comments"
  ON public.profiles FOR SELECT
  USING (true);

