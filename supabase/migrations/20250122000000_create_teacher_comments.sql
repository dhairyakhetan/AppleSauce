-- Create teacher_comments table to store comments on teacher profiles
CREATE TABLE IF NOT EXISTS public.teacher_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.teacher_comments ENABLE ROW LEVEL SECURITY;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS teacher_comments_teacher_id_idx ON public.teacher_comments(teacher_id);
CREATE INDEX IF NOT EXISTS teacher_comments_user_id_idx ON public.teacher_comments(user_id);
CREATE INDEX IF NOT EXISTS teacher_comments_created_at_idx ON public.teacher_comments(created_at DESC);

-- Policy: Anyone can view comments (public read access)
CREATE POLICY "Anyone can view comments"
  ON public.teacher_comments FOR SELECT
  USING (true);

-- Policy: Authenticated users can insert their own comments
CREATE POLICY "Authenticated users can insert comments"
  ON public.teacher_comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own comments
CREATE POLICY "Users can update own comments"
  ON public.teacher_comments FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own comments
CREATE POLICY "Users can delete own comments"
  ON public.teacher_comments FOR DELETE
  USING (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_teacher_comments_updated_at
  BEFORE UPDATE ON public.teacher_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

