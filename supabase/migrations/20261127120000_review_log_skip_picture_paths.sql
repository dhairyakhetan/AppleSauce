-- 20261127120000: stop the review log from growing with picture bookkeeping, and run the hand-out timer hourly.
-- Owner, 27 Nov 2026: the database hit 491 MB of the 500 MB free limit. 46,983 of the 56,269 'ai_verdict' rows in
-- audit_review_log only recorded a picture path changing (65 MB of before/after copies); nothing reads them.
--
-- 1. trg_log_audit_question_ai_verdict(): when audit_questions.source changes, write the 'ai_verdict' log row ONLY if
--    at least one key OUTSIDE the picture/page bookkeeping list below changed. A change to anything else in `source`
--    (for example rescue_decision, pipeline, flags the AI wrote) is still logged exactly as before. Question text,
--    options, answers and marks are separate columns of audit_questions and were never part of this log row.
--    The bookkeeping list comes from what the pipeline writes into `source`:
--      upload_snippets.py   snippet_object, whole_snippet_object, whole_snippet_members
--      align_live.py        snippet_path, page, bbox, dpi, align_score
--      load_paper.py        snippet_path
--      enforce_picture_rule snippet_path, picture_rule
--      locate_pages.py      page, page_match_score, page_verified, page_method, page_before_locate
--      backfill_pdf_pages   page, page_from
--      fill_page_pictures   page, page_found_by, page_find_score, page_find_method
--    A source that is not a JSON object on both sides (null, list) is still logged, to be safe.
--    The trigger itself is unchanged (still fires when source changes); only the function body changes.
--
-- 2. The distribute-unassigned-papers timer only gives back papers idle for 7 days now (see
--    20261126100000_assign_only_on_button.sql: distribute_unassigned_papers_cron() calls only verifier_return_idle()).
--    Running it every 2 minutes writes 720 diary rows a day for nothing; hourly is plenty.
--    cron.schedule with an existing job name updates that job in place.
--    To undo: select cron.schedule('distribute-unassigned-papers', '*/2 * * * *', 'select public.distribute_unassigned_papers_cron()');
--
-- No data row is touched. Safe to run twice.

create or replace function public.trg_log_audit_question_ai_verdict()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_picture_keys constant text[] := array[
    'snippet_path', 'snippet_object', 'whole_snippet_object', 'whole_snippet_members',
    'align_score', 'page', 'bbox', 'dpi',
    'page_verified', 'page_match_score', 'page_method', 'page_before_locate',
    'page_from', 'page_found_by', 'page_find_score', 'page_find_method',
    'picture_rule'
  ];
  v_only_picture boolean := false;
begin
  if new.source is distinct from old.source then
    -- Skip the log row when every key that changed is picture/page bookkeeping.
    if jsonb_typeof(old.source) = 'object' and jsonb_typeof(new.source) = 'object' then
      select not exists (
        select 1
          from (select k from jsonb_object_keys(old.source) as k
                union
                select k from jsonb_object_keys(new.source) as k) as all_keys
         where (old.source -> all_keys.k) is distinct from (new.source -> all_keys.k)
           and not (all_keys.k = any (v_picture_keys))
      ) into v_only_picture;
      if v_only_picture then
        return new;
      end if;
    end if;
    -- A logging failure must never abort the pipeline's own update.
    begin
      insert into public.audit_review_log
        (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after)
      values (null, null, new.paper_id, new.id, 'ai_verdict', 'source', old.source, new.source);
    exception when others then
      raise warning 'audit_question ai_verdict log skipped: %', sqlerrm;
    end;
  end if;
  return new;
end;
$function$;

revoke all on function public.trg_log_audit_question_ai_verdict() from public, anon, authenticated;

-- The trigger already exists from 20260929120000; recreate it identically so this file stands on its own.
drop trigger if exists audit_question_log_ai_verdict on public.audit_questions;
create trigger audit_question_log_ai_verdict
  after update on public.audit_questions
  for each row
  when (new.source is distinct from old.source)
  execute function public.trg_log_audit_question_ai_verdict();

-- Timer: hourly instead of every 2 minutes.
select cron.schedule('distribute-unassigned-papers', '0 * * * *', 'select public.distribute_unassigned_papers_cron()');
