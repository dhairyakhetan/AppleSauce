-- 20261001091000_paper_files_ocr_bucket.sql
--
-- Round 24 item A (owner 2026-09-30): after OCR, every PDF is copied into the
-- mega folder Desktop\Shikshaq Papers\sorted\<board>\<class>\<subject>\ under
-- its canonical name, and its file name, relative path, fingerprint and OCR
-- outputs are recorded in Supabase so the admin debug toggle can show them.
--
--   paper_files  one row per PDF fingerprint (sha256): where it came from,
--                where it was filed, how each name field was decided (value,
--                source, evidence), the OCR run (pages, lanes, seconds,
--                bundle, machine), which storage objects hold its outputs, and
--                -- once known -- the audit_papers / bank_papers rows it became.
--                Written only by the laptop importer (service role).
--   paper-ocr    PRIVATE bucket: the OCR text outputs, gzip-compressed
--                (<folder>/<stem>.md.gz, .json.gz, .meta.json). Storage on
--                2026-09-30 stood at 762 MB of the free plan's 1 GB, so the
--                diagrams stay in the local folder unless the importer is run
--                with --with-figures.
--   admin_paper_file()  admin-only read for the debug toggle, by fingerprint,
--                bank paper id or audit paper id.
--
-- Security: RLS on, no policies for anon/authenticated on the table; every
-- privilege revoked by role name; the bucket is readable by admins only.
--
-- Name note: the older PUBLIC bucket 'paper-files' (20260812000002, PDFs for
-- the past-papers page) is unrelated to this table.

begin;

set local lock_timeout = '5s';

create table if not exists public.paper_files (
  sha256 text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('paper', 'set_aside', 'duplicate')),
  reason text,                         -- why it was set aside, when it was
  original_name text not null,
  original_rel_path text not null,     -- 'unsorted/...' inside the mega folder
  canonical_name text,
  sorted_rel_path text,                -- 'sorted/...' inside the mega folder
  folder text,
  board text, cls text, subject text, school text, exam text, year text,
  fields jsonb,                        -- {"board": {"value", "source", "evidence"}, ...}
  unknown_fields text[],
  ocr jsonb,                           -- pages, seconds, diagrams, lanes, bundle
  machine jsonb,
  storage_objects text[] not null default '{}',   -- keys in the paper-ocr bucket
  audit_paper_id uuid references public.audit_papers (id) on delete set null,
  bank_paper_id text references public.bank_papers (id) on delete set null,
  sorted_at timestamptz,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists paper_files_bank_paper_idx on public.paper_files (bank_paper_id);
create index if not exists paper_files_audit_paper_idx on public.paper_files (audit_paper_id);
create index if not exists paper_files_subject_idx on public.paper_files (board, cls, subject);

alter table public.paper_files enable row level security;
revoke all on table public.paper_files from public, anon, authenticated;

comment on table public.paper_files is
  'One row per PDF fingerprint from the portable OCR ledger (Desktop\Shikshaq Papers\ledger\papers.jsonl): original and canonical names, sorted path, how each name field was decided, the OCR run, storage keys of its gzip OCR outputs in the private paper-ocr bucket, and the audit/bank paper it became. Service-role writes only; admins read through admin_paper_file().';

create or replace function public.admin_paper_file(
  p_sha256 text DEFAULT NULL, p_bank_paper_id text DEFAULT NULL, p_audit_paper_id uuid DEFAULT NULL)
 returns setof public.paper_files
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_sha256 is null and p_bank_paper_id is null and p_audit_paper_id is null then
    raise exception 'Give a fingerprint, a bank paper id or an audit paper id' using errcode = '22023';
  end if;
  return query
    select * from public.paper_files f
    where (p_sha256 is null or f.sha256 = p_sha256)
      and (p_bank_paper_id is null or f.bank_paper_id = p_bank_paper_id)
      and (p_audit_paper_id is null or f.audit_paper_id = p_audit_paper_id)
    order by f.sorted_at desc nulls last
    limit 20;
end;
$function$;

revoke all on function public.admin_paper_file(text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_paper_file(text, text, uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('paper-ocr', 'paper-ocr', false, 5242880,
        array['application/gzip', 'application/json', 'text/markdown', 'image/png'])
on conflict (id) do nothing;

drop policy if exists "Admins can read paper OCR" on storage.objects;
create policy "Admins can read paper OCR"
on storage.objects for select
to authenticated
using (bucket_id = 'paper-ocr' and public.is_admin());

commit;
