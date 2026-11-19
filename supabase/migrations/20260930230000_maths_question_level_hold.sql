-- Owner decision 2026-09-30: Maths papers show their clean questions now and
-- hold only the questions that carry a content-risk flag. Every other subject
-- (English, Economics, History & Civics) keeps the whole-paper rule: a
-- needs_review paper returns zero rows to every caller.
--
-- Live body read on uvtifolnsneitetzohtn 2026-09-30 (20260929130000 columns,
-- SECURITY DEFINER, search_path public, extensions). Return columns, the
-- read_events write, the ORDER BY q.ord and the free-preview cut are all
-- unchanged; only the WHERE clause grows.
--
-- The rule, for a paper with subject = 'Mathematics' that is_published:
--   a question shows unless its most recent desk copy (audit_questions where
--   live_bank_question_id = q.id and kind = 'question', latest updated_at) is
--   not 'passed' AND carries a flag in question_hold_flags().
--   No desk copy at all means nothing flags it, so it shows.
-- needs_review no longer hides a Maths question. It still hides everything
-- for every other subject.
--
-- The free preview (2 questions for a signed-out caller) is applied AFTER the
-- hold filter, by the same LIMIT as before, so the two free questions are
-- always the first two VISIBLE questions in paper order. A held question can
-- never be one of them.
--
-- answer_key is not in the return list and is not added.

-- Fail fast rather than queue behind a checker transaction (review 2026-09-30).
set local lock_timeout = '5s';

-- The hold set lives in exactly one place. Immutable so the planner can fold
-- it to a constant. Change the list by CREATE OR REPLACE of this function.
create or replace function public.question_hold_flags()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $function$
  select array[
    'figure_missing',
    'snippet_unaligned',
    'possible_duplicate',
    'page_furniture',
    'short_body',
    'unbalanced_math_delim',
    'ocr_junk'
  ]::text[];
$function$;

-- Helper only; the site never needs to call it. Closed to all three names.
revoke all on function public.question_hold_flags() from public, anon, authenticated;

-- Supports the per-question "latest desk copy" lookup.
create index if not exists audit_questions_live_q_updated_idx
  on public.audit_questions (live_bank_question_id, updated_at desc)
  where kind = 'question';

create or replace function public.bank_paper_questions(p_paper_id text)
returns table(
  id text, paper_id text, number text, body text, marks numeric, chapter text,
  qtype text, page integer, figure text, options text[], display_number text,
  instructions text, suggested_time_minutes numeric, chapter_from_paper boolean,
  alternative_group text, alternative_label text, section_label text,
  parent_question_id text
)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    insert into public.read_events (user_id, kind, target_id, ip_hash)
    values (v_uid, 'paper', p_paper_id,
      encode(extensions.digest(coalesce(
        current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''
      ), 'sha256'), 'hex'));
  end if;

  return query
    select q.id, q.paper_id, q.number, q.body, q.marks, q.chapter,
           q.qtype, q.page, q.figure, q.options,
           q.display_number, q.instructions, q.suggested_time_minutes,
           q.chapter_from_paper, q.alternative_group,
           q.alternative_label, q.section_label, q.parent_question_id
    from public.bank_questions q
    join public.bank_papers p on p.id = q.paper_id
    left join lateral (
      select a.status, a.flag_reasons
      from public.audit_questions a
      where a.live_bank_question_id = q.id
        and a.kind = 'question'
      order by a.updated_at desc
      limit 1
    ) d on p.subject = 'Mathematics'
    where q.paper_id = p_paper_id
      and p.is_published
      and case
            when p.subject = 'Mathematics' then
              coalesce(d.status, '') = 'passed'
              or not (coalesce(d.flag_reasons, '{}'::text[]) && public.question_hold_flags())
            else not p.needs_review
          end
    order by q.ord
    limit case when v_uid is null then 2 else null end;
end;
$function$;

-- Re-assert the grants exactly as live: intended to be executable by both
-- browser roles (CLAUDE.md: revoke from public AND by role name, then grant
-- exactly what is meant).
revoke all on function public.bank_paper_questions(text) from public, anon, authenticated;
grant execute on function public.bank_paper_questions(text) to anon, authenticated;
