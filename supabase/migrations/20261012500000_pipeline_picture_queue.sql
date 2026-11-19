-- The picture backlog numbers the papers route shows: one row the desk writes, no API role can touch.
--
-- Owner, 12 Oct 2026: the pipeline overview must say "how many are pending image uploads". The
-- pictures of cleared questions are queued on the desk and uploaded only when the owner says so, so
-- the website cannot count them from its own tables. The desk's picture_queue step writes its status
-- here (counts and byte totals only: no question text, no paper names) and admin_pipeline_route()
-- reads it (migration 20261012500100).
--
-- One row, id = 1, enforced by a check constraint. RLS on with no policies and every privilege revoked
-- from public, anon and authenticated by name, the same shape as paper_registry: only the desk
-- (service role) writes; the site reads it through the HOD/admin function.
--
-- desk_synced_at is the moment the desk last wrote this row. It is what the page shows as "Data as of",
-- because paper_registry.updated_at only moves when a row changes, not when the desk last looked.

create table if not exists public.pipeline_picture_queue (
  id integer primary key default 1 check (id = 1),
  queued_papers integer not null default 0 check (queued_papers >= 0),
  queued_pictures integer not null default 0 check (queued_pictures >= 0),
  queued_bytes bigint not null default 0 check (queued_bytes >= 0),
  awaiting_route_questions integer not null default 0 check (awaiting_route_questions >= 0),
  awaiting_route_pictures integer not null default 0 check (awaiting_route_pictures >= 0),
  awaiting_route_bytes bigint not null default 0 check (awaiting_route_bytes >= 0),
  storage_used_bytes bigint check (storage_used_bytes is null or storage_used_bytes >= 0),
  storage_cap_bytes bigint check (storage_cap_bytes is null or storage_cap_bytes >= 0),
  desk_synced_at timestamptz not null default now()
);

alter table public.pipeline_picture_queue enable row level security;
revoke all on table public.pipeline_picture_queue from public, anon, authenticated;
