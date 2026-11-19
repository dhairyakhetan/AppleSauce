-- Migration: Set up hero-images storage bucket policies for admin and teacher image uploads
-- Note: The bucket must be created via Supabase Dashboard first
-- This migration creates the storage policies

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Admins can upload hero images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update hero images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete hero images" ON storage.objects;
DROP POLICY IF EXISTS "Teachers can upload hero images" ON storage.objects;
DROP POLICY IF EXISTS "Teachers can update hero images" ON storage.objects;
DROP POLICY IF EXISTS "Teachers can delete hero images" ON storage.objects;
DROP POLICY IF EXISTS "Public can view hero images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload application images" ON storage.objects;

-- Policy: Admins can upload images to hero-images bucket
CREATE POLICY "Admins can upload hero images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'hero-images' AND
  public.is_admin()
);

-- Policy: Admins can update images in hero-images bucket
CREATE POLICY "Admins can update hero images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'hero-images' AND
  public.is_admin()
);

-- Policy: Admins can delete images from hero-images bucket
CREATE POLICY "Admins can delete hero images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'hero-images' AND
  public.is_admin()
);

-- Policy: Teachers can upload images to hero-images bucket
-- Teachers can only upload images with their user ID in the filename
CREATE POLICY "Teachers can upload hero images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'hero-images' AND
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'teacher'
  )
  -- Ensure filename contains teacher's user ID for security
  AND (name LIKE auth.uid()::text || '-%' OR name LIKE '%/' || auth.uid()::text || '-%')
);

-- Policy: Teachers can update their own images in hero-images bucket
-- Teachers can only update images with their user ID in the filename
CREATE POLICY "Teachers can update hero images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'hero-images' AND
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'teacher'
  )
  AND (name LIKE auth.uid()::text || '-%' OR name LIKE '%/' || auth.uid()::text || '-%')
)
WITH CHECK (
  bucket_id = 'hero-images' AND
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'teacher'
  )
  AND (name LIKE auth.uid()::text || '-%' OR name LIKE '%/' || auth.uid()::text || '-%')
);

-- Policy: Teachers can delete their own images from hero-images bucket
-- Teachers can only delete images with their user ID in the filename
CREATE POLICY "Teachers can delete hero images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'hero-images' AND
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'teacher'
  )
  AND (name LIKE auth.uid()::text || '-%' OR name LIKE '%/' || auth.uid()::text || '-%')
);

-- Policy: Public can view images from hero-images bucket (for displaying on website)
CREATE POLICY "Public can view hero images"
ON storage.objects FOR SELECT
USING (bucket_id = 'hero-images');

-- Policy: Anyone can upload application images (for onboarding form)
-- Only allows files with "application-" prefix and image file extensions
CREATE POLICY "Anyone can upload application images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'hero-images' AND
  name LIKE 'application-%' AND
  (
    storage.extension(name) = 'png' OR
    storage.extension(name) = 'jpeg' OR
    storage.extension(name) = 'jpg' OR
    storage.extension(name) = 'webp' OR
    storage.extension(name) = 'gif'
  )
);

