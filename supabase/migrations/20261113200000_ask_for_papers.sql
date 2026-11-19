-- "Ask HOD for more papers" (owner, 13 Nov 2026): "Add an 'Ask HOD for more' button". A checker who has finished
-- everything and has no paper left taps one button; the HODs then see who is free.
--
-- WHAT THIS ADDS
--   * public.paper_asks: one row per ask. Row level security is on and EVERY privilege is revoked from public,
--     anon and authenticated by name, so the website never reads or writes the table directly.
--   * public.paper_ask_for_more()   a checker says "I am free". Returns 'asked', 'already_asked' (one open ask per
--                                   person, so tapping again never makes a second) or 'has_work' (they still hold
--                                   a paper). At most 3 asks per person per 24 hours (errcode 54000).
--   * public.paper_ask_mine()       when the caller's open ask was made (null when none), so the button can say
--                                   "already asked" after the page is opened again.
--   * public.hod_paper_asks()       HOD and admin: who is waiting for papers, oldest first, with how many papers they
--                                   finished in the last 14 days. A person who holds a paper again drops off by
--                                   itself; an ask older than 3 days is not shown (and is marked expired the next
--                                   time that person asks).
--   * public.hod_paper_ask_dismiss(id)  HOD and admin: clear one.
--   Every function is SECURITY DEFINER, has search_path set, checks the caller inside (42501 'Not authorized'),
--   is revoked from public, anon and authenticated by name and then granted to authenticated only.
--
-- NOT DONE HERE, ON PURPOSE
--   * Nothing notifies anyone (owner: alerts on the site only). The HOD desk shows the list.
--   * Nothing gives a paper out. The HOD uses the existing Assignments screen for that.
--   * Nothing here changes any existing function, table or view.
--
-- ROLLBACK (nothing else depends on any of this):
--   drop function if exists public.paper_ask_for_more();
--   drop function if exists public.paper_ask_mine();
--   drop function if exists public.hod_paper_asks();
--   drop function if exists public.hod_paper_ask_dismiss(uuid);
--   drop table if exists public.paper_asks;
--
-- Safe to run twice.

begin;

-- ---------------------------------------------------------------------------
-- 1. the table

create table if not exists public.paper_asks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  asked_at   timestamptz not null default now(),
  status     text not null default 'open' check (status in ('open', 'dismissed', 'expired')),
  closed_by  uuid,
  closed_at  timestamptz
);

-- One open ask per person, enforced by the table itself.
create unique index if not exists paper_asks_one_open_idx on public.paper_asks (user_id) where status = 'open';
create index if not exists paper_asks_user_asked_idx on public.paper_asks (user_id, asked_at);

alter table public.paper_asks enable row level security;

revoke all on table public.paper_asks from public;
revoke all on table public.paper_asks from anon;
revoke all on table public.paper_asks from authenticated;

drop policy if exists paper_asks_select_own on public.paper_asks;
create policy paper_asks_select_own on public.paper_asks
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists paper_asks_select_hod on public.paper_asks;
create policy paper_asks_select_hod on public.paper_asks
  for select to authenticated
  using (public.is_hod());

comment on table public.paper_asks is
  'A checker with no paper left tapped Ask HOD for more. One open row per person, shown to HODs for 3 days.';

-- ---------------------------------------------------------------------------
-- 2. a checker asks

create or replace function public.paper_ask_for_more()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- One person cannot ask twice at the same instant and slip past the limits.
  perform pg_advisory_xact_lock(hashtext('paper_asks:' || v_uid::text));

  -- An ask nobody answered for 3 days is old news: close it so a fresh one can be made.
  update public.paper_asks
     set status = 'expired', closed_at = now()
   where user_id = v_uid and status = 'open' and asked_at < now() - interval '3 days';

  -- Still holding a paper: there is nothing to ask for yet.
  if exists (select 1 from public.checker_assignments a
              where a.user_id = v_uid and a.status in ('queued', 'assigned')) then
    return 'has_work';
  end if;

  if exists (select 1 from public.paper_asks where user_id = v_uid and status = 'open') then
    return 'already_asked';
  end if;

  if (select count(*) from public.paper_asks
       where user_id = v_uid and asked_at > now() - interval '24 hours') >= 3 then
    raise exception 'You have already asked a few times today. The HODs can see it. Please check back tomorrow.'
      using errcode = '54000';
  end if;

  insert into public.paper_asks (user_id) values (v_uid);
  return 'asked';
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. when did I ask (so the button remembers)

create or replace function public.paper_ask_mine()
returns timestamptz
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return (select a.asked_at from public.paper_asks a
           where a.user_id = v_uid and a.status = 'open' and a.asked_at > now() - interval '3 days'
           order by a.asked_at desc limit 1);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. the HOD's list

create or replace function public.hod_paper_asks()
returns table(ask_id uuid, user_id uuid, person_name text, asked_at timestamptz, finished_recently integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select a.id,
           a.user_id,
           left(public.history_person_name(a.user_id), 120),
           a.asked_at,
           (select count(*)::int from public.checker_assignments c
             where c.user_id = a.user_id and c.status = 'done' and c.closed_at > now() - interval '14 days')
      from public.paper_asks a
     where a.status = 'open'
       and a.asked_at > now() - interval '3 days'
       -- a person who holds a paper again is no longer waiting
       and not exists (select 1 from public.checker_assignments c
                        where c.user_id = a.user_id and c.status in ('queued', 'assigned'))
     order by a.asked_at, a.id
     limit 100;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. the HOD clears one

create or replace function public.hod_paper_ask_dismiss(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  -- Clearing one that is already gone is fine: the list just refreshes.
  update public.paper_asks
     set status = 'dismissed', closed_by = auth.uid(), closed_at = now()
   where id = p_id and status = 'open';
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. who may call what: signed-in people only; each function checks the role inside

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.paper_ask_for_more()',
    'public.paper_ask_mine()',
    'public.hod_paper_asks()',
    'public.hod_paper_ask_dismiss(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

commit;
