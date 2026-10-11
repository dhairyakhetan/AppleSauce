-- Paper review: one row per paper, and the printed paper's file name.
--
-- Owner, 2026-09-28: "filters dont work" on /admin/paper-review.
--
-- ROOT CAUSE (measured read-only on live, 2026-09-28). The English rescue
-- (20260928190000, W14) staged its held-back questions as a SECOND
-- audit_papers row with source = 'live_copy' for the same bank paper
-- (meta_source.role = 'rescue', 736 of them). admin_paper_queue() joined
-- every live_copy row and grouped by (bp.id, ap.id), so it returned 2,696
-- rows for 1,960 papers: every English paper with a rescue copy twice.
--   * Tile counts were inflated: "Needs review" 1,190 (true 893),
--     "Verified" 1,502 (true 1,063).
--   * The list keyed rows by paper id, so 736 ids appeared twice. React's
--     reconciliation with duplicate keys leaves stale rows on screen when the
--     list changes, which is exactly "I click a filter and the list does not
--     follow".
--   * The pages were cut with .range() over an order (needs_review, bp.id)
--     that ties on the two copies of one paper, so a page boundary could
--     drop or repeat a copy.
--
-- Builds on 20260928220000_admin_edit_skip_rescue_copy.sql, which already
-- made admin_paper_draft() and admin_verify_paper() skip the rescue copy.
-- The same rule (coalesce(meta_source ->> 'role', '') <> 'rescue') picks the
-- main copy here. admin_verify_paper() is not touched.
--
-- What this file changes:
--   1. admin_paper_queue()     one row per bank paper (CREATE OR REPLACE,
--      same return type). Progress counts come from the main copy;
--      escalated_count counts open "ask for help" rows on every live_copy of
--      the paper, so an escalation on a rescue row is not lost.
--   2. admin_paper_draft(text) DROP + CREATE, body as 20260928220000 plus
--      one column, source_pdf text: the file name of the printed paper
--      (never a path, never a link). Read from
--      audit_papers.meta_source->>'source_pdf' first (staged for English by
--      supabase/stage-english-source-pdf.sql, since only the W14 release
--      has it), else the file name at the end of audit_papers.pdf_path
--      (Mathematics, History & Civics, Economics: 254 papers carry a
--      verified path; pdf_path was nulled where the live-copy match failed,
--      so it is never a guess). Null when neither is known.
--
-- Lockdown per CLAUDE.md's trap: SECURITY DEFINER, search_path pinned,
-- is_admin() checked in the body (raises 42501), EXECUTE revoked from
-- public, anon AND authenticated by name, then granted to authenticated only.

begin;

-- ============================================================
-- 1. admin_paper_queue: one row per bank paper.
-- ============================================================
create or replace function public.admin_paper_queue()
returns table (
  paper_id text, title text, school text, subject text, cls text, board text, year text,
  needs_review boolean, is_published boolean, incomplete_note text,
  audit_paper_id uuid, escalated_count bigint, total_questions bigint, passed_questions bigint
)
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select bp.id, bp.school || ' ' || bp.subject as title, bp.school, bp.subject, bp.cls, bp.board, bp.year,
           bp.needs_review, bp.is_published, bp.incomplete_note,
           ap.id as audit_paper_id,
           coalesce(esc.n, 0)::bigint as escalated_count,
           coalesce(cnt.total, 0)::bigint as total_questions,
           coalesce(cnt.passed, 0)::bigint as passed_questions
    from public.bank_papers bp
    left join lateral (
      select a.id
      from public.audit_papers a
      where a.source = 'live_copy' and a.live_bank_paper_id = bp.id
        and coalesce(a.meta_source ->> 'role', '') <> 'rescue'
      order by a.created_at desc
      limit 1
    ) ap on true
    left join lateral (
      select count(*) filter (where q.kind = 'question') as total,
             count(*) filter (where q.kind = 'question' and q.question_passed) as passed
      from public.audit_questions q
      where q.paper_id = ap.id
    ) cnt on true
    left join lateral (
      select count(*) as n
      from public.audit_questions q
      join public.audit_papers a2 on a2.id = q.paper_id
      where a2.source = 'live_copy' and a2.live_bank_paper_id = bp.id
        and q.review_bucket = 'escalated' and q.question_passed = false
    ) esc on true
    order by bp.id;
end;
$function$;

revoke all on function public.admin_paper_queue() from public, anon, authenticated;
grant execute on function public.admin_paper_queue() to authenticated;

-- ============================================================
-- 2. admin_paper_draft: the main draft, plus the source PDF's file name.
--    Return type changes, so DROP + CREATE (CREATE OR REPLACE cannot).
-- ============================================================
drop function if exists public.admin_paper_draft(text);

create function public.admin_paper_draft(p_paper_id text)
returns table (
  paper_id text, school text, subject text, cls text, board text, year text, exam text,
  needs_review boolean, is_published boolean, incomplete_note text,
  general_instructions text, allowed_time_minutes integer,
  audit_paper_id uuid, paper_passed boolean, is_red boolean, red_reason text,
  source_pdf text,
  question_id uuid, ord int, kind text, parent_id uuid, number_path text,
  display_number text, body text, options jsonb, marks numeric, instructions text,
  question_passed boolean, status text, review_bucket text,
  flag_reasons text[], flag_detail text, source jsonb,
  live_bank_question_id text, updated_at timestamptz
)
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select bp.id, bp.school, bp.subject, bp.cls, bp.board, bp.year, bp.exam,
           bp.needs_review, bp.is_published, bp.incomplete_note,
           bp.general_instructions, bp.allowed_time_minutes,
           ap.id, ap.paper_passed, ap.is_red, ap.red_reason,
           ap.source_pdf,
           aq.id, aq.ord, aq.kind, aq.parent_id, aq.number_path,
           aq.display_number, aq.body, aq.options, aq.marks, aq.instructions,
           aq.question_passed, aq.status, aq.review_bucket,
           aq.flag_reasons, aq.flag_detail, aq.source,
           aq.live_bank_question_id, aq.updated_at
    from public.bank_papers bp
    left join lateral (
      select a.id, a.paper_passed, a.is_red, a.red_reason,
             nullif(btrim(coalesce(
               a.meta_source ->> 'source_pdf',
               regexp_replace(a.pdf_path, '^.*[\\/]', '')
             )), '') as source_pdf
      from public.audit_papers a
      where a.source = 'live_copy' and a.live_bank_paper_id = bp.id
        and coalesce(a.meta_source ->> 'role', '') <> 'rescue'
      order by a.created_at desc
      limit 1
    ) ap on true
    left join public.audit_questions aq on aq.paper_id = ap.id
    where bp.id = p_paper_id
    order by aq.ord nulls last;
end;
$function$;

revoke all on function public.admin_paper_draft(text) from public, anon, authenticated;
grant execute on function public.admin_paper_draft(text) to authenticated;

commit;

-- ============================================================
-- Check after applying (read-only):
--
--   select count(*), count(distinct paper_id) from public.admin_paper_queue();
--     -- as an admin: both 1,960 (was 2,696 / 1,960)
--
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
--          p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('admin_paper_queue', 'admin_paper_draft');
--
-- Expected: anon_exec false, auth_exec true, prosecdef true for both.
-- ============================================================
