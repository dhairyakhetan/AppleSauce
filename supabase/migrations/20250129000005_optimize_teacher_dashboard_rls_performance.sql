-- Migration: Optimize teacher dashboard RLS policies for performance
-- Add indexes on email fields used in RLS policies to support 5000+ concurrent users
-- 
-- Problem: RLS policies use LOWER(TRIM()) on email fields, which prevents index usage
-- Solution: Add functional indexes on normalized email fields

-- Index on profiles.email for fast lookups in RLS policies
CREATE INDEX IF NOT EXISTS idx_profiles_email 
  ON public.profiles(email) 
  WHERE email IS NOT NULL;

-- Composite index on profiles.role and email for fast role filtering
-- This speeds up the EXISTS subquery in RLS policies
CREATE INDEX IF NOT EXISTS idx_profiles_role_email 
  ON public.profiles(role, email) 
  WHERE role = 'teacher' AND email IS NOT NULL;

-- Functional index on normalized Shikshaqmine email (for RLS policy)
-- This allows the LOWER(TRIM()) comparison in RLS policies to use an index
-- Critical for teacher dashboard performance at scale
CREATE INDEX IF NOT EXISTS idx_shikshaqmine_email_normalized 
  ON public."Shikshaqmine"(LOWER(TRIM("Email ID"))) 
  WHERE "Email ID" IS NOT NULL AND "Email ID" != '';

-- Functional index on normalized profiles email (for RLS policy)
-- This speeds up the email comparison in RLS policies
CREATE INDEX IF NOT EXISTS idx_profiles_email_normalized 
  ON public.profiles(LOWER(TRIM(email))) 
  WHERE role = 'teacher' AND email IS NOT NULL;

-- Analyze tables to update query planner statistics
-- This helps PostgreSQL choose better query plans
ANALYZE public.profiles;
ANALYZE public."Shikshaqmine";

-- Add comments for documentation
COMMENT ON INDEX idx_profiles_email IS 'Index on profiles.email for fast lookups in RLS policies';
COMMENT ON INDEX idx_profiles_role_email IS 'Composite index on role and email for fast teacher filtering in RLS policies';
COMMENT ON INDEX idx_shikshaqmine_email_normalized IS 'Functional index on normalized Shikshaqmine email for RLS policy performance';
COMMENT ON INDEX idx_profiles_email_normalized IS 'Functional index on normalized profiles email for RLS policy performance';

