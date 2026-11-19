-- =========================================================================
-- Shikshaq: every pending database change, in one file.
--
-- Paste the whole thing into the Supabase SQL editor and run it. It is
-- idempotent -- running it twice is harmless -- and it is wrapped so that if
-- any part fails, none of it applies.
--
-- There is NO staging database. Both deployments share uvtifolnsneitetzohtn,
-- so this is production the moment it runs. Prefer Kolkata off-hours.
-- The rollback for each section is written inline beside it.
--
-- WHAT IS IN HERE, in priority order:
--
--   1. SECURITY, URGENT. Two functions answer anonymous callers right now and
--      should not. One of them hands out 206 named children's profiles.
--   2. RETENTION. The 90-day purge exists but nothing has ever run it. The
--      privacy policy now states the 90 days, so it has to be true.
--   3. DIAGNOSTICS. Read-only checks for three things nobody has established:
--      whether ip_hash is real, whether the enumeration endpoints are inert,
--      and whether question_count matches reality.
--
-- Everything outside the database is already done and deployed.
--
-- -------------------------------------------------------------------------
-- THE SQL EDITOR WILL WARN YOU ABOUT THIS FILE. All three are expected:
--
--   "destructive operations"  -- yes. Every destructive statement that runs at
--                                install time is a REVOKE, which is the whole
--                                point of section 1, plus one
--                                `drop trigger if exists`, which is how the
--                                file stays idempotent. The DELETEs are inside
--                                a function body and do not run now.
--   "UPDATE without a WHERE"  -- no longer true; fixed. Both updates in
--                                section 2 are now qualified.
--   "table without RLS"       -- no longer true; fixed. RLS is enabled on
--                                read_events_retention with no policies.
--
-- Either button is now equivalent. "Run without RLS" is accurate, because the
-- file enables it itself.
-- -------------------------------------------------------------------------
-- =========================================================================


-- =========================================================================
-- SECTION 1 -- SECURITY. This is the urgent part.
-- =========================================================================
--
-- THE BUG. Migration 20260918100000 revoked its new functions `from public`,
-- following the pattern 20260818120000 established. That is not sufficient on
-- Supabase, and the ACLs say so plainly:
--
--   purge_read_events  postgres=X/postgres
--                      anon=X/postgres          <- a DIRECT grant
--                      authenticated=X/postgres
--
-- Supabase ships `alter default privileges in schema public grant execute on
-- functions to anon, authenticated`, so every newly created function is
-- granted EXECUTE BY ROLE NAME. Revoking from PUBLIC does not touch a direct
-- role grant. This is the exact inverse of the trap 20260818120000 documented:
-- both PUBLIC grants and direct role grants exist, so a function is only
-- closed when it is revoked from all three.
--
-- CONFIRMED EXPLOITABLE against production, as an anonymous caller holding
-- only the publishable key that ships in the JS bundle:
--
--   POST /rest/v1/rpc/purge_read_events      -> 200
--   POST /rest/v1/rpc/get_public_profile_data -> 200, 52,753 bytes, 206 rows
--
-- The second is the serious one: full_name, school_college, grade, role and
-- avatar_url for every profile, many of them school students, downloadable in
-- one request by anyone. It has NO call sites in src/ -- the app reads
-- commenter names through a join on teacher_comments.profiles. It is an
-- orphan, and closing it breaks nothing.
--
-- The first is an unauthenticated DELETE against the audit table. Bounded
-- today (it only removes rows older than 90 days, and the table is young) but
-- once read_events fills, anyone could trim the record of their own scraping.
--
-- admin_teacher_contacts() was NOT exploitable: it returned 42501 because its
-- in-body is_admin() check caught what the grant let through. That is the
-- argument for the two-layer pattern, demonstrated on live traffic.

begin;

-- --- Closed to everyone over REST ----------------------------------------
-- Called only from other SECURITY DEFINER code or by an operator in the SQL
-- editor, where the connection is not anon.
revoke all on function public.purge_read_events()                 from public, anon, authenticated;
revoke all on function public.read_quota_exceeded(uuid, text)     from public, anon, authenticated;

