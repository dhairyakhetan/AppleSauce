-- 20261011170000: close the write holes on the public views (leak audit finding F1, 2026-10-11).
-- public_profiles and teacher_comments_public are simple updatable views owned by postgres (they bypass RLS on profiles and
-- teacher_comments) and had INSERT / UPDATE / DELETE / TRUNCATE granted to anon and authenticated. Anyone with the public anon
-- key could edit or delete a profile or an approved review through them. The app only reads these views.
-- Reads (SELECT) are unchanged. The four other views get the same treatment because they hold the same default write grants.

revoke insert, update, delete, truncate, references, trigger
  on public.public_profiles, public.teacher_comments_public, public.paper_read_stats,
     public.teachers_enriched, public.teacher_rating_stats, public.teacher_upvote_stats
  from anon, authenticated, public;
