-- paper-submissions: give the bucket the limits the form only promised
--
-- /submit-a-paper tells a sender "PDF or photos. Up to 10 files, 25MB each" and
-- enforces it in the browser (src/lib/submit-paper-files.ts). But the policy
-- "anyone can upload a submission" (20260829072445_paper_submissions.sql) lets
-- ANY caller, signed in or not, insert into this bucket without going through
-- that page, and the bucket was created with no file_size_limit and no
-- allowed_mime_types. So the limits were a courtesy, not a gate: anyone could
-- park an unlimited number of files of any type and size in our storage.
--
-- This sets the two limits Supabase Storage enforces itself, server-side, on
-- every upload to the bucket:
--
--   file_size_limit    26214400  = 25 * 1024 * 1024, MAX_BYTES in the form
--   allowed_mime_types the four types the form's <input accept> lists:
--                      application/pdf, image/png, image/jpeg, image/webp
--
-- Keep these two in step with MAX_BYTES / ACCEPTED_TYPES in
-- src/lib/submit-paper-files.ts; a test there reads this file to hold them to
-- it.
--
-- What this does NOT do: cap how MANY files one caller uploads (the "10 files"
-- is still a form rule) or rate-limit uploads. Storage policies cannot count
-- per caller without an identity to count against; anon has none. If abuse
-- shows up, the next step is an edge function in front of the upload, not a
-- bigger policy. Files already in the bucket are untouched; the limits apply to
-- uploads from now on.
--
-- Not applied by the commit that adds it. Idempotent: running it twice leaves
-- the same state. Rollback:
--   update storage.buckets
--      set file_size_limit = null, allowed_mime_types = null
--    where id = 'paper-submissions';

update storage.buckets
   set file_size_limit    = 26214400,
       allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
 where id = 'paper-submissions';
