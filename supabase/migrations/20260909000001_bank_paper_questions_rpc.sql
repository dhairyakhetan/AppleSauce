-- Captures a fix that was already live in Supabase but never committed as a
-- migration: the paper reader's "soft gate" (every question sent to every
-- visitor, the gated tail merely blurred with CSS) was replaced with a real
-- one, verified live as a real anonymous caller: a direct
-- `select * from bank_questions` returns zero rows, and this RPC is the only
-- path anon/authenticated have to the table's contents.
--
-- Without this file, the fix existed only in the live database. Two risks
-- that created: (1) it could never be reproduced on a fresh project, and
-- (2) scripts/generate-bank-sql.ts (regenerated and re-applied on every bank
-- import) still granted anon direct SELECT on bank_questions, which would
-- have silently re-opened this table the next time that generated SQL ran.
-- Fixed alongside this file; see that script's own comment.
--
-- The gate itself: signed out gets the first five questions of a paper (by
-- `ord`), signed in gets all of them. Deciding this from auth.uid() inside a
-- SECURITY DEFINER function, rather than from anything the client sends, is
-- what makes it real -- there is no client-side flag or query parameter that
-- can ask for more than five.

-- Reproduced verbatim from the live definition (pg_get_functiondef), not
-- reconstructed from the doc comments elsewhere -- this is what was
-- actually running, word for word.
create or replace function public.bank_paper_questions(p_paper_id text)
 returns table(id text, paper_id text, number text, body text, marks numeric, chapter text, qtype text, page integer, figure text, options text[])
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select q.id, q.paper_id, q.number, q.body, q.marks, q.chapter,
         q.qtype, q.page, q.figure, q.options
  from public.bank_questions q
  join public.bank_papers p on p.id = q.paper_id
  where q.paper_id = p_paper_id
    and p.is_published
  order by q.ord
  -- The gate. auth.uid() is null for anon and for Googlebot alike.
  limit case when auth.uid() is null then 5 else null end;
$function$;

-- Layer (a): PUBLIC, not the role names -- anon/authenticated inherit
-- EXECUTE from PUBLIC by default, so revoking from those role names alone
-- would be a no-op (the same mistake this project has already fixed once,
-- in 20260818120000_lock_down_unguarded_definer_functions.sql).
revoke all on function public.bank_paper_questions(text) from public;
grant execute on function public.bank_paper_questions(text) to anon, authenticated;

comment on function public.bank_paper_questions(text) is
  'The only anon-reachable read of bank_questions. Returns 5 questions to a signed-out caller, all of them to a signed-in one -- decided from auth.uid() inside the function body, not from any client-supplied flag.';

-- bank_questions itself: authenticated only (not anon). This function is the
-- sole gate; a direct table policy open to anon would bypass it entirely.
-- Policy renamed live from the original migration's "... are public" to "...
-- need an account" -- matched here, not restated under the old name.
-- Matches the live grant this migration is capturing, not the wider one
-- 20260829180149_bank_papers_and_questions.sql originally shipped.
drop policy if exists "questions of published papers are public" on public.bank_questions;
drop policy if exists "questions of published papers need an account" on public.bank_questions;
create policy "questions of published papers need an account"
  on public.bank_questions for select to authenticated
  using (exists (select 1 from public.bank_papers p
                  where p.id = bank_questions.paper_id and p.is_published));

-- anon still held a redundant raw SELECT grant live (RLS already blocked it
-- via the policy above having no anon-targeted rule -- Postgres RLS returns
-- zero rows for a role with no matching policy, grant or not). Dropped here
-- as defense in depth: matches CLAUDE.md's own concern about a stray anon
-- grant on this exact table being a silent regression risk if anything ever
-- re-adds a permissive policy without noticing the grant was still live.
revoke all on public.bank_questions from anon, authenticated;
grant select on public.bank_questions to authenticated;
