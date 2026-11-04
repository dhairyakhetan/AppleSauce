-- Protect two named owner admin accounts, not "the earliest admin".
-- Until now the guard protected position_owner_id() (the earliest row in admins),
-- which is a different person from the owners. The protected accounts are now a
-- fixed pair, checked by position_is_owner(). Nothing else about the guard changes:
-- no self-removal, the last admin is never removed.

create or replace function public.position_is_owner(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_uid in (
    'afc150d0-327a-47a8-ae07-701e89fbbca2'::uuid,
    '19cdf8e6-c5c3-403f-93b0-46f652d62b56'::uuid
  )
$$;

revoke execute on function public.position_is_owner(uuid) from public, anon, authenticated;

create or replace function public._guard_admin_removal(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform 1 from public.admins for update;
  if p_target = auth.uid() then
    raise exception 'You cannot remove or change your own admin position. Ask another admin.' using errcode = '42501';
  end if;
  if (select count(*) from public.admins) <= 1 then
    raise exception 'The last admin cannot be removed.' using errcode = '42501';
  end if;
  if public.position_is_owner(p_target) then
    raise exception 'The owner admin account cannot be removed or changed.' using errcode = '42501';
  end if;
end $$;

revoke execute on function public._guard_admin_removal(uuid) from public, anon, authenticated;

create or replace function public.admin_position_holders()
returns table(role text, user_id uuid, email text, full_name text, since timestamptz, is_pending boolean, is_owner boolean, is_you boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  return query
  with held as (
    select 'admin'::text r, a.id uid, a.created_at s from public.admins a
    union all select 'hod',      x.user_id, x.granted_at from public.paper_hods x         where x.active
    union all select 'verifier', x.user_id, x.granted_at from public.paper_checkers x     where x.active
    union all select 'reviewer', x.user_id, x.granted_at from public.teacher_reviewers x  where x.active
  )
  select h.r, h.uid, u.email::text, nullif(btrim(p.full_name), ''), h.s,
         false, public.position_is_owner(h.uid), h.uid = auth.uid()
  from held h
  join auth.users u on u.id = h.uid
  left join public.profiles p on p.id = h.uid
  union all
  select g.role, null::uuid, g.email, null::text, g.added_at, true, false, false
  from public.pending_role_grants g
  order by 1, 5;
end $$;

revoke execute on function public.admin_position_holders() from public, anon, authenticated;
grant  execute on function public.admin_position_holders() to authenticated;
