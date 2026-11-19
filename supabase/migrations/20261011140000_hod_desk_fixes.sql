-- Two HOD desk fixes found by the 2026-10-11 review. Neither function changes
-- its arguments or its result columns, so CREATE OR REPLACE keeps every grant;
-- the grants are stated again at the end and checked.
--
-- 1. hod_action_history(): the role filter ran AFTER the newest-3x-limit window
--    was taken over every role, so "Admins" or "HODs" only ever saw matches that
--    happened to sit in that window (verifier rows dominate it), and the client
--    stopped offering "Load older" once a filtered page came back short. The
--    role is now decided inside the same scan, before the limit, so the limit
--    counts only matching rows. 'checker' is still accepted as an old spelling
--    of 'verifier' (the screen used to send it, and no row ever carried it, so
--    the Verifiers filter always came back empty).
--
-- 2. hod_unassign(): when the assignment was already closed or moved (another
--    HOD, the automatic return, a double click) it returned silently and the
--    screen said "Paper taken back". It now refuses, in words, and the screen
--    shows that and reloads its lists.

create or replace function public.hod_action_history(
  p_actor uuid default null, p_role text default null, p_limit integer default 200, p_before timestamptz default null
)
returns table(at timestamptz, actor_id uuid, actor_name text, actor_role text, action text, meaning text,
              paper_id uuid, paper_label text, question_id uuid, question_number text, note text, undone boolean)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_role text := case when p_role is null or btrim(p_role) = '' then null
                      when p_role = 'checker' then 'verifier'
                      else p_role end;
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    with l as (
      select x.*,
             case when exists (select 1 from public.admins ad where ad.id = x.actor_user_id) then 'admin'
                  when exists (select 1 from public.paper_hods h where h.user_id = x.actor_user_id) then 'hod'
                  else 'verifier' end as role
      from public.audit_review_log x
      where x.actor_user_id is not null
        and (p_actor is null or x.actor_user_id = p_actor)
        and (p_before is null or x.at < p_before)
        and (v_role is null
             or v_role = case when exists (select 1 from public.admins ad where ad.id = x.actor_user_id) then 'admin'
                              when exists (select 1 from public.paper_hods h where h.user_id = x.actor_user_id) then 'hod'
                              else 'verifier' end)
      order by x.at desc
      limit greatest(1, least(coalesce(p_limit, 200), 1000))
    )
    select l.at, l.actor_user_id, public.history_actor_from_key(l.actor_user_id::text) ->> 'name', l.role,
           l.action, c.meaning, l.paper_id,
           case when ap.id is null then null
                else concat_ws(' ', ap.subject, case when ap.class is not null then 'Class ' || ap.class end, ap.school, ap.year) end,
           l.question_id, q.display_number, l.note,
           (l.undone_at is not null)
    from l
    left join public.log_action_catalog c on c.action = l.action
    left join public.audit_papers ap on ap.id = l.paper_id
    left join public.audit_questions q on q.id = l.question_id
    order by l.at desc;
end;
$function$;

create or replace function public.hod_unassign(p_assignment_id bigint)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_a public.checker_assignments;
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.checker_assignments
  set status = 'returned', closed_at = now(), closed_reason = 'unassigned by the HOD'
  where id = p_assignment_id and status in ('queued', 'assigned')
  returning * into v_a;
  if v_a.id is null then
    raise exception 'That paper has already moved or been taken back. The list has been reloaded.'
      using errcode = '22023';
  end if;
  update public.audit_questions set locked_by = null, locked_until = null
  where paper_id = v_a.audit_paper_id and locked_by = v_a.user_id;
  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), v_a.audit_paper_id, null, 'hod_unassign', v_a.user_id::text);
end;
$$;

-- ---------------------------------------------------------------- grants

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.hod_action_history(uuid, text, integer, timestamptz)',
    'public.hod_unassign(bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
    if has_function_privilege('anon', to_regprocedure(f), 'EXECUTE') then
      raise exception 'anon can execute %', f;
    end if;
    if not has_function_privilege('authenticated', to_regprocedure(f), 'EXECUTE') then
      raise exception 'authenticated cannot execute %', f;
    end if;
  end loop;
  -- hod_action_history had service_role granted by 20261008170000; keep it
  grant execute on function public.hod_action_history(uuid, text, integer, timestamptz) to service_role;
end $$;
