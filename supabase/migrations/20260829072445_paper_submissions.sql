-- Paper submissions: the backend for /submit-a-paper
--
-- The page uploads the pages to a storage bucket and writes one row per
-- submission. Until this migration ran, both calls were refused by RLS and the
-- form fell back to the WhatsApp handoff; this is what turns the real flow on.
-- No app code changes with it.
--
-- Deliberately a separate table from `papers`: a submission is not a paper yet.
-- It has no slug, no published state and no guarantee the pages are legible.
-- Review promotes it into `papers`; this row stays as the audit trail.

create table if not exists public.paper_submissions (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  school            text not null,
  board             text,
  class             text,
  subject           text not null,
  year              text,
  exam_type         text,
  submitter_name    text,
  submitter_contact text,
  file_paths        text[] not null default '{}',
  -- pending -> approved | rejected. Approved rows are copied into `papers` by
  -- whoever reviews them. Constrained because the review queue filters on this
  -- and a typo would silently hide a submission rather than fail loudly.
  status            text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected')),
  review_note       text,
  reviewed_at       timestamptz,
  reviewed_by       uuid references auth.users (id)
);

create index if not exists paper_submissions_status_idx
  on public.paper_submissions (status, created_at desc);

alter table public.paper_submissions enable row level security;

-- Anyone may submit. Nobody may read back: a submission carries the sender's
-- contact details, so it is write-only to the public and readable only by
-- admins.
create policy "anyone can submit a paper"
  on public.paper_submissions for insert
  to anon, authenticated
  with check (status = 'pending');

create policy "admins read submissions"
  on public.paper_submissions for select
  to authenticated
  using (public.is_admin());

create policy "admins update submissions"
  on public.paper_submissions for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Second layer, same reasoning as this project's SECURITY DEFINER lockdown: RLS
-- already denies anon every row, but the table grant should not be the only
-- thing standing between a stranger and other people's contact details. The
-- client inserts without RETURNING, so it never needs SELECT.
revoke all on public.paper_submissions from anon;
grant insert on public.paper_submissions to anon;

-- Private bucket. These are unreviewed uploads from strangers; they must not be
-- publicly readable until a person has looked at them and promoted the paper.
insert into storage.buckets (id, name, public)
values ('paper-submissions', 'paper-submissions', false)
on conflict (id) do nothing;

create policy "anyone can upload a submission"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'paper-submissions');

create policy "admins read submissions bucket"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'paper-submissions' and public.is_admin());
