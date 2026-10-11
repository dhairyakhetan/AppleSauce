-- Create teacher_upvotes table
CREATE TABLE IF NOT EXISTS public.teacher_upvotes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID NOT NULL REFERENCES public.teachers_list(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(teacher_id, user_id) -- Prevent duplicate upvotes from same user
);

-- Enable RLS
ALTER TABLE public.teacher_upvotes ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view all upvotes (for displaying counts)
CREATE POLICY "Anyone can view upvotes"
  ON public.teacher_upvotes FOR SELECT
  USING (true);

-- Policy: Users can insert their own upvotes (only when signed in)
CREATE POLICY "Users can upvote teachers"
  ON public.teacher_upvotes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own upvotes (to remove upvote)
CREATE POLICY "Users can remove their upvotes"
  ON public.teacher_upvotes FOR DELETE
  USING (auth.uid() = user_id);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS teacher_upvotes_teacher_id_idx ON public.teacher_upvotes(teacher_id);
CREATE INDEX IF NOT EXISTS teacher_upvotes_user_id_idx ON public.teacher_upvotes(user_id);
CREATE INDEX IF NOT EXISTS teacher_upvotes_created_at_idx ON public.teacher_upvotes(created_at DESC);

-- Create a function to get upvote count for a teacher
CREATE OR REPLACE FUNCTION get_teacher_upvote_count(teacher_uuid UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.teacher_upvotes
  WHERE teacher_id = teacher_uuid;
$$;

-- Create a view for admin to see upvote counts easily
CREATE OR REPLACE VIEW public.teacher_upvote_stats AS
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
GRANT SELECT ON public.teacher_upvote_stats TO authenticated;
GRANT SELECT ON public.teacher_upvote_stats TO anon;

