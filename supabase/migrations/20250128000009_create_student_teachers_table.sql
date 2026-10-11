-- Create student_teachers table to track which students study with which teachers
-- This allows students to indicate they study with a specific teacher

CREATE TABLE IF NOT EXISTS public.student_teachers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.teachers_list(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(student_id, teacher_id) -- Prevent duplicate entries
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_student_teachers_student_id ON public.student_teachers(student_id);
CREATE INDEX IF NOT EXISTS idx_student_teachers_teacher_id ON public.student_teachers(teacher_id);

-- Enable RLS
ALTER TABLE public.student_teachers ENABLE ROW LEVEL SECURITY;

-- Policy: Students can view their own relationships
CREATE POLICY "Students can view their own teacher relationships"
  ON public.student_teachers
  FOR SELECT
  USING (auth.uid() = student_id);

-- Policy: Students can insert their own relationships
CREATE POLICY "Students can add their own teacher relationships"
  ON public.student_teachers
  FOR INSERT
  WITH CHECK (
    auth.uid() = student_id
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role = 'student'
    )
  );

-- Policy: Students can delete their own relationships
CREATE POLICY "Students can delete their own teacher relationships"
  ON public.student_teachers
  FOR DELETE
  USING (auth.uid() = student_id);

-- Policy: Anyone can view teacher relationships (for displaying count)
-- This allows showing "X students study with this teacher" publicly
CREATE POLICY "Anyone can view teacher relationships for display"
  ON public.student_teachers
  FOR SELECT
  USING (true);

-- Add comment
COMMENT ON TABLE public.student_teachers IS 
'Stores relationships between students and teachers. Allows students to indicate they study with a specific teacher.';

