-- Fix RLS policy for admins table to allow users to check their own admin status
-- The previous policy was circular and wouldn't work

-- Drop the old policy
DROP POLICY IF EXISTS "Admins can view admins table" ON public.admins;

-- Create new policy that allows users to check if they are admins
CREATE POLICY "Users can check their own admin status"
  ON public.admins
  FOR SELECT
  USING (id = auth.uid());

