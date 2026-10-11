-- Check the current definition of teacher_upvote_stats view
-- This will show us how the view is actually defined in the database

-- Check view definition
SELECT 
  schemaname,
  viewname,
  definition
FROM pg_views
WHERE schemaname = 'public' 
  AND viewname = 'teacher_upvote_stats';

-- Check if there are any functions associated with the view that might have SECURITY DEFINER
SELECT 
  p.proname as function_name,
  p.prosecdef as is_security_definer,
  pg_get_functiondef(p.oid) as function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname LIKE '%teacher_upvote%';

