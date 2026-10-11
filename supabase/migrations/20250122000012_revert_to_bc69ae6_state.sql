-- Revert database to match commit bc69ae6 state
-- This ensures indexes match what was present at that commit

-- Drop indexes that were added in 20250122000008 but removed in 20250122000009
-- (These should already be dropped if you ran 20250122000009, but ensuring they're gone)
DROP INDEX IF EXISTS idx_shikshaqmine_subjects;
DROP INDEX IF EXISTS idx_shikshaqmine_filter_combo;
DROP INDEX IF EXISTS idx_shikshaqmine_mode;
DROP INDEX IF EXISTS idx_shikshaqmine_classes_backend;
DROP INDEX IF EXISTS idx_shikshaqmine_area;
DROP INDEX IF EXISTS idx_teacher_upvotes_count;

-- Drop GIN indexes that were added after bc69ae6 (you've already done this, but ensuring)
DROP INDEX IF EXISTS idx_shikshaqmine_subjects_gin;
DROP INDEX IF EXISTS idx_shikshaqmine_area_gin;
DROP INDEX IF EXISTS idx_shikshaqmine_areas_filtering_gin;
DROP INDEX IF EXISTS idx_shikshaqmine_boards_gin;
DROP INDEX IF EXISTS idx_shikshaqmine_mode_btree;
DROP INDEX IF EXISTS idx_shikshaqmine_class_size_btree;

-- Ensure we have the correct indexes from 20250122000009_fix_performance_indexes.sql
-- (These should already exist, but ensuring they're created)

-- Index on teachers_list for ordering (CRITICAL - speeds up ORDER BY)
CREATE INDEX IF NOT EXISTS idx_teachers_list_featured_name 
  ON public.teachers_list(is_featured DESC NULLS LAST, name);

-- Index on teachers_list slug for joins (CRITICAL - speeds up joins)
CREATE INDEX IF NOT EXISTS idx_teachers_list_slug 
  ON public.teachers_list(slug);

-- Index on Shikshaqmine Slug column (CRITICAL - speeds up .in('Slug', chunk) queries)
CREATE INDEX IF NOT EXISTS idx_shikshaqmine_slug 
  ON public."Shikshaqmine"("Slug");

-- Index on teacher_upvotes (useful for featured teachers)
CREATE INDEX IF NOT EXISTS idx_teacher_upvotes_teacher_id 
  ON public.teacher_upvotes(teacher_id);

-- Re-analyze tables
ANALYZE public.teachers_list;
ANALYZE public."Shikshaqmine";
ANALYZE public.teacher_upvotes;

