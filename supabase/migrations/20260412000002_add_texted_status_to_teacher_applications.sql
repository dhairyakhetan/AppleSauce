-- Add texted_status column to teacher_applications for admin follow-up tracking.
-- Values: 'not_texted' (default), 'texted', 'follow_up'.

ALTER TABLE public.teacher_applications
  ADD COLUMN IF NOT EXISTS texted_status TEXT NOT NULL DEFAULT 'not_texted'
  CHECK (texted_status IN ('not_texted', 'texted', 'follow_up'));

COMMENT ON COLUMN public.teacher_applications.texted_status IS
  'Admin follow-up tracker: not_texted (default), texted, or follow_up';