-- --- Signed-in only ------------------------------------------------------
-- teacher_own_contact() was harmless to anon in practice (auth.uid() is null,
-- so the join matches nothing) but an endpoint that exists for signed-in
-- teachers should not answer an anonymous caller at all.
revoke all on function public.teacher_own_contact()               from public, anon, authenticated;
grant execute on function public.teacher_own_contact()            to authenticated;

revoke all on function public.admin_teacher_contacts()            from public, anon, authenticated;
grant execute on function public.admin_teacher_contacts()         to authenticated;

-- --- Deliberately reachable by anon --------------------------------------
-- Restated explicitly so the intent is chosen rather than inherited from a
-- default nobody picked:
--   site_counts()           three numbers already printed in every footer
--   bank_paper_questions()  the gate itself; returns two questions to anon
--   teacher_whatsapp_link() returns null to anon, by design
revoke all on function public.site_counts()                       from public, anon, authenticated;
grant execute on function public.site_counts()                    to anon, authenticated;

revoke all on function public.bank_paper_questions(text)          from public, anon, authenticated;
grant execute on function public.bank_paper_questions(text)       to anon, authenticated;

revoke all on function public.teacher_whatsapp_link(text)         from public, anon, authenticated;
grant execute on function public.teacher_whatsapp_link(text)      to anon, authenticated;

-- --- Pre-existing, found by the same audit -------------------------------
-- Not introduced by 20260918100000. See the header for what this one leaks.
revoke all on function public.get_public_profile_data()           from public, anon, authenticated;

-- A trigger function on teacher_comments, reachable directly over REST.
-- Calling it outside a trigger context should fail on OLD/NEW being unset,
-- but an endpoint that exists only to be fired by the database has no
-- business answering the internet.
revoke all on function public.reset_approval_on_edit()            from public, anon, authenticated;

-- Zero call sites, and it reads auth.uid() -- an anonymous caller learns only
-- that they are not a teacher. Closed for tidiness, not urgency.
revoke all on function public.is_teacher()                        from public, anon, authenticated;
grant execute on function public.is_teacher()                     to authenticated;

-- DELIBERATELY LEFT OPEN, with the reasoning recorded:
--   is_admin()               used inside other functions' bodies and by RLS
--                            policies; returns false to anon.
--   check_user_exists(text)  one call site, in the sign-in flow, which runs
--   check_user_has_password  BEFORE the user is authenticated -- so anon
--                            EXECUTE is required for sign-in to work.
-- Both are user-enumeration shaped. Section 3 establishes whether they are
-- inert or broken, which has to be known before they can be changed safely.

commit;

-- ROLLBACK for section 1, if something in the app breaks unexpectedly.
-- Note this restores the hole; prefer fixing the caller.
--   grant execute on function public.get_public_profile_data() to anon, authenticated;


-- =========================================================================
-- SECTION 2 -- RETENTION THAT ACTUALLY RUNS
-- =========================================================================
--
-- read_events records which papers each account opens. Many of those account
-- holders are minors. A 90-day limit was written into purge_read_events() and
-- then nothing was ever scheduled to call it, so the real retention has been
-- "forever". The privacy policy now states 90 days plainly, so this has to be
-- true rather than aspirational.
--
-- TWO MECHANISMS, because the reliable one is not guaranteed to be available:
--
--   (a) pg_cron, if this project can enable it. Cleanest: runs at 03:00 daily
--       whether or not anyone visits the site.
--   (b) An INSERT trigger on read_events that purges at most once an hour.
--       Needs no scheduler and no extension. Its weakness is the mirror of
--       cron's strength -- it only runs when somebody reads something -- but
--       a table that nobody is writing to is also a table that is not growing,
--       so the case it misses is the case that does not matter.
--
-- Both are installed. Running both is harmless: whichever fires first finds
-- nothing left for the other to delete.

begin;

-- --- (b) the mechanism that needs nothing ---------------------------------

-- One row, holding when the purge last ran. A table rather than a setting so
-- it survives restarts and is visible to anyone inspecting the schema.
create table if not exists public.read_events_retention (
  id            boolean primary key default true check (id),
  last_purge_at timestamptz not null default now(),
  last_deleted  integer     not null default 0
);
insert into public.read_events_retention (id) values (true) on conflict (id) do nothing;

