-- HOD desk, step 12: let HODs open the files of a student upload.
--
-- The paper-submissions bucket is private (an unreviewed upload from a
-- stranger). Today only admins may read it ("admins read submissions bucket").
-- A HOD reviewing uploads on the HOD desk needs a signed link to each file, so
-- this adds ONE read-only policy for HODs (is_hod() already includes admins).
-- Nothing is widened for anyone else; no write, update or delete is added.

drop policy if exists "hods read submissions bucket" on storage.objects;
create policy "hods read submissions bucket"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'paper-submissions' and public.is_hod());
