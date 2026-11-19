-- Captures a fix that was already live in Supabase but never committed as a
-- migration -- the exact failure mode 20260909000001's own preamble warns
-- about ("the fix existed only in the live database... could never be
-- reproduced on a fresh project"), flagged by an audit agent before this
-- branch launched.
--
-- The 2026-09-25 English replacement (see 20260925120000) backed up the
-- pre-replacement English bank_papers/bank_questions rows with two plain
-- `create table ... as select` statements, run ad hoc against the live
-- project. CTAS does not copy RLS, policies, or grants from the source
-- table -- the new tables came up with RLS disabled and Supabase's default
-- privileges (grant to anon, authenticated), which made them briefly
-- readable through PostgREST. Caught and fixed live the same session; this
-- file is that fix, reproduced verbatim so a fresh project (or a future
-- `generate-bank-sql.ts`-style regeneration that doesn't know these tables
-- need locking down) can't silently reopen it.
--
-- Idempotent and safe to run even though the tables already carry this
-- state live: revoke/enable-RLS have no effect the second time.
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = '_backup_english_bank_papers_20260925') then
    execute 'revoke all on public._backup_english_bank_papers_20260925 from public, anon, authenticated';
    execute 'alter table public._backup_english_bank_papers_20260925 enable row level security';
  end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = '_backup_english_bank_questions_20260925') then
    execute 'revoke all on public._backup_english_bank_questions_20260925 from public, anon, authenticated';
    execute 'alter table public._backup_english_bank_questions_20260925 enable row level security';
  end if;
end $$;
