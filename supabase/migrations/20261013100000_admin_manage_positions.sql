-- Admins manage who holds which position, from the Admin page (People tab).
--
-- Positions: admin (public.admins), HOD (paper_hods), verifier (paper_checkers),
-- teacher reviewer (teacher_reviewers). Role codes in the API: admin, hod,
-- verifier, reviewer.
--
-- 1. public.pending_verifier_grants is generalised into public.pending_role_grants
--    (email, role). The two rows already there move across as verifier. The
--    trigger becomes role-aware and keeps its rules: Google sign-in only, email
--    confirmed, and it NEVER blocks a sign-in or sign-up (every failure is
--    swallowed; a grant that fails stays pending and is retried next time).
-- 2. Four admin_* functions: list holders, grant, revoke, change. Each is
--    SECURITY DEFINER, search_path = public, pg_temp, checks is_admin() inside
--    (42501), and is closed to public, anon and authenticated, then granted to
--    authenticated only. Every change writes admin_audit_log with the acting
--    admin (auth.uid()).
-- 3. Safety: an admin cannot remove or demote themselves, the last admin can
--    never be removed, and the owner (earliest row in public.admins) cannot be
--    removed by anyone.
--
-- Rehearse in a rolled-back transaction before applying.

-- ---------------------------------------------------------------- pending table

create table if not exists public.pending_role_grants (
  email    text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  role     text not null check (role in ('admin', 'hod', 'verifier', 'reviewer')),
  added_at timestamptz not null default now(),
  added_by uuid references auth.users (id) on delete set null,
  primary key (email, role)
);
alter table public.pending_role_grants enable row level security;
-- No policies: only the SECURITY DEFINER functions below read or write it.
revoke all on public.pending_role_grants from public, anon, authenticated;

insert into public.pending_role_grants (email, role, added_at)
select lower(btrim(email)), 'verifier', added_at
from public.pending_verifier_grants
on conflict do nothing;

-- ------------------------------------------------------------ internal helpers
-- Closed to every API role: only the definer functions below call them.

create or replace function public.position_owner_id()
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$ select id from public.admins order by created_at, id limit 1 $$;

create or replace function public._holds_position(p_user_id uuid, p_role text)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select case p_role
    when 'admin'    then exists (select 1 from public.admins a where a.id = p_user_id)
    when 'hod'      then exists (select 1 from public.paper_hods x where x.user_id = p_user_id and x.active)
    when 'verifier' then exists (select 1 from public.paper_checkers x where x.user_id = p_user_id and x.active)
    when 'reviewer' then exists (select 1 from public.teacher_reviewers x where x.user_id = p_user_id and x.active)
    else false
  end
$$;

