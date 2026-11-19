-- Add is_anonymous column to teacher_comments table if it doesn't exist
-- This migration is idempotent and safe to run multiple times

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'teacher_comments' 
    AND column_name = 'is_anonymous'
  ) THEN
    ALTER TABLE public.teacher_comments ADD COLUMN is_anonymous BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

