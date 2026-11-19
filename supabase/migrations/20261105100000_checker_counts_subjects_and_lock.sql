-- 20261105100000: the verifier's counters count questions, one function was left open, and verifiers can see which
-- subjects have papers (paper-checker audit, 5 November 2026). NOT APPLIED when written. The website does not depend on
-- it: the screen shows the subject hint only if verifier_subjects_with_papers() answers, and the counters keep working
-- on the old numbers until this is pasted into the SQL editor.
--
-- 1. checker_my_stats() and checker_checked_today_count() counted LOG LINES, so:
--      - a printed-typo fix (logged as checker_printed_typo, not checker_fix) was never counted, although the per-paper
--        "done" number counts it (25 such lines on 5 November 2026);
--      - Edit on a Done question, then saving it again, counted the same question twice.
--    They now count DISTINCT QUESTIONS the verifier passed, fixed (with or without the typo box), split or sent to the HOD.
--    "Today" is still the Kolkata day; "Total" is every question ever. A question dealt with on two different days counts
--    once in Total and once in each day's number (it was worked on that day). Undone lines are still excluded (counted
--    view). Same names, same columns, same return types, same grants: CREATE OR REPLACE keeps the grants.
--    The two other measures stay as they are on purpose: a skip counts in neither (it is not a verdict), and the OR
--    separator counts in neither (it is not a verdict either).
--
-- 2. checker_reference_ok(audit_questions), added by 20261103000000, had no revoke line, so anon and authenticated could
--    run it (checked with has_function_privilege on 5 November 2026). It only reads, and the caller has no rights on the
--    tables it reads, so the practical risk is small, but every function in this flow is closed to the three roles by
--    name. It is closed here, like its caller checker_question_servable already is. The definer functions that use it keep
--    working: they run as the owner.
--
-- 3. verifier_subjects_with_papers() returns the subject families the library has papers in, most papers first, so the
--    "Ask your HOD for subjects" box can say what is worth typing instead of refusing a subject with no papers
--    (clean_subject_list raises 22023 for those). Read-only; is_paper_checker() gate (42501); closed to public, anon AND
--    authenticated by name, then granted to authenticated.
--
-- Rollback: create or replace the two counters again with the bodies kept in the comment at the foot of this file (the live
-- bodies as read on 5 November 2026); grant execute on function public.checker_reference_ok(public.audit_questions) to
-- public, anon, authenticated (the state it was in); drop function public.verifier_subjects_with_papers();

create or replace function public.checker_my_stats()
returns table (today_count bigint, total_count bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_today timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select
      (count(distinct l.question_id) filter (where l.at >= v_today))::bigint as today_count,
      count(distinct l.question_id)::bigint as total_count
    from public.audit_review_log_counted l
    where l.actor_user_id = auth.uid()
      and l.question_id is not null
      and l.action in ('checker_pass', 'checker_fix', 'checker_printed_typo', 'checker_split', 'checker_ask_help');
end;
$function$;

create or replace function public.checker_checked_today_count()
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_count int;
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select count(distinct l.question_id)::int into v_count
  from public.audit_review_log_counted l
  where l.at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
    and l.question_id is not null
    and l.action in ('checker_pass', 'checker_fix', 'checker_printed_typo', 'checker_split', 'checker_ask_help')
    and l.actor_user_id = auth.uid();

  return v_count;
end;
$function$;

revoke all on function public.checker_reference_ok(public.audit_questions) from public, anon, authenticated;

create function public.verifier_subjects_with_papers()
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v text[];
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select coalesce(array_agg(s.family order by s.papers desc, s.family), '{}'::text[]) into v
  from (
    select public.subject_family(p.subject) as family, count(*) as papers
    from public.audit_papers p
    where p.subject is not null
      and public.subject_family(p.subject) is not null
    group by public.subject_family(p.subject)
  ) s;

  return v;
end;
$function$;

revoke all on function public.verifier_subjects_with_papers() from public, anon, authenticated;
grant execute on function public.verifier_subjects_with_papers() to authenticated;

-- Live bodies as read on 5 November 2026 (for the rollback):
--
-- CREATE OR REPLACE FUNCTION public.checker_checked_today_count()
--  RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
-- declare
--   v_count int;
-- begin
--   if not public.is_paper_checker() then
--     raise exception 'Not authorized' using errcode = '42501';
--   end if;
--   select count(*)::int into v_count
--   from public.audit_review_log_counted
--   where at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
--     and action in ('checker_pass', 'checker_fix', 'checker_split', 'checker_ask_help')
--     and actor_user_id = auth.uid();
--   return v_count;
-- end;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.checker_my_stats()
--  RETURNS TABLE(today_count bigint, total_count bigint) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
-- begin
--   if not public.is_paper_checker() then
--     raise exception 'Not authorized' using errcode = '42501';
--   end if;
--   return query
--     select
--       count(*) filter (
--         where at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
--       ) as today_count,
--       count(*) as total_count
--     from public.audit_review_log_counted
--     where actor_user_id = auth.uid()
--       and action in ('checker_pass', 'checker_fix', 'checker_split', 'checker_ask_help');
-- end;
-- $function$;