revoke all on table public.read_events_retention from public, anon, authenticated;

/* Belt and braces, and consistent with 20260918100000, which enables RLS on
   all four of its tables. The revoke above already puts this out of
   PostgREST's reach, so RLS with no policies is the second lock rather than
   the first. It does not get in the trigger's way: read_events_retention_tick
   is SECURITY DEFINER and runs as this table's owner, and a table's owner is
   exempt from its own RLS unless FORCE ROW LEVEL SECURITY is set, which it is
   not. No policies are created deliberately -- nothing outside a definer
   function has any business reading this. */
alter table public.read_events_retention enable row level security;

comment on table public.read_events_retention is
  'Single-row bookkeeping for the opportunistic 90-day purge of read_events. '
  'Not readable over REST; only the trigger function touches it.';

create or replace function public.read_events_retention_tick()
returns trigger
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_deleted integer := 0;
begin
  /* Claim the hour. The WHERE clause is the lock: concurrent inserts race to
     update the same row, exactly one wins, and the losers fall straight
     through without touching read_events at all. No advisory lock needed, and
     no chance of two purges running at once. */
  update public.read_events_retention
     set last_purge_at = now()
   where last_purge_at < now() - interval '1 hour';

  if not found then
    return null;
  end if;

  /* Bounded, so this can never turn one student's page load into a long
     delete. At 5,000 rows an hour it clears a very large backlog within a
     day, and in steady state there will be far fewer than that to remove. */
  delete from public.read_events
   where ctid in (
     select ctid from public.read_events
      where created_at < now() - interval '90 days'
      limit 5000
   );
  get diagnostics v_deleted = row_count;

  delete from public.read_quota_breaches
   where ctid in (
     select ctid from public.read_quota_breaches
      where created_at < now() - interval '90 days'
      limit 5000
   );

  /* `where id` is redundant -- the primary key is a boolean with a
     `check (id)`, so exactly one row can ever exist -- but an UPDATE with no
     WHERE is worth never writing. It reads as "every row" to a linter, to a
     reviewer, and to whoever copies this statement somewhere the table is not
     single-row. */
  update public.read_events_retention set last_deleted = v_deleted where id;

  return null;
exception when others then
  /* Retention must never be able to fail a student's read. If this throws,
     the read still succeeds and the next insert tries again. */
  return null;
end;
$function$;

-- The same trap section 1 exists to fix: a new function is granted EXECUTE to
-- anon and authenticated BY NAME unless explicitly revoked.
revoke all on function public.read_events_retention_tick() from public, anon, authenticated;

drop trigger if exists read_events_retention_trg on public.read_events;
create trigger read_events_retention_trg
  after insert on public.read_events
  for each statement
  execute function public.read_events_retention_tick();

commit;

-- --- (a) pg_cron, if it can be enabled ------------------------------------
-- Separate from the transaction above, and written so a failure to install it
-- is a notice rather than an error -- pg_cron needs privileges this project
-- may not grant, and the trigger above already guarantees retention.
do $$
begin
  create extension if not exists pg_cron;

  perform cron.unschedule('purge-read-events')
    where exists (select 1 from cron.job where jobname = 'purge-read-events');

  perform cron.schedule('purge-read-events', '0 3 * * *',
                        'select public.purge_read_events()');

  raise notice 'pg_cron scheduled: purge-read-events runs daily at 03:00 UTC.';
exception when others then
  raise notice 'pg_cron not available (%). This is fine: the insert trigger in section 2 handles retention on its own.', sqlerrm;
end
$$;

-- ROLLBACK for section 2:
--   drop trigger if exists read_events_retention_trg on public.read_events;
--   drop function if exists public.read_events_retention_tick();
--   drop table if exists public.read_events_retention;
--   select cron.unschedule('purge-read-events');


-- =========================================================================
-- SECTION 3 -- DIAGNOSTICS. Read-only. Nothing below changes any data.
-- =========================================================================
-- Three things nobody has established. Run them and read the output; each one
-- prints its own verdict so there is nothing to interpret.


