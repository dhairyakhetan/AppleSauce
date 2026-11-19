-- Create feedback table
CREATE TABLE IF NOT EXISTS public.feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  is_guest BOOLEAN DEFAULT false,
  guest_email TEXT, -- Optional email for guest users
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can insert feedback (for guest and logged-in users)
CREATE POLICY "Anyone can submit feedback" ON public.feedback
  FOR INSERT
  WITH CHECK (true);

-- Policy: Only admins can view all feedback
CREATE POLICY "Admins can view all feedback" ON public.feedback
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.admins
      WHERE admins.id = auth.uid()
    )
  );

-- Policy: Users can view their own feedback
CREATE POLICY "Users can view their own feedback" ON public.feedback
  FOR SELECT
  USING (auth.uid() = user_id);

-- Update timestamps trigger
CREATE TRIGGER update_feedback_updated_at
  BEFORE UPDATE ON public.feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON public.feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON public.feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_rating ON public.feedback(rating);

