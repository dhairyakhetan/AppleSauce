-- Create admins table to store admin user IDs
CREATE TABLE IF NOT EXISTS public.admins (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- Policy: Users can check if they themselves are admins
-- This allows the admin check query to work
CREATE POLICY "Users can check their own admin status"
  ON public.admins
  FOR SELECT
  USING (id = auth.uid());

-- Policy: Only service role can insert/update/delete (via Supabase Dashboard)
-- Regular users cannot modify the admins table

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS admins_id_idx ON public.admins(id);

-- Note: To add an admin, use Supabase Dashboard or run:
-- INSERT INTO public.admins (id) VALUES ('user-uuid-here');