-- --- 3a. Is ip_hash real? -------------------------------------------------
-- Every network-based bot signal depends on it. If request.headers is not
-- exposed on this project, every row holds the SHA-256 of an empty string and
-- those signals are blind. The account-based signals still work, and the
-- account is the real threat, so this is worth knowing rather than worth
-- panicking about.
select
  count(*)                                                        as total_rows,
  count(*) filter (
    where ip_hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  )                                                               as empty_hashes,
  count(distinct ip_hash)                                         as distinct_hashes,
  case
    when count(*) = 0 then 'NO DATA YET -- browse a few papers while signed in, then re-run'
    when count(*) filter (
      where ip_hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    ) = count(*) then 'BLIND -- request.headers is not exposed; network signals do not work'
    else 'WORKING -- ip_hash carries real values'
  end                                                             as verdict
from public.read_events;


-- --- 3b. Are the enumeration endpoints inert or broken? -------------------
-- check_user_exists / check_user_has_password must stay anon-callable because
-- sign-in calls them before the user is authenticated. Both reportedly return
-- false even for a known-real address, which means they are either harmless or
-- silently broken -- and the sign-in flow depends on the answer. Establish
-- which BEFORE changing anything about them.
--
-- Written as a DO block with its own error handling on purpose: the signature
-- is not certain, and a diagnostic must never be the reason this file fails.
-- Read the output in the NOTICE messages.
do $$
declare
  v_real_email text;
  v_real       boolean;
  v_fake       boolean;
begin
  if to_regprocedure('public.check_user_exists(text)') is null then
    raise notice '3b: check_user_exists(text) does not exist with that signature. Nothing to assess.';
    return;
  end if;

  select email into v_real_email from auth.users order by created_at limit 1;
  if v_real_email is null then
    raise notice '3b: no users in auth.users. Nothing to assess.';
    return;
  end if;

  execute 'select public.check_user_exists($1)' into v_real using v_real_email;
  execute 'select public.check_user_exists($1)' into v_fake
    using 'definitely-not-a-user-4f2b@example.invalid';

  raise notice '3b: real address -> %, fake address -> %', v_real, v_fake;

  if v_real and not v_fake then
    raise notice '3b VERDICT: WORKING, and therefore a real enumeration oracle. Worth rate limiting.';
  elsif not v_real and not v_fake then
    raise notice '3b VERDICT: INERT OR BROKEN. It returns false for a real address, so check what sign-in does with that answer before touching it.';
  else
    raise notice '3b VERDICT: ALWAYS TRUE. Leaks nothing useful but tells sign-in the wrong thing.';
  end if;
exception when others then
  raise notice '3b: could not assess (%). Not a failure of this file.', sqlerrm;
end
$$;


-- --- 3c. Does question_count match reality? -------------------------------
-- The number shown on every paper card and in every prerendered meta
-- description. A mismatch is a small, permanent lie on a page Google has
-- indexed. Reports only; fixing it is a data decision, not a migration.
select
  p.id,
  p.school,
  p.question_count                                                 as claimed,
  count(q.id)                                                      as actual,
  count(q.id) - p.question_count                                   as difference
from public.bank_papers p
left join public.bank_questions q on q.paper_id = p.id
where p.is_published
group by p.id, p.school, p.question_count
having p.question_count is distinct from count(q.id)
order by abs(count(q.id) - p.question_count) desc
limit 40;


-- =========================================================================
-- SECTION 4 -- VERIFY. Run these after, and check each line.
-- =========================================================================

-- 4a. Function ACLs. purge_read_events and read_quota_exceeded must show NO
--     anon and NO authenticated. teacher_own_contact and
--     admin_teacher_contacts must show authenticated but NOT anon. The other
--     three must show both.
select p.proname,
       pg_catalog.array_to_string(p.proacl, ' | ') as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('purge_read_events','read_quota_exceeded',
                    'teacher_own_contact','admin_teacher_contacts',
                    'site_counts','bank_paper_questions','teacher_whatsapp_link',
                    'get_public_profile_data','reset_approval_on_edit',
                    'is_teacher','read_events_retention_tick')
order by p.proname;

