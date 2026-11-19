-- admin_list_checkers() declared `email text` but selected auth.users.email,
-- which is character varying, so every call failed with 42804 ("structure of
-- query does not match function result type") and the admin page showed
-- "Failed to load checkers". Only change: u.email::text.

create or replace function public.admin_list_checkers()
returns table (
  user_id uuid, email text, active boolean, granted_at timestamptz,
  passed_count bigint, fixed_count bigint, split_count bigint, escalated_count bigint
)
language plpgsql security definer stable set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select pc.user_id, u.email::text, pc.active, pc.granted_at,
           count(*) filter (where l.action = 'checker_pass'),
           count(*) filter (where l.action = 'checker_fix'),
           count(*) filter (where l.action = 'checker_split'),
           count(*) filter (where l.action = 'checker_ask_help')
    from public.paper_checkers pc
    join auth.users u on u.id = pc.user_id
    left join public.audit_review_log l on l.actor_user_id = pc.user_id
    group by pc.user_id, u.email, pc.active, pc.granted_at
    order by pc.granted_at desc;
end;
$function$;

revoke all on function public.admin_list_checkers() from public, anon, authenticated;
grant execute on function public.admin_list_checkers() to authenticated;
