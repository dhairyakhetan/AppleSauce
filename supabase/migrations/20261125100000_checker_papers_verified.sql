-- 20261125100000: how many PAPERS a checker has finished (owner, 25 Nov 2026: "tasks are given on number of papers, so
-- it will be easier to track; otherwise it is lowkey confusing with just the number of questions").
--
-- A paper counts as finished by a checker when:
--   * the checker gave at least one verdict on a question of it (pass, fix, printed typo, split or ask the HOD; an
--     undone verdict does not count), and
--   * nothing is left on it for students to do (verifier_has_work is false). A question waiting for the HOD does not
--     keep it open: "Your part is done" counts, like the card on My papers.
-- "Today" is the Kolkata day on which the checker last gave a verdict on that paper; "Total" is every such paper ever.
--
-- NEW function, nothing existing changes (checker_my_stats keeps its questions count). Read-only, SECURITY DEFINER,
-- search_path pinned, is_paper_checker() gate (42501), closed to public, anon AND authenticated by name, then granted to
-- authenticated. The website shows the papers count only if this answers, so it is safe to merge before or after the paste.
--
-- Rollback: drop function public.checker_my_paper_stats();

create or replace function public.checker_my_paper_stats()
returns table (papers_today bigint, papers_total bigint)
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
      (count(*) filter (where m.last_at >= v_today))::bigint as papers_today,
      count(*)::bigint as papers_total
    from (
      select l.paper_id, max(l.at) as last_at
      from public.audit_review_log_counted l
      where l.actor_user_id = auth.uid()
        and l.paper_id is not null
        and l.question_id is not null
        and l.action in ('checker_pass', 'checker_fix', 'checker_printed_typo', 'checker_split', 'checker_ask_help')
      group by l.paper_id
    ) m
    where not public.verifier_has_work(m.paper_id);
end;
$function$;

revoke all on function public.checker_my_paper_stats() from public, anon, authenticated;
grant execute on function public.checker_my_paper_stats() to authenticated;
