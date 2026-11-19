-- Ensure teacher_upvote_stats view uses SECURITY INVOKER (not SECURITY DEFINER)
-- This ensures RLS policies are enforced based on the querying user, not the view creator
-- 
-- IMPORTANT: Views in PostgreSQL cannot have SECURITY DEFINER - only functions can.
-- Views always run with the querying user's permissions (SECURITY INVOKER).
-- If Supabase is showing this warning, it may be a false positive or the view needs to be recreated.

-- First, check if there are any dependent objects and handle them
DO $$
BEGIN
  -- Drop the view if it exists (CASCADE will handle dependencies)
  DROP VIEW IF EXISTS public.teacher_upvote_stats CASCADE;
  
  -- Wait a moment to ensure the drop is complete
  PERFORM pg_sleep(0.1);
END $$;

-- Recreate the view (views always use SECURITY INVOKER by default)
-- This ensures RLS policies on underlying tables are properly enforced
-- Using Supabase's explicit security_invoker syntax if supported, otherwise standard PostgreSQL
CREATE VIEW public.teacher_upvote_stats 
WITH (security_invoker = on) AS
SELECT 
  t.id AS teacher_id,
  t.name AS teacher_name,
  t.slug AS teacher_slug,
  COUNT(u.id) AS upvote_count
FROM public.teachers_list t
LEFT JOIN public.teacher_upvotes u ON t.id = u.teacher_id
GROUP BY t.id, t.name, t.slug
ORDER BY COUNT(u.id) DESC;

-- Grant access to the view
GRANT SELECT ON public.teacher_upvote_stats TO authenticated;
GRANT SELECT ON public.teacher_upvote_stats TO anon;

-- Revoke any potentially problematic permissions
REVOKE ALL ON public.teacher_upvote_stats FROM PUBLIC;

-- Re-grant only to authenticated and anon
GRANT SELECT ON public.teacher_upvote_stats TO authenticated;
GRANT SELECT ON public.teacher_upvote_stats TO anon;

-- Add comment explaining the security model
COMMENT ON VIEW public.teacher_upvote_stats IS 
'View showing upvote counts per teacher. Views always use SECURITY INVOKER (querying user permissions), ensuring RLS policies on underlying tables (teachers_list and teacher_upvotes) are properly enforced.';

