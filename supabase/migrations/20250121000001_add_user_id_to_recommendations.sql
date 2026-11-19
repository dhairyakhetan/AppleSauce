-- Add user_id column to teacher_recommendations table if it doesn't exist
-- This migration is safe to run even if the column already exists

-- Check if column exists, if not add it
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'teacher_recommendations' 
    AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.teacher_recommendations 
    ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    
    -- Create index for faster queries
    CREATE INDEX IF NOT EXISTS teacher_recommendations_user_id_idx 
    ON public.teacher_recommendations(user_id);
  END IF;
END $$;

-- Update the INSERT policy to require authentication
DROP POLICY IF EXISTS "Anyone can submit teacher recommendations" ON public.teacher_recommendations;
DROP POLICY IF EXISTS "Authenticated users can submit teacher recommendations" ON public.teacher_recommendations;

CREATE POLICY "Authenticated users can submit teacher recommendations"
  ON public.teacher_recommendations
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

