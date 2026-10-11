-- Migration: Create paper-files storage bucket for Past Papers PDF uploads
-- Public read (papers are free community resources), admin-only write

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('paper-files', 'paper-files', true, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public can view paper files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload paper files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update paper files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete paper files" ON storage.objects;

CREATE POLICY "Public can view paper files"
ON storage.objects FOR SELECT
USING (bucket_id = 'paper-files');

CREATE POLICY "Admins can upload paper files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'paper-files' AND
  public.is_admin()
);

CREATE POLICY "Admins can update paper files"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'paper-files' AND
  public.is_admin()
);

CREATE POLICY "Admins can delete paper files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'paper-files' AND
  public.is_admin()
);
