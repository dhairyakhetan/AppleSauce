-- Admin audit log (Redesign admin-05-audit-log.png).
-- Append-only by design: admins may SELECT and INSERT; nobody may UPDATE or
-- DELETE. That is the entire point of an audit log and the mockup's
-- "append only" pill.
--
-- APPLIED and verified against pg_policies / has_table_privilege: two policies
-- (SELECT, INSERT), RLS on, `authenticated` has neither UPDATE nor DELETE, and
-- `anon` has no privilege at all.

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  actor_name text not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  target_label text not null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;

-- Admins may read the full log.
create policy "Admins can read audit log"
  on public.admin_audit_log
  for select
  to authenticated
  using (exists (select 1 from public.admins a where a.id = auth.uid()));

-- Admins may append rows, always attributed to themselves.
create policy "Admins can insert audit log rows"
  on public.admin_audit_log
  for insert
  to authenticated
  with check (
    exists (select 1 from public.admins a where a.id = auth.uid())
    and actor_id = auth.uid()
  );

-- Deliberately NO update/delete policy of any kind, for any role. RLS
-- defaults to deny, so this table is append-only: rows can be created and
-- read, never altered or removed, by anyone (including admins) through the
-- API. Revoke the underlying grants too, defense in depth.
-- Revoke from PUBLIC, not from the roles by name: Postgres grants to PUBLIC by
-- default and anon/authenticated inherit through it, so naming them alone is a
-- no-op. (Learned the hard way on the definer-function migration.)
revoke update, delete on public.admin_audit_log from public;
revoke select, insert on public.admin_audit_log from public, anon;
grant  select, insert on public.admin_audit_log to authenticated;
