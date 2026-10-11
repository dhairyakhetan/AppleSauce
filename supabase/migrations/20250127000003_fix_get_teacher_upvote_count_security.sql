-- Drop the existing function with SECURITY DEFINER (security risk)
DROP FUNCTION IF EXISTS public.get_teacher_upvote_count(uuid) CASCADE;

-- Create a better, more secure version with SECURITY INVOKER
-- This ensures RLS policies are enforced based on the querying user's permissions
CREATE OR REPLACE FUNCTION public.get_teacher_upvote_count(teacher_uuid uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER  -- Runs with querying user's permissions, respects RLS
AS $$
  SELECT COALESCE(COUNT(*)::INTEGER, 0)
  FROM public.teacher_upvotes
  WHERE teacher_id = teacher_uuid;
$$;

-- Grant execute permission to authenticated and anon users
GRANT EXECUTE ON FUNCTION public.get_teacher_upvote_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_teacher_upvote_count(uuid) TO anon;

-- Revoke from public to be explicit
REVOKE ALL ON FUNCTION public.get_teacher_upvote_count(uuid) FROM PUBLIC;

-- Re-grant to specific roles
GRANT EXECUTE ON FUNCTION public.get_teacher_upvote_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_teacher_upvote_count(uuid) TO anon;

-- Add comment explaining the security model
COMMENT ON FUNCTION public.get_teacher_upvote_count(uuid) IS 
'Returns the upvote count for a teacher. Uses SECURITY INVOKER to ensure RLS policies on teacher_upvotes table are enforced based on the querying user. Returns 0 if no upvotes exist.';

