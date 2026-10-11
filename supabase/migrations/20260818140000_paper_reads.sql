-- One table unblocks three designed-but-unbuilt features that all need the same
-- fact recorded: which papers a person has finished.
--
--   "Most read" panel        (pages.md 4.6)  -> aggregate count
--   Weekly goal ring         (micro-01, F3)  -> this week's reads for a user
--   "You have N new papers"  (pages.md 4.1)  -> published since their last read
--
-- Modelled on teacher_upvotes: one row per (user, paper), unique so a re-read
-- cannot inflate a count, with the public aggregate exposed as a view the way
-- teacher_upvote_stats already is.

create table if not exists public.paper_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id uuid not null references public.papers(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique (user_id, paper_id)
);

create index if not exists idx_paper_reads_user_read_at on public.paper_reads (user_id, read_at desc);
create index if not exists idx_paper_reads_paper on public.paper_reads (paper_id);

alter table public.paper_reads enable row level security;

-- A read is the reader's own business: they may record and see theirs and
-- nobody else's. No UPDATE policy -- a read either happened or it did not.
create policy "Users can record their own reads"
  on public.paper_reads for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users can see their own reads"
  on public.paper_reads for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can remove their own reads"
  on public.paper_reads for delete to authenticated
  using (auth.uid() = user_id);

-- Two layers, same reasoning as the SECURITY DEFINER lockdown: RLS already
-- denies anon every row, but the default PUBLIC grant should not be the only
-- thing standing between a future policy edit and "who read what".
revoke all on table public.paper_reads from public;
revoke all on table public.paper_reads from anon;
grant select, insert, delete on table public.paper_reads to authenticated;

-- Public aggregate ONLY. Counts per paper are safe to publish; who read them
-- is not, and never leaves the table above.
create or replace view public.paper_read_stats as
  select p.id as paper_id, p.title, p.school, p.subject, p.class,
         count(r.id) as read_count
  from public.papers p
  left join public.paper_reads r on r.paper_id = p.id
  where p.is_published
  group by p.id, p.title, p.school, p.subject, p.class;

grant select on public.paper_read_stats to anon, authenticated;

comment on table public.paper_reads is
  'One row per (user, paper) when a reader finishes a paper. Feeds the weekly goal ring, the new-papers count and, in aggregate via paper_read_stats, the Most read panel.';
comment on view public.paper_read_stats is
  'Public per-paper read counts. Aggregate only -- individual reads stay in paper_reads under RLS.';
