-- "Coming soon": a bank paper that stays listed and searchable, but whose
-- content isn't ready to show a reader yet.
--
-- is_published cannot express this. Its RLS policy is `using (is_published)`
-- (20260829180149_bank_papers_and_questions.sql) -- setting it to false hides
-- the row from every anon/authenticated query entirely: not listed, not in
-- search, not in the sitemap. That is the opposite of "listed, but locked",
-- which is what an editorial audit needs: the paper should still show up on
-- /past-papers and in search with a Coming soon pill, and only refuse to open.
--
-- needs_review is a second, independent flag. It changes nothing about RLS,
-- grants, or visibility -- only what BankPaper.tsx renders when a reader
-- tries to open the paper (see paper-sheet-card.tsx and paper-cover.tsx for
-- the listing-side pill).
alter table public.bank_papers
  add column if not exists needs_review boolean not null default false;

comment on column public.bank_papers.needs_review is
  'True: paper stays listed/searchable (is_published is untouched) but the reader shows a "Coming soon, under review" state instead of content. Independent of is_published.';

-- English is the batch flagged not-ready-to-go-out at the 2.0 launch.
update public.bank_papers set needs_review = true where subject = 'English';
