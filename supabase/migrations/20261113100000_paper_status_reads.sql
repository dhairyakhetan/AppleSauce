-- Shikshaq: the real dates behind the new paper-status screens (13 Nov 2026).
-- Paste this whole file into the Supabase SQL editor and press Run. Then send me a picture of the 2 lines at the bottom
-- (both should say "ok").
--
-- What it adds: two functions that only READ. They change no paper, question, checker action or setting.
-- The website works without them (it shows the stage and the dates it already knows). With them it also shows:
--   1. hod_paper_timeline: the key moments of one paper with their dates:
--        loaded, pictures complete, given to a checker, finished by the checkers, approved, live.
--      Every date comes from a column that already exists (audit_papers, audit_paper_pages, checker_assignments, bank_papers).
--      "Pictures complete" is the day the last page picture was stored, and only when the paper really is complete now.
--   2. hod_paper_activity: when each checker last did anything on the paper they hold. This is what lets the HOD desk say
--      "nothing done on this for 7 days" for a paper that was started a long time ago and then dropped.
--      (Without it, only a paper the checker never started can be called stuck, so there are no false alarms.)
-- Only an HOD or an admin can use them.

create or replace function public.hod_paper_timeline(p_audit_paper uuid)
returns table(loaded_at timestamptz, pictures_at timestamptz, given_at timestamptz, finished_at timestamptz, approved_at timestamptz, live_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if not (public.is_hod() or public.is_admin()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select ap.created_at,
           case when public.paper_pictures_complete(ap.id)
                then (select max(pg.created_at) from public.audit_paper_pages pg where pg.audit_paper_id = ap.id)
           end,
           (select min(ca.assigned_at) from public.checker_assignments ca where ca.audit_paper_id = ap.id),
           ap.queued_at,
           ap.approved_at,
           (select bp.created_at from public.bank_papers bp where bp.id = ap.live_bank_paper_id and bp.is_published)
      from public.audit_papers ap
     where ap.id = p_audit_paper;
end;
$function$;

create or replace function public.hod_paper_activity()
returns table(audit_paper_id uuid, user_id uuid, last_action_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if not (public.is_hod() or public.is_admin()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select ca.audit_paper_id, ca.user_id,
           (select max(l.at) from public.audit_review_log l
             where l.paper_id = ca.audit_paper_id and l.actor_user_id = ca.user_id and l.at >= ca.assigned_at)
      from public.checker_assignments ca
     where ca.status in ('queued', 'assigned');
end;
$function$;

-- Only signed-in people can call them (and the functions check HOD or admin themselves).
revoke all on function public.hod_paper_timeline(uuid) from public, anon;
revoke all on function public.hod_paper_activity() from public, anon;
grant execute on function public.hod_paper_timeline(uuid) to authenticated;
grant execute on function public.hod_paper_activity() to authenticated;

-- CHECK: send me a picture of this result. It should show two lines, both "ok".
select 'paper timeline function' as what,
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'hod_paper_timeline') then 'ok' else 'MISSING' end as result
union all
select 'paper activity function',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'hod_paper_activity') then 'ok' else 'MISSING' end;