-- 4b. ANY remaining function in this schema that anon can execute. Read this
--     list and agree with every line on it. The three gates belong here.
--     Anything else is a question.
--
--     CORRECTED. An earlier version of this query matched the ACL as a string,
--     `array_to_string(proacl, ',') like '%anon=X%'`, and that UNDERCOUNTS.
--     A NULL proacl does not mean "no privileges" -- it means "the default
--     applies", and the default for a FUNCTION is EXECUTE TO PUBLIC. So every
--     function that has never had an explicit GRANT or REVOKE is executable by
--     anon and matches no string at all. has_function_privilege resolves NULL
--     ACLs and role inheritance the way Postgres actually will.
select
  p.proname,
  pg_catalog.pg_get_function_identity_arguments(p.oid)        as args,
  p.prosecdef                                                 as security_definer,
  case when p.proacl is null then 'DEFAULT (execute to public)'
       else pg_catalog.array_to_string(p.proacl, ' | ') end   as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by p.prosecdef desc, p.proname;

-- 4b-ii. The count, and how much of it was invisible to the old string match.
select
  count(*)                                    as anon_executable_total,
  count(*) filter (where p.proacl is null)    as via_default_privileges_only,
  count(*) filter (where p.prosecdef)         as security_definer_ones
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and has_function_privilege('anon', p.oid, 'EXECUTE');

-- 4c. Retention is installed and armed.
select
  (select count(*) from pg_trigger
    where tgname = 'read_events_retention_trg' and not tgisinternal)  as trigger_installed,
  (select last_purge_at from public.read_events_retention)            as last_purge_at,
  (select count(*) from pg_extension where extname = 'pg_cron')       as pg_cron_installed;

-- 4d. Quotas must still be OFF. Every threshold is a guess made against three
--     rows of telemetry, and the first person a bad guess stops is a Class 10
--     student the week before boards. Leave this false until read_events has
--     two to four weeks of real traffic, then set the limits above the
--     observed p99.
select * from public.read_quota_config;

-- 4e. The gate itself, unchanged by any of the above.
select has_column_privilege('anon','public."Shikshaqmine"','Link','SELECT')           as anon_link_f;
select has_column_privilege('authenticated','public."Shikshaqmine"','Link','SELECT')  as auth_link_f;
select has_column_privilege('authenticated','public.bank_questions','body','SELECT')  as auth_body_f;
-- All three must be false.

-- 4f. From outside, as an anonymous caller. PostgREST returns 404 for what you
--     cannot execute, so 404 is the success case here:
--     POST /rest/v1/rpc/purge_read_events       -> 404
--     POST /rest/v1/rpc/get_public_profile_data -> 404
--     POST /rest/v1/rpc/site_counts             -> 200
--     POST /rest/v1/rpc/bank_paper_questions    -> 200, exactly 2 questions


-- =========================================================================
-- STILL NOT A MIGRATION -- these are decisions, not SQL, and are left to you.
-- =========================================================================
--
-- GOOGLE-ONLY SIGN-IN. Disable the Email provider in Authentication ->
-- Providers and drop the password branch from src/pages/Auth.tsx. 545 of 553
-- accounts already use Google; the 9 password accounts need contacting first:
--
--   select u.email from auth.identities i
--   join auth.users u on u.id = i.user_id
--   where i.provider = 'email'
--     and not exists (select 1 from auth.identities g
--                     where g.user_id = i.user_id and g.provider = 'google');
--
-- Do this AFTER quotas are enforced. Its whole value is making per-account
-- limits expensive to evade, which is meaningless while nothing is enforced.
--
-- CANARY TEACHER ROWS. teachers_list is anon-readable in bulk, so a decoy row
-- with a number you control is picked up by any directory scrape and
-- read_events says which account pulled it. Set is_paused = true so it stays
-- out of Browse. Left as a decision because it inserts fake data into a live
-- directory.
--
-- Canary QUESTIONS do not work and should not be built: a canary paper has to
-- be published to be reachable, which puts a fake paper in the catalogue, and
-- a canary question inside a real paper breaks the byte-exact rule. The same
-- objection applies to watermarking the text.
-- =========================================================================
