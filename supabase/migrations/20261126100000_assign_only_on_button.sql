-- 20261126100000: papers are given to checkers ONLY when an HOD presses "Auto assign all".
-- Owner, 26 Nov 2026: "stop auto assigning, only auto assign when orange button is pressed".
--
-- Before: a pg_cron job ran distribute_unassigned_papers_cron() every 2 minutes, and a checker opening their list
-- ran distribute_unassigned_papers_throttled() (every 5 minutes at most). Both called distribute_unassigned_papers(),
-- which also calls verifier_return_idle() (takes back papers idle for 7 days).
--
-- After: the HOD button still calls distribute_unassigned_papers() directly (unchanged). The 2-minute job keeps its
-- schedule and name but only runs verifier_return_idle(), so the 7-day return still works. The list fallback does
-- nothing. No data row is touched. To go back to automatic hand-out, restore the two bodies from
-- 20261011100000_throttle_paper_distribution.sql.

create or replace function public.distribute_unassigned_papers_cron()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.distribution_throttle set last_run = now() where id = 1;
  -- Only the 7-day return of idle papers. No paper is given out here any more.
  perform public.verifier_return_idle();
  return 0;
end;
$function$;

create or replace function public.distribute_unassigned_papers_throttled()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Papers are given out only by the HOD's Auto assign all button now (owner, 26 Nov 2026).
  return 0;
end;
$function$;
