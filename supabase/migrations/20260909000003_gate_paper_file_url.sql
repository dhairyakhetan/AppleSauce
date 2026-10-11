-- Same class of fix as bank_questions and Shikshaqmine.Link (see the two
-- migrations immediately before this one): PaperReader.tsx (the scanned-PDF
-- reader, for the `papers` table -- a different reader from the question-
-- bank one) fetched `select('*')` unconditionally on mount, so `file_url`
-- was sitting in the response for every visitor, signed in or not, and only
-- the JSX rendering it was gated. Currently zero of the 18 rows in `papers`
-- have file_url populated, so nothing has actually leaked yet -- this closes
-- the gap before real PDFs get uploaded, not after.
--
-- Other columns (title, school, subject, class, board, exam_type, year,
-- is_published) stay anon-readable: that's the public paper listing/metadata,
-- the same kind of thing bank_papers already exposes freely. Only the file
-- location itself is gated.

revoke select on public.papers from anon;
grant select (
  id, title, school, subject, class, board, exam_type, year,
  is_published, created_at, updated_at
) on public.papers to anon;
-- file_url and created_by deliberately absent from anon's column grant.
-- created_by is an uploader's user id -- no public-facing code reads it
-- (confirmed: PaperReader.tsx's own `Paper` interface doesn't declare it),
-- left out rather than granted back unnecessarily.

create or replace function public.paper_file_url(p_paper_id uuid)
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  select case when auth.uid() is null then null else file_url end
  from public.papers
  where id = p_paper_id and is_published
  limit 1;
$function$;

revoke all on function public.paper_file_url(uuid) from public;
grant execute on function public.paper_file_url(uuid) to anon, authenticated;

comment on function public.paper_file_url(uuid) is
  'The only anon-reachable read of papers.file_url. Returns null for a signed-out caller, the real URL for a signed-in one -- decided from auth.uid() inside the function, not from any client-supplied flag.';
