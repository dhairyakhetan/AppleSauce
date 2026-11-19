-- Visible question counts, 2026-09-30. Apply AFTER 20260930230000_maths_question_level_hold.sql.
--
-- WHY
--   bank_papers.question_count counts every row, but the Maths hold now keeps
--   flagged questions off the page. "Sign in to read all 40" then promised more
--   than a signed-in reader gets, and the paper description said "All 40
--   questions". Owner, 2026-09-30: count only the questions a reader can see.
--
-- WHAT
--   public.bank_paper_visible_counts(p_paper_id text default null)
--     -> (paper_id, visible) for published papers; one paper, or all when null.
--   visible = question rows minus the Maths questions the hold rule keeps back.
--   The rule is the SAME predicate as bank_paper_questions (the hold flags come
--   from question_hold_flags(), the one list). The whole-paper needs_review
--   hold is deliberately NOT subtracted: a paper under review keeps its real
--   size ("being audited"), it just shows no questions yet. A paper whose
--   questions are all held reports 0 (left join), never a missing row.
--   Returns counts only: no body, no answer_key, no read_events row.
--
-- GRANTS
--   anon and authenticated execute (the prerender reads it with the anon key;
--   the paper page reads it signed out or in). Revoked from public, anon and
--   authenticated by name first, as CLAUDE.md requires.
--
-- ROLLBACK
--   drop function public.bank_paper_visible_counts(text);
--   The site falls back to question_count when the function is missing.

set local lock_timeout = '5s';

create or replace function public.bank_paper_visible_counts(p_paper_id text default null)
returns table(paper_id text, visible integer)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p.id,
         (count(q.id) filter (
            where p.subject <> 'Mathematics'
               or coalesce(d.status, '') = 'passed'
               or not (coalesce(d.flag_reasons, '{}'::text[]) && public.question_hold_flags())
         ))::integer
  from public.bank_papers p
  left join public.bank_questions q on q.paper_id = p.id
  left join lateral (
    select a.status, a.flag_reasons
    from public.audit_questions a
    where a.live_bank_question_id = q.id
      and a.kind = 'question'
    order by a.updated_at desc
    limit 1
  ) d on p.subject = 'Mathematics'
  where p.is_published
    and (p_paper_id is null or p.id = p_paper_id)
  group by p.id;
$function$;

revoke all on function public.bank_paper_visible_counts(text) from public, anon, authenticated;
grant execute on function public.bank_paper_visible_counts(text) to anon, authenticated;
