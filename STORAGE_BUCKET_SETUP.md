# Supabase Storage Bucket Setup for Hero Images

## Overview

This guide explains how to set up the `hero-images` storage bucket in Supabase for admin image uploads.

---

## Step 1: Create the Bucket in Supabase Dashboard

1. Go to your [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Navigate to **Storage** (left sidebar)
4. Click **"New bucket"** button
5. Fill in the bucket details:
   - **Name:** `hero-images`
   - **Public bucket:** ✅ **Yes** (check this - images need to be publicly accessible)
   - **File size limit:** `5 MB` (or your preferred limit)
   - **Allowed MIME types:** `image/*` (optional, but recommended for security)
6. Click **"Create bucket"**

---

## Step 2: Run the Migration

After creating the bucket, run the migration file:
- `supabase/migrations/20250129000002_setup_hero_images_storage_bucket.sql`

This migration sets up the storage policies:
- ✅ Admins can upload images
- ✅ Admins can update images
- ✅ Admins can delete images
- ✅ Public can view images (for displaying on website)

---

## Step 3: Verify Setup

### Test Upload

1. Go to Admin Teachers page: `/admin/teachers`
2. Select a teacher
3. Click "Upload Image" button
4. Select an image file
5. Should upload successfully and show preview

### Test URL Option

1. The URL input option should still work
2. You can paste any image URL (from external sources)
3. Both upload and URL options are available

---

## Storage Policies

### Admin Access
- **Upload:** Only admins can upload images
- **Update:** Only admins can update images
- **Delete:** Only admins can delete images

### Public Access
- **View:** Anyone can view images (needed for displaying on website)

---

## File Structure

Images are stored with this naming pattern:
```
hero-images/{teacher_id}-{timestamp}.{extension}
```

Example:
```
hero-images/123-1704067200000.jpg
```

---

## Troubleshooting

### Error: "Bucket not found"
- Make sure you created the bucket in Supabase Dashboard
- Bucket name must be exactly: `hero-images`

### Error: "Permission denied"
- Check that you're logged in as an admin
- Verify the storage policies were created (run the migration)
- Check that your user ID is in the `admins` table

### Error: "File too large"
- Check the bucket's file size limit in Supabase Dashboard
- Default is usually 50MB, but you can set it lower

### Images not displaying
- Make sure the bucket is set to **Public**
- Check that the "Public can view hero images" policy exists
- Verify the image URL is correct

---

## Manual Setup (If Migration Fails)

If the migration doesn't work, you can set up policies manually:

1. Go to Supabase Dashboard → Storage → Policies
2. Select the `hero-images` bucket
3. Add these policies:

**Policy 1: Admins can upload**
- Policy name: "Admins can upload hero images"
- Allowed operation: INSERT
- Policy definition:
```sql
bucket_id = 'hero-images' AND
EXISTS (
  SELECT 1 FROM public.admins
  WHERE id = auth.uid()
)
```

**Policy 2: Admins can update**
- Policy name: "Admins can update hero images"
- Allowed operation: UPDATE
- Policy definition:
```sql
bucket_id = 'hero-images' AND
EXISTS (
  SELECT 1 FROM public.admins
  WHERE id = auth.uid()
)
```

**Policy 3: Admins can delete**
- Policy name: "Admins can delete hero images"
- Allowed operation: DELETE
- Policy definition:
```sql
bucket_id = 'hero-images' AND
EXISTS (
  SELECT 1 FROM public.admins
  WHERE id = auth.uid()
)
```

**Policy 4: Public can view**
- Policy name: "Public can view hero images"
- Allowed operation: SELECT
- Policy definition:
```sql
bucket_id = 'hero-images'
```

---

## Security Notes

✅ **Safe:**
- Bucket is public for reading (needed to display images)
- Only admins can upload/update/delete
- File size limits prevent abuse
- MIME type restrictions (if enabled) prevent non-image uploads

⚠️ **Consider:**
- Set appropriate file size limits
- Consider adding image optimization/compression
- Monitor storage usage

---

## Usage in Admin Panel

The admin panel supports both:
1. **File Upload** - Upload directly to Supabase Storage
2. **URL Input** - Paste an image URL from external sources

Both options are available in the Hero Image section of the admin teacher form.

