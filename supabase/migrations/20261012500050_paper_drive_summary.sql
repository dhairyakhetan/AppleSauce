-- How many PDFs are on the computer, as the desk counted them: one row the desk writes, no API role can touch.
--
-- Owner, 12 Oct 2026: "how many PDFs are there in total right now on my computer". The registry's own
-- total (8,038 rows) is the number of papers the desk has a record of, not the number of files on the
-- disk (6,880 on 12 Oct), so the site needs the real count from the computer.
--
-- Written by pipeline\registry\build_drive_tree.py --publish-registry (it upserts the row key = 'latest'
-- with the service role, and keeps working if this table does not exist yet). admin_pipeline_route()
-- reads it (migration 20261012500100). Counts only: no names, no paths, no question text.
--
-- RLS on with no policies and every privilege revoked from public, anon and authenticated by name, the
-- same shape as paper_registry.

create table if not exists public.paper_drive_summary (
  key text primary key,
  generated_at timestamptz,
  total_pdfs integer check (total_pdfs is null or total_pdfs >= 0),
  classified integer check (classified is null or classified >= 0),
  unclassified integer check (unclassified is null or unclassified >= 0),
  set_aside integer check (set_aside is null or set_aside >= 0),
  student_upload integer check (student_upload is null or student_upload >= 0),
  loaded_or_live integer check (loaded_or_live is null or loaded_or_live >= 0),
  bytes_total bigint check (bytes_total is null or bytes_total >= 0),
  by_status jsonb,
  updated_at timestamptz default now()
);

alter table public.paper_drive_summary enable row level security;
revoke all on table public.paper_drive_summary from public, anon, authenticated;
