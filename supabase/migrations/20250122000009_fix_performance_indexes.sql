-- Fix performance indexes - remove problematic ones
-- Since filtering is done in JavaScript (client-side), indexes on filter columns are useless
-- and can actually slow things down due to index maintenance overhead

-- Drop ALL indexes on filter columns (filtering happens in JS, not in DB)
DROP INDEX IF EXISTS idx_shikshaqmine_subjects;
DROP INDEX IF EXISTS idx_shikshaqmine_filter_combo;
DROP INDEX IF EXISTS idx_shikshaqmine_mode;
DROP INDEX IF EXISTS idx_shikshaqmine_classes_backend;
DROP INDEX IF EXISTS idx_shikshaqmine_area;

-- Keep ONLY indexes that actually help with database queries:

-- Index on teachers_list for ordering (CRITICAL - speeds up ORDER BY)
CREATE INDEX IF NOT EXISTS idx_teachers_list_featured_name 
  ON public.teachers_list(is_featured DESC NULLS LAST, name);

-- Index on teachers_list slug for joins (CRITICAL - speeds up joins)
CREATE INDEX IF NOT EXISTS idx_teachers_list_slug 
  ON public.teachers_list(slug);

-- Index on Shikshaqmine Slug column (CRITICAL - speeds up .in('Slug', chunk) queries)
-- This is the ONLY index needed for Shikshaqmine since we filter by Slug
CREATE INDEX IF NOT EXISTS idx_shikshaqmine_slug 
  ON public."Shikshaqmine"("Slug");

-- Index on teacher_upvotes (useful for featured teachers)
CREATE INDEX IF NOT EXISTS idx_teacher_upvotes_teacher_id 
  ON public.teacher_upvotes(teacher_id);

-- Re-analyze tables
ANALYZE public.teachers_list;
ANALYZE public."Shikshaqmine";
ANALYZE public.teacher_upvotes;