create or replace function public._grant_position(p_user_id uuid, p_role text, p_by uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if p_role = 'admin' then
    insert into public.admins (id) values (p_user_id) on conflict (id) do nothing;
  elsif p_role = 'hod' then
    insert into public.paper_hods (user_id, active, granted_by, granted_at, revoked_at)
    values (p_user_id, true, p_by, now(), null)
    on conflict (user_id) do update set active = true, granted_by = p_by, granted_at = now(), revoked_at = null;
  elsif p_role = 'verifier' then
    insert into public.paper_checkers (user_id, active, granted_by, granted_at, revoked_at)
    values (p_user_id, true, p_by, now(), null)
    on conflict (user_id) do update set active = true, granted_by = p_by, granted_at = now(), revoked_at = null;
  elsif p_role = 'reviewer' then
    insert into public.teacher_reviewers (user_id, active, granted_by, granted_at, revoked_at)
    values (p_user_id, true, p_by, now(), null)
    on conflict (user_id) do update set active = true, granted_by = p_by, granted_at = now(), revoked_at = null;
  else
    raise exception 'Unknown position' using errcode = '22023';
  end if;
end $$;

create or replace function public._revoke_position(p_user_id uuid, p_role text)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if p_role = 'admin' then
    delete from public.admins where id = p_user_id;
  elsif p_role = 'hod' then
    update public.paper_hods set active = false, revoked_at = now() where user_id = p_user_id and active;
  elsif p_role = 'verifier' then
    update public.paper_checkers set active = false, revoked_at = now() where user_id = p_user_id and active;
  elsif p_role = 'reviewer' then
    update public.teacher_reviewers set active = false, revoked_at = now() where user_id = p_user_id and active;
  else
    raise exception 'Unknown position' using errcode = '22023';
  end if;
end $$;

-- The audit target type each position already uses in admin_audit_log.
create or replace function public._position_target_type(p_role text)
returns text language sql immutable
set search_path = public, pg_temp
as $$
  select case p_role when 'admin' then 'admin' when 'hod' then 'hod'
                     when 'verifier' then 'checker' else 'teacher_reviewer' end
$$;

create or replace function public._position_audit(p_verb text, p_role text, p_target_id text, p_email text, p_reason text)
returns void language sql security definer
set search_path = public, pg_temp
as $$
  insert into public.admin_audit_log (actor_id, actor_name, action, target_type, target_id, target_label, reason)
  values (auth.uid(), public.reviewer_actor_name(), p_verb || '_' || public._position_target_type(p_role),
          public._position_target_type(p_role), p_target_id, p_email, p_reason);
$$;

-- The three refusals for taking the admin position away from someone. Locks the
-- admins rows first so two admins cannot race each other past the last-admin check.
create or replace function public._guard_admin_removal(p_target uuid)
returns void language plpgsql security definer
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
  if p_target = public.position_owner_id() then
    raise exception 'The owner admin account cannot be removed or changed.' using errcode = '42501';
  end if;
end $$;

revoke execute on function public.position_owner_id()                               from public, anon, authenticated;
revoke execute on function public._holds_position(uuid, text)                       from public, anon, authenticated;
revoke execute on function public._grant_position(uuid, text, uuid)                 from public, anon, authenticated;
revoke execute on function public._revoke_position(uuid, text)                      from public, anon, authenticated;
revoke execute on function public._position_target_type(text)                       from public, anon, authenticated;
revoke execute on function public._position_audit(text, text, text, text, text)     from public, anon, authenticated;
revoke execute on function public._guard_admin_removal(uuid)                        from public, anon, authenticated;

-- ---------------------------------------------------------------- the trigger

create or replace function public.apply_pending_role_grants()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  g record;
  v_email text;
begin
  begin
    if new.email is not null
       and new.email_confirmed_at is not null
       and coalesce(new.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google' then
      v_email := lower(btrim(new.email));
      for g in select role from public.pending_role_grants where email = v_email loop
        begin
          perform public._grant_position(new.id, g.role, null);
          delete from public.pending_role_grants where email = v_email and role = g.role;
          insert into public.admin_audit_log (actor_id, actor_name, action, target_type, target_id, target_label, reason)
          values (null, 'Automatic, first Google sign-in', 'grant_' || public._position_target_type(g.role),
                  public._position_target_type(g.role), new.id::text, v_email,
                  'A pending grant applied when this email first signed in with Google.');
          if g.role = 'verifier' then
            insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
            values (null, null, null, null, 'admin_add_checker', v_email || ' (auto-granted on first Google sign-in)');
          end if;
        exception when others then
          null; -- this one stays pending and is retried on the next sign-in
        end;
      end loop;
    end if;
  exception when others then
    null; -- never block a sign-in or sign-up
  end;
  return new;
end $$;

revoke execute on function public.apply_pending_role_grants() from public, anon, authenticated;

drop trigger if exists pending_verifier_grant on auth.users;
create trigger pending_role_grant
  after insert or update of raw_app_meta_data, email_confirmed_at on auth.users
  for each row execute function public.apply_pending_role_grants();

drop function if exists public.apply_pending_verifier_grant();
drop table if exists public.pending_verifier_grants;

-- ------------------------------------------------------------ admin functions

create or replace function public.admin_position_holders()
returns table (role text, user_id uuid, email text, full_name text, since timestamptz,
               is_pending boolean, is_owner boolean, is_you boolean)
language plpgsql stable security definer
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
         false, h.uid = public.position_owner_id(), h.uid = auth.uid()
  from held h
  join auth.users u on u.id = h.uid
  left join public.profiles p on p.id = h.uid
  union all
  select g.role, null::uuid, g.email, null::text, g.added_at, true, false, false
  from public.pending_role_grants g
  order by 1, 5;
end $$;

create or replace function public.admin_grant_position(p_email text, p_role text)
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_uid uuid;
  v_confirmed timestamptz;
begin
  if not public.is_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_role not in ('admin', 'hod', 'verifier', 'reviewer') then
    raise exception 'Unknown position' using errcode = '22023';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a full email address.' using errcode = '22023';
  end if;
  select id, email_confirmed_at into v_uid, v_confirmed from auth.users where lower(email) = v_email;

  if v_uid is not null and v_confirmed is not null then
    if public._holds_position(v_uid, p_role) then
      raise exception 'That person already holds that position.' using errcode = '23505';
    end if;
    perform public._grant_position(v_uid, p_role, auth.uid());
    perform public._position_audit('grant', p_role, v_uid::text, v_email, null);
    return 'granted';
  end if;

  -- No account yet, or an account whose email is not confirmed: wait for the
  -- first confirmed Google sign-in with this email.
  if exists (select 1 from public.pending_role_grants where email = v_email and role = p_role) then
    raise exception 'That grant is already waiting for their first Google sign-in.' using errcode = '23505';
  end if;
  insert into public.pending_role_grants (email, role, added_by) values (v_email, p_role, auth.uid());
  perform public._position_audit('grant', p_role, v_email, v_email, 'Pending: applies on first Google sign-in.');
  return 'pending';
end $$;

create or replace function public.admin_revoke_position(p_email text, p_role text)
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_uid uuid;
begin
  if not public.is_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_role not in ('admin', 'hod', 'verifier', 'reviewer') then
    raise exception 'Unknown position' using errcode = '22023';
  end if;
  select id into v_uid from auth.users where lower(email) = v_email;

  if v_uid is not null and public._holds_position(v_uid, p_role) then
    if p_role = 'admin' then perform public._guard_admin_removal(v_uid); end if;
    perform public._revoke_position(v_uid, p_role);
    perform public._position_audit('revoke', p_role, v_uid::text, v_email, null);
    return 'removed';
  end if;

  if exists (select 1 from public.pending_role_grants where email = v_email and role = p_role) then
    delete from public.pending_role_grants where email = v_email and role = p_role;
    perform public._position_audit('revoke', p_role, v_email, v_email, 'Pending grant cancelled before it applied.');
    return 'pending_removed';
  end if;

  raise exception 'They do not hold that position.' using errcode = 'P0002';
end $$;

-- Change one position to another in a single transaction: if the new one cannot
-- be given, the old one is not taken away.
create or replace function public.admin_change_position(p_email text, p_from text, p_to text)
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_uid uuid;
  v_why text;
begin
  if not public.is_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_from not in ('admin', 'hod', 'verifier', 'reviewer') or p_to not in ('admin', 'hod', 'verifier', 'reviewer') then
    raise exception 'Unknown position' using errcode = '22023';
  end if;
  if p_from = p_to then
    raise exception 'Pick a different position to change to.' using errcode = '22023';
  end if;
  v_why := 'Changed from ' || p_from || ' to ' || p_to || '.';
  select id into v_uid from auth.users where lower(email) = v_email;

  if v_uid is not null and public._holds_position(v_uid, p_from) then
    if public._holds_position(v_uid, p_to) then
      raise exception 'That person already holds that position.' using errcode = '23505';
    end if;
    if p_from = 'admin' then perform public._guard_admin_removal(v_uid); end if;
    perform public._revoke_position(v_uid, p_from);
    perform public._position_audit('revoke', p_from, v_uid::text, v_email, v_why);
    perform public._grant_position(v_uid, p_to, auth.uid());
    perform public._position_audit('grant', p_to, v_uid::text, v_email, v_why);
    return 'changed';
  end if;

  if exists (select 1 from public.pending_role_grants where email = v_email and role = p_from) then
    if exists (select 1 from public.pending_role_grants where email = v_email and role = p_to) then
      raise exception 'That grant is already waiting for their first Google sign-in.' using errcode = '23505';
    end if;
    delete from public.pending_role_grants where email = v_email and role = p_from;
    insert into public.pending_role_grants (email, role, added_by) values (v_email, p_to, auth.uid());
    perform public._position_audit('revoke', p_from, v_email, v_email, 'Pending ' || v_why);
    perform public._position_audit('grant', p_to, v_email, v_email, 'Pending ' || v_why);
    return 'pending_changed';
  end if;

  raise exception 'They do not hold that position.' using errcode = 'P0002';
end $$;

revoke execute on function public.admin_position_holders()                  from public, anon, authenticated;
revoke execute on function public.admin_grant_position(text, text)          from public, anon, authenticated;
revoke execute on function public.admin_revoke_position(text, text)         from public, anon, authenticated;
revoke execute on function public.admin_change_position(text, text, text)   from public, anon, authenticated;
grant  execute on function public.admin_position_holders()                  to authenticated;
grant  execute on function public.admin_grant_position(text, text)          to authenticated;
grant  execute on function public.admin_revoke_position(text, text)         to authenticated;
grant  execute on function public.admin_change_position(text, text, text)   to authenticated;
