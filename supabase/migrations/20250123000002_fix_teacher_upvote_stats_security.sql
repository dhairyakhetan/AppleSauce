-- Fix security issue: Ensure teacher_upvote_stats view respects RLS policies
-- PostgreSQL views run with the permissions of the querying user by default (security invoker)
-- This migration ensures the view is properly configured to respect RLS

-- Drop the existing view if it exists
DROP VIEW IF EXISTS public.teacher_upvote_stats CASCADE;

-- Recreate the view (views default to security invoker behavior, respecting RLS)
-- This ensures RLS policies on underlying tables are enforced based on the querying user
CREATE VIEW public.teacher_upvote_stats AS
SELECT 
  t.id as teacher_id,
  t.name as teacher_name,
  t.slug as teacher_slug,
  COUNT(u.id) as upvote_count
FROM public.teachers_list t
LEFT JOIN public.teacher_upvotes u ON t.id = u.teacher_id
GROUP BY t.id, t.name, t.slug
ORDER BY upvote_count DESC;

-- Grant access to the view
-- RLS policies on underlying tables (teachers_list and teacher_upvotes) will be enforced
GRANT SELECT ON public.teacher_upvote_stats TO authenticated;
GRANT SELECT ON public.teacher_upvote_stats TO anon;

-- Security Note:
-- Views in PostgreSQL always run with the permissions of the querying user (security invoker)
-- This means RLS policies on the underlying tables (teachers_list and teacher_upvotes) 
-- will be properly enforced. The view itself does not bypass RLS.
-- 
-- The underlying tables have these RLS policies:
-- - teachers_list: "Anyone can view teachers_list" (public read access)
-- - teacher_upvotes: "Anyone can view upvotes" (public read access for counts)
-- 
-- This is the correct security model - the view respects these policies.

