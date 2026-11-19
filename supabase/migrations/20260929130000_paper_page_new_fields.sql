-- Public paper page: surface the new bank_questions fields the pipeline has
-- started filling in (suggested_time_minutes, section_label,
-- alternative_group/alternative_label, parent_question_id), and stop leaking
-- answer_key.
--
-- Context: 20260928000000_paper_checker_and_admin.sql added these columns to
-- bank_questions and, in the same migration, widened bank_paper_questions()'s
-- RETURNS TABLE to include most of them -- but it ALSO added `answer_key` to
-- that RETURNS TABLE and SELECT list. bank_paper_questions() is EXECUTE-
-- granted to anon and authenticated (confirmed live, project
-- uvtifolnsneitetzohtn, 2026-09-29: has_function_privilege('anon', ...,
-- 'EXECUTE') = true), so this function has been serving `answer_key` to every
-- reader of a paper, signed in or not, since 2026-09-28. CLAUDE.md's owner
-- brief for this change is explicit: "NOT answer_key (answers are a future
-- product decision; never expose)". This migration removes it.
--
-- The only other gap for the public paper page is `parent_question_id`
-- (sub-parts), which this adds. Everything else the page needs
-- (suggested_time_minutes, section_label, alternative_group,
-- alternative_label, display_number, instructions) was already in the
-- function's return list.
--
-- Byte-exact / gating rule preserved exactly: same WHERE clause, same
-- `order by q.ord`, same `limit case when v_uid is null then 2 else null end`
-- free-preview gate (src/lib/free-preview.ts), same read_events insert. A
-- RETURNS TABLE column-list change is not something CREATE OR REPLACE can do
-- (Postgres error 42P13), so this is DROP + CREATE in one transaction, with
-- security definer restated and all three revoke/grant lines re-run, per
-- CLAUDE.md's documented trap (Supabase's `alter default privileges` re-grants
-- EXECUTE to anon/authenticated by role name on every new function, so
-- revoking from PUBLIC alone would leave this reachable again).
--
-- Dry-run confirmed (begin..rollback, read-only session, 2026-09-29):
--   set local role anon;
--   select count(*) from public.bank_paper_questions(<a real paper id>);
--   -> 2 rows (the free-preview gate, unchanged), no answer_key column in
--   the result, parent_question_id present. No live change was made by that
--   check; this file is what actually applies it.

begin;

drop function if exists public.bank_paper_questions(text);

create function public.bank_paper_questions(p_paper_id text)
 returns table(
   id text, paper_id text, number text, body text, marks numeric, chapter text,
   qtype text, page integer, figure text, options text[],
   display_number text, instructions text, suggested_time_minutes numeric,
   chapter_from_paper boolean, alternative_group text,
   alternative_label text, section_label text, parent_question_id text
 )
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
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
    where q.paper_id = p_paper_id
      and p.is_published
      and not p.needs_review
    order by q.ord
    limit case when v_uid is null then 2 else null end;
end;
$function$;

revoke all on function public.bank_paper_questions(text) from public;
revoke all on function public.bank_paper_questions(text) from anon;
revoke all on function public.bank_paper_questions(text) from authenticated;
grant execute on function public.bank_paper_questions(text) to anon, authenticated;

commit;
