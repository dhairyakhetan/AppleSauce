-- Add performance indexes for Browse page optimization
-- These indexes will significantly speed up queries on BOTH free and pro tiers

-- Index on teachers_list for ordering and filtering
-- This speeds up ORDER BY is_featured, name queries
CREATE INDEX IF NOT EXISTS idx_teachers_list_featured_name 
  ON public.teachers_list(is_featured DESC NULLS LAST, name);

-- Index on teachers_list slug for joins with Shikshaqmine table
-- This speeds up JOIN operations
CREATE INDEX IF NOT EXISTS idx_teachers_list_slug 
  ON public.teachers_list(slug);

-- Index on Shikshaqmine Slug column (most important for filtering)
-- This is the primary key used for filtering, so this is critical
CREATE INDEX IF NOT EXISTS idx_shikshaqmine_slug 
  ON public."Shikshaqmine"("Slug");

-- Index on Shikshaqmine Subjects for faster subject filtering
-- Using GIN index for text search (better for LIKE/ILIKE queries)
CREATE INDEX IF NOT EXISTS idx_shikshaqmine_subjects 
  ON public."Shikshaqmine" USING gin(to_tsvector('english', "Subjects"));

-- Index on Shikshaqmine Classes Taught for Backend for faster class filtering
-- This column is used for numeric class matching
CREATE INDEX IF NOT EXISTS idx_shikshaqmine_classes_backend 
  ON public."Shikshaqmine"("Classes Taught for Backend");

-- Index on Shikshaqmine Area for faster area filtering
CREATE INDEX IF NOT EXISTS idx_shikshaqmine_area 
  ON public."Shikshaqmine"("Area");

-- Index on Shikshaqmine Mode of Teaching for faster mode filtering
CREATE INDEX IF NOT EXISTS idx_shikshaqmine_mode 
  ON public."Shikshaqmine"("Mode of Teaching");

-- Composite index for common filter combinations
-- This speeds up queries that filter by multiple columns
CREATE INDEX IF NOT EXISTS idx_shikshaqmine_filter_combo 
  ON public."Shikshaqmine"("Slug", "Subjects", "Classes Taught for Backend", "Area");

-- Index on teacher_upvotes for faster featured teacher queries
-- This speeds up COUNT queries for upvotes
CREATE INDEX IF NOT EXISTS idx_teacher_upvotes_teacher_id 
  ON public.teacher_upvotes(teacher_id);

-- Index on teacher_upvotes for counting (used in Index page)
-- This speeds up ORDER BY upvote_count queries
CREATE INDEX IF NOT EXISTS idx_teacher_upvotes_count 
  ON public.teacher_upvotes(teacher_id, created_at DESC);

-- Analyze tables to update query planner statistics
-- This helps PostgreSQL choose better query plans
ANALYZE public.teachers_list;
ANALYZE public."Shikshaqmine";
ANALYZE public.teacher_upvotes;
