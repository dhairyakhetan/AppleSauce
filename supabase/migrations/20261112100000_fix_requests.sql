-- Bug and edit requests (owner, 12 Nov 2026): "If a member raises a request (ie bug or edit), HOD will have
-- to approve it first before it goes to Claude for fix (If HOD raises, ofc, it goes directly to Claude)".
-- Requests reach Claude through "a table on Supabase to read": Claude reads and updates public.fix_requests
-- with SQL at the start of a session (see docs/FIX_REQUESTS.md).
--
-- WHAT THIS ADDS
--   * public.fix_requests: one row per request. Row level security is on and EVERY privilege is revoked from
--     public, anon and authenticated by name, so the website never reads or writes the table directly.
--     Two select policies (own rows; HOD and admin see all) are kept as a second lock, in case a grant is ever
--     added by mistake. Claude and the owner reach the table as the database owner (SQL editor or the SQL tool),
--     which row security does not apply to.
--   * public.request_submit(kind, title, details, page)    a checker or an HOD sends one in. A checker's request
--                                                          waits for the HOD; an HOD's is approved at once.
--   * public.request_my_list()                             the caller's own requests, newest first.
--   * public.hod_request_list(status)                      HOD and admin: every request, newest first, 200 at most.
--   * public.hod_request_counts()                          HOD and admin: how many are in each state.
--   * public.hod_request_decide(id, approve, note)         HOD and admin: yes or no on a waiting request.
--   Every function is SECURITY DEFINER, has search_path set, checks the caller inside (42501 'Not authorized'),
--   is revoked from public, anon and authenticated by name and then granted to authenticated only
--   (the same pattern as verifier_my_papers in 20261108200000_checker_card_whole_paper.sql).
--   Deciding writes one line to audit_review_log (the HOD History tab) and the labels are added to
--   log_action_catalog.
--
-- NOT DONE HERE, ON PURPOSE
--   * Nothing notifies anyone. Claude reads the table at the start of a session.
--   * Nothing here changes any existing function, table or view.
--
-- ROLLBACK (nothing else depends on any of this):
--   drop function if exists public.request_submit(text, text, text, text);
--   drop function if exists public.request_my_list();
--   drop function if exists public.hod_request_list(text);
--   drop function if exists public.hod_request_counts();
--   drop function if exists public.hod_request_decide(uuid, boolean, text);
--   drop table if exists public.fix_requests;
--   delete from public.log_action_catalog where action in ('hod_request_approve', 'hod_request_reject');
--
-- Safe to run twice: tables and indexes use IF NOT EXISTS, functions are dropped and made again, policies are
-- dropped and made again.

begin;

-- ---------------------------------------------------------------------------
-- 1. the table

create table if not exists public.fix_requests (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  -- Who sent it. The account can be deleted later, so this lets go (set null) and the name below stays.
  raised_by        uuid references auth.users (id) on delete set null,
  raised_by_name   text check (raised_by_name is null or char_length(raised_by_name) <= 120),
  raised_as        text not null check (raised_as in ('member', 'hod')),
  kind             text not null check (kind in ('bug', 'edit')),
  title            text not null check (char_length(title) between 3 and 120),
  details          text not null default '' check (char_length(details) <= 4000),
  -- The screen it was sent from, filled in by the website.
  page_path        text check (page_path is null or char_length(page_path) <= 300),
  status           text not null default 'waiting_for_hod'
                     check (status in ('waiting_for_hod', 'approved', 'rejected', 'in_progress', 'done')),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text check (decision_note is null or char_length(decision_note) <= 500),
  -- What Claude did, written by Claude through SQL.
  claude_note      text check (claude_note is null or char_length(claude_note) <= 4000),
  done_at          timestamptz
);

create index if not exists fix_requests_status_created_idx on public.fix_requests (status, created_at);
create index if not exists fix_requests_raised_by_created_idx on public.fix_requests (raised_by, created_at);

alter table public.fix_requests enable row level security;

revoke all on table public.fix_requests from public;
revoke all on table public.fix_requests from anon;
revoke all on table public.fix_requests from authenticated;

drop policy if exists fix_requests_select_own on public.fix_requests;
create policy fix_requests_select_own on public.fix_requests
  for select to authenticated
  using (raised_by = (select auth.uid()));

drop policy if exists fix_requests_select_hod on public.fix_requests;
create policy fix_requests_select_hod on public.fix_requests
  for select to authenticated
  using (public.is_hod());

comment on table public.fix_requests is
  'Bug and edit requests. Members ask, the HOD approves, Claude fixes. Only status = approved is for Claude. See docs/FIX_REQUESTS.md.';

-- ---------------------------------------------------------------------------
-- 2. send a request in

drop function if exists public.request_submit(text, text, text, text);

