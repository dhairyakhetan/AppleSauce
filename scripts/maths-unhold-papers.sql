-- NOT a migration. Run ONCE, by the owner or parent, AFTER
-- supabase/migrations/20260930230000_maths_question_level_hold.sql is applied.
--
-- Owner decision 2026-09-30: Maths shows clean questions; only questions with
-- a content-risk flag are held. This clears needs_review on every published
-- Mathematics paper that still has it, and logs each change as an undoable
-- revision (before true, after false). English, Economics and History papers
-- are untouched: they stay wholly held until their rebuild.
--
-- Order matters: apply the migration FIRST, otherwise the old function would
-- expose every question of these papers including the flagged ones.
--
-- Undo: update public.bank_papers set needs_review = true
--   where id in (select row_id from public.bank_question_revisions
--     where actor = 'system:owner-approved-2026-09-30' and field = 'needs_review');
--
-- One statement, returns the number of papers changed.
-- Needs 20260930233000_paper_visible_counts.sql applied first.
with target as (
  select id
  from public.bank_papers
  where subject = 'Mathematics'
    and is_published
    and needs_review
    -- a paper whose every question is held (e.g. a whole duplicate) stays held
    -- as a paper: unholding it would open an empty page
    and exists (select 1 from public.bank_paper_visible_counts(bank_papers.id) c where c.visible > 0)
  for update
),
logged as (
  insert into public.bank_question_revisions
    (table_name, row_id, action, field, before, after, actor, source, reason)
  select 'bank_papers', t.id, 'admin_edit', 'needs_review',
         'true'::jsonb, 'false'::jsonb,
         'system:owner-approved-2026-09-30', 'system',
         'owner 2026-09-30: Maths shows clean questions; only content-risk flagged questions are held'
  from target t
  returning row_id
),
flipped as (
  update public.bank_papers p
     set needs_review = false
    from target t
   where p.id = t.id
  returning p.id
)
select count(*) as papers_unheld,
       (select count(*) from logged) as revisions_logged
from flipped;
