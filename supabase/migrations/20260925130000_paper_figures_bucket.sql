-- A public bucket for bank_questions.figure images, mirroring the existing
-- `paper-files` bucket's shape exactly (public SELECT, admin-only write).
--
-- Figures used to live only as committed files in public/paper-figures/,
-- served straight from the deployed bundle. That does not scale past a
-- handful of imports: the 2026-09-25 Maths integration bundle alone is 2,062
-- figures, and every batch after it would keep growing a binary directory in
-- git and the Vercel deploy (the one deploy on this project nobody here can
-- read build logs for -- see CLAUDE.md). Moving figures to storage keeps the
-- deploy weight flat regardless of how many papers get imported.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('paper-figures', 'paper-figures', true, 2097152, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "Public can view paper figures" on storage.objects;
create policy "Public can view paper figures"
  on storage.objects for select
  using (bucket_id = 'paper-figures');

drop policy if exists "Admins can upload paper figures" on storage.objects;
create policy "Admins can upload paper figures"
  on storage.objects for insert
  with check (bucket_id = 'paper-figures' and is_admin());

drop policy if exists "Admins can update paper figures" on storage.objects;
create policy "Admins can update paper figures"
  on storage.objects for update
  using (bucket_id = 'paper-figures' and is_admin());

drop policy if exists "Admins can delete paper figures" on storage.objects;
create policy "Admins can delete paper figures"
  on storage.objects for delete
  using (bucket_id = 'paper-figures' and is_admin());