create function public.request_submit(p_kind text, p_title text, p_details text, p_page text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_hod boolean;
  v_title text := btrim(coalesce(p_title, ''));
  v_details text := btrim(coalesce(p_details, ''));
  v_page text := nullif(left(btrim(coalesce(p_page, '')), 300), '');
  v_id uuid;
begin
  if v_uid is null or not (public.is_paper_checker() or public.is_hod()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  v_hod := public.is_hod();

  if p_kind is null or p_kind not in ('bug', 'edit') then
    raise exception 'Say whether something is broken or something should change.' using errcode = '22023';
  end if;
  if char_length(v_title) < 3 then
    raise exception 'Give the request a short title, at least 3 letters.' using errcode = '22023';
  end if;
  if char_length(v_title) > 120 then
    raise exception 'The title is too long. Keep it under 120 letters.' using errcode = '22023';
  end if;
  if char_length(v_details) > 4000 then
    raise exception 'The details are too long. Keep them under 4000 letters.' using errcode = '22023';
  end if;

  -- One person cannot send two at the same instant and slip past the daily limit.
  perform pg_advisory_xact_lock(hashtext('fix_requests:' || v_uid::text));
  if (select count(*) from public.fix_requests r
       where r.raised_by = v_uid and r.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'You have already sent 10 requests in the last day. Please try again tomorrow.' using errcode = '54000';
  end if;

  insert into public.fix_requests (raised_by, raised_by_name, raised_as, kind, title, details, page_path, status)
  values (v_uid, left(public.history_person_name(v_uid), 120),
          case when v_hod then 'hod' else 'member' end,
          p_kind, v_title, v_details, v_page,
          case when v_hod then 'approved' else 'waiting_for_hod' end)
  returning id into v_id;
  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. the caller's own requests

drop function if exists public.request_my_list();

create function public.request_my_list()
 returns table(id uuid, created_at timestamptz, raised_as text, kind text, title text, details text, page_path text,
               status text, decision_note text, decided_at timestamptz, claude_note text, done_at timestamptz)
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select r.id, r.created_at, r.raised_as, r.kind, r.title, r.details, r.page_path,
           r.status, r.decision_note, r.decided_at, r.claude_note, r.done_at
    from public.fix_requests r
    where r.raised_by = auth.uid()
    order by r.created_at desc
    limit 100;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. the HOD's list and counts

drop function if exists public.hod_request_list(text);

create function public.hod_request_list(p_status text default null)
 returns table(id uuid, created_at timestamptz, raised_by uuid, raised_by_name text, raised_as text, kind text,
               title text, details text, page_path text, status text, decided_by uuid, decided_by_name text,
               decided_at timestamptz, decision_note text, claude_note text, done_at timestamptz)
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('waiting_for_hod', 'approved', 'rejected', 'in_progress', 'done') then
    raise exception 'That is not a kind of request list.' using errcode = '22023';
  end if;
  return query
    select r.id, r.created_at, r.raised_by, r.raised_by_name, r.raised_as, r.kind,
           r.title, r.details, r.page_path, r.status, r.decided_by,
           case when r.decided_by is null then null else public.history_person_name(r.decided_by) end,
           r.decided_at, r.decision_note, r.claude_note, r.done_at
    from public.fix_requests r
    where p_status is null or r.status = p_status
    order by r.created_at desc
    limit 200;
end;
$function$;

drop function if exists public.hod_request_counts();

create function public.hod_request_counts()
 returns table(waiting_for_hod integer, approved integer, in_progress integer, rejected integer, done integer)
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select (count(*) filter (where r.status = 'waiting_for_hod'))::integer,
           (count(*) filter (where r.status = 'approved'))::integer,
           (count(*) filter (where r.status = 'in_progress'))::integer,
           (count(*) filter (where r.status = 'rejected'))::integer,
           (count(*) filter (where r.status = 'done'))::integer
    from public.fix_requests r;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. yes or no on a waiting request

drop function if exists public.hod_request_decide(uuid, boolean, text);

create function public.hod_request_decide(p_id uuid, p_approve boolean, p_note text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_row public.fix_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_status text;
begin
  if v_uid is null or not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Say whether the request goes ahead or not.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'The note is too long. Keep it under 500 letters.' using errcode = '22023';
  end if;
  if not p_approve and v_note is null then
    raise exception 'Say in a few words why this is not going ahead.' using errcode = '22023';
  end if;

  select * into v_row from public.fix_requests where id = p_id for update;
  if v_row.id is null then
    raise exception 'That request was not found.' using errcode = '22023';
  end if;
  if v_row.status <> 'waiting_for_hod' then
    raise exception 'This request has already been dealt with.' using errcode = '55000';
  end if;
  -- An HOD does not approve their own request (an HOD's own are approved when sent, so this is only
  -- reachable by a request they sent while still a checker). An admin may.
  if v_row.raised_by is not distinct from v_uid and not public.is_admin() then
    raise exception 'Another HOD has to decide a request you sent.' using errcode = '42501';
  end if;

  v_status := case when p_approve then 'approved' else 'rejected' end;
  update public.fix_requests
     set status = v_status, decided_by = v_uid, decided_at = now(), decision_note = v_note
   where id = p_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, v_uid, null, null,
          case when p_approve then 'hod_request_approve' else 'hod_request_reject' end,
          left(v_row.title, 120) || coalesce(' (' || v_note || ')', ''));
  return v_status;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. close every function to the outside, open it to signed-in people (the role is checked inside)

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.request_submit(text, text, text, text)',
    'public.request_my_list()',
    'public.hod_request_list(text)',
    'public.hod_request_counts()',
    'public.hod_request_decide(uuid, boolean, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- The HOD History tab's labels for the two new actions.
insert into public.log_action_catalog (action, kind, meaning) values
  ('hod_request_approve', 'admin', 'An HOD approved a bug or edit request, so it goes on to Claude'),
  ('hod_request_reject',  'admin', 'An HOD decided a bug or edit request would not go ahead')
on conflict (action) do nothing;

commit;
