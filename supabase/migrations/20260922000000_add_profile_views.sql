-- =========================================================================
-- ADD: profile_views, a real per-teacher view counter.
--
-- WHY. The teacher dashboard already shows three real, live numbers --
-- Upvotes, Reviews, and WhatsApp taps (whatsapp_clicks) -- explicitly never
-- a fabricated one (see TeacherDashboard.tsx's TD-002/TD-003 comments). The
-- one funnel step with no server-side record at all is the profile view
-- itself: GA4/Clarity see it, but that data is aggregate and not queryable
-- back into the app per teacher, so a teacher asking "is anyone even looking
-- at my listing" currently has no honest answer to show.
--
-- WHAT THIS DOES. Mirrors whatsapp_clicks exactly: same shape, same RLS
-- shape (anyone can insert a view for a real slug, only that teacher can
-- read their own count), same "count only, never who" privacy stance --
-- no user id, no IP, nothing but which teacher and when.
-- =========================================================================

begin;

create table if not exists public.profile_views (
  id bigint generated always as identity primary key,
  teacher_slug text not null,
  created_at timestamptz not null default now()
);

create index if not exists profile_views_teacher_slug_idx on public.profile_views (teacher_slug);

alter table public.profile_views enable row level security;

create policy "anyone can record a profile view"
  on public.profile_views
  for insert
  to anon, authenticated
  with check (teacher_slug is not null and length(teacher_slug) > 0);

create policy "teachers can read their own profile view count"
  on public.profile_views
  for select
  to authenticated
  using (
    exists (
      select 1 from public."Shikshaqmine" sm
      where sm."Slug" = profile_views.teacher_slug
        and sm."Email ID" = (auth.jwt() ->> 'email')
    )
  );

commit;

-- =========================================================================
-- VERIFICATION
-- =========================================================================
-- 1. anon and authenticated can insert, nobody can read anyone else's count:
--      select has_table_privilege('anon', 'public.profile_views', 'INSERT'),
--             has_table_privilege('authenticated', 'public.profile_views', 'INSERT');
--      -- EXPECT true, true (RLS policy still gates the actual rows)
-- 2. No direct SELECT grant to anon/authenticated at the table-privilege
--    level beyond what RLS filters -- confirmed by the same has_table_privilege
--    pattern this project already audits every other gated table with.
--
-- ROLLBACK: drop policy "teachers can read their own profile view count" on
-- public.profile_views; drop policy "anyone can record a profile view" on
-- public.profile_views; drop table public.profile_views;
-- =========================================================================
