-- Create liked_teachers table to store user likes
CREATE TABLE IF NOT EXISTS public.liked_teachers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.teachers_list(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, teacher_id) -- Prevent duplicate likes
);

-- Enable RLS
ALTER TABLE public.liked_teachers ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own likes
CREATE POLICY "Users can view their own likes"
  ON public.liked_teachers
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own likes
CREATE POLICY "Users can insert their own likes"
  ON public.liked_teachers
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own likes
CREATE POLICY "Users can delete their own likes"
  ON public.liked_teachers
  FOR DELETE
  USING (auth.uid() = user_id);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS liked_teachers_user_id_idx ON public.liked_teachers(user_id);
CREATE INDEX IF NOT EXISTS liked_teachers_teacher_id_idx ON public.liked_teachers(teacher_id);

