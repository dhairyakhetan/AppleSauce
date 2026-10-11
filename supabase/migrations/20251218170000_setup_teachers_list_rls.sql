-- Enable RLS on teachers_list if not already enabled
ALTER TABLE public.teachers_list ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists (to avoid conflicts)
DROP POLICY IF EXISTS "Anyone can view teachers_list" ON public.teachers_list;

-- Create public read access policy for teachers_list
CREATE POLICY "Anyone can view teachers_list" ON public.teachers_list FOR SELECT USING (true);

