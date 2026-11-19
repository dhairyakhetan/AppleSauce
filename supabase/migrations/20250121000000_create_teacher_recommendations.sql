-- Create teacher_recommendations table to store teacher recommendations
CREATE TABLE IF NOT EXISTS public.teacher_recommendations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recommender_name TEXT NOT NULL,
  recommender_contact TEXT NOT NULL,
  teacher_name TEXT NOT NULL,
  teacher_contact TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'onboarded', 'rejected')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.teacher_recommendations ENABLE ROW LEVEL SECURITY;

-- Policy: Only authenticated users can insert recommendations
CREATE POLICY "Authenticated users can submit teacher recommendations"
  ON public.teacher_recommendations
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Policy: Only authenticated admin users can view recommendations
-- Note: You'll need to create an admin role or use service role key for viewing
-- For now, we'll allow authenticated users to view (you can restrict this further)
CREATE POLICY "Authenticated users can view recommendations"
  ON public.teacher_recommendations
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Policy: Authenticated users can update recommendations (for admin page)
-- You can restrict this further by checking for admin role
CREATE POLICY "Authenticated users can update recommendations"
  ON public.teacher_recommendations
  FOR UPDATE
  USING (auth.role() = 'authenticated');

-- Policy: Only service role can delete (for admin operations via dashboard)
-- Regular users cannot delete recommendations

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS teacher_recommendations_status_idx ON public.teacher_recommendations(status);
CREATE INDEX IF NOT EXISTS teacher_recommendations_created_at_idx ON public.teacher_recommendations(created_at DESC);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_teacher_recommendations_updated_at
  BEFORE UPDATE ON public.teacher_recommendations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

