-- Corrective. Apply immediately after 20260918100000.
--
-- THE BUG: that migration used `revoke all on function ... from public` on
-- every function it created, which is the pattern 20260818120000 established.
-- It is not sufficient here, and the ACLs say so plainly:
--
--   purge_read_events  postgres=X/postgres
--                      anon=X/postgres          <- direct grant, not inherited
--                      authenticated=X/postgres
--                      service_role=X/postgres
--
-- Supabase ships `alter default privileges in schema public grant execute on
-- functions to anon, authenticated`, so a newly created function gets EXECUTE
-- granted to those roles BY NAME. Revoking from PUBLIC does not touch a direct
-- role grant, so every new function was reachable over REST by anyone holding
-- the publishable key -- which is everyone, since it ships in the bundle.
--
-- This is the exact inverse of the trap 20260818120000 documented. That one
-- warned that revoking from the role names alone is a no-op because they
-- inherit from PUBLIC. Both are true at once: PUBLIC grants exist AND direct
-- role grants exist, so a function is only closed when revoked from all three.
-- Doing one and not the other is what happened here.
--
-- CONFIRMED EXPLOITABLE before this was written, as an anonymous caller:
--   POST /rest/v1/rpc/purge_read_events     -> HTTP 200, returned 0
--   POST /rest/v1/rpc/read_quota_exceeded   -> HTTP 200
-- The first is an unauthenticated DELETE against the audit table. Its blast
-- radius was bounded -- it only removes rows older than 90 days, and the table
-- was empty -- but once read_events fills, anyone could have trimmed the
-- evidence of their own scraping.
--
-- admin_teacher_contacts() was NOT exploitable: it returned 42501 because its
-- in-body is_admin() check caught what the grant had let through. That is the
-- whole argument for the two-layer pattern, demonstrated on live traffic.

begin;

-- ---------------------------------------------------------------------------
-- Closed to everyone over REST. Called only from other SECURITY DEFINER code
-- or by an operator in the SQL editor, where the connection is not anon.
-- ---------------------------------------------------------------------------
revoke all on function public.purge_read_events()                 from public, anon, authenticated;
revoke all on function public.read_quota_exceeded(uuid, text)     from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Signed-in only. teacher_own_contact() was harmless to anon in practice
-- (auth.uid() is null, so the join matches nothing and it returns no rows) but
-- an endpoint that exists for signed-in teachers should not answer an
-- anonymous caller at all.
-- ---------------------------------------------------------------------------
revoke all on function public.teacher_own_contact()               from public, anon, authenticated;
grant execute on function public.teacher_own_contact()            to authenticated;

revoke all on function public.admin_teacher_contacts()            from public, anon, authenticated;
grant execute on function public.admin_teacher_contacts()         to authenticated;

-- ---------------------------------------------------------------------------
-- Deliberately reachable by anon, restated so the intent is explicit rather
-- than inherited from a default nobody chose:
--   site_counts()           three numbers already printed in every footer
--   bank_paper_questions()  the gate itself; returns two questions to anon
--   teacher_whatsapp_link() returns null to anon, by design
-- ---------------------------------------------------------------------------
revoke all on function public.site_counts()                       from public, anon, authenticated;
grant execute on function public.site_counts()                    to anon, authenticated;

revoke all on function public.bank_paper_questions(text)          from public, anon, authenticated;
grant execute on function public.bank_paper_questions(text)       to anon, authenticated;

revoke all on function public.teacher_whatsapp_link(text)         from public, anon, authenticated;
grant execute on function public.teacher_whatsapp_link(text)      to anon, authenticated;

-- ---------------------------------------------------------------------------
-- PRE-EXISTING, found by the same audit. Not introduced by 20260918100000.
-- ---------------------------------------------------------------------------
-- get_public_profile_data() returns EVERY profile row -- 206 of them, 52KB,
-- with full_name, school_college, grade, role and avatar_url -- to any
-- anonymous caller holding the publishable key, which ships in the bundle and
-- is therefore public by construction. Many of those people are school
-- students.
--
-- Individually this data is already on display: teacher reviews show a
-- commenter's name and school, and 20260226000004 made that deliberate. Being
-- visible one at a time next to a review is not the same as being downloadable
-- as a 206-row list, which is the same distinction this whole migration series
-- draws for teacher contacts.
--
-- Safe to close outright: grep finds NO call sites in src/. The app reads
-- commenter names through a join on teacher_comments.profiles, never through
-- this function. It is an orphan.
revoke all on function public.get_public_profile_data()           from public, anon, authenticated;

-- A trigger function on teacher_comments, reachable directly over REST.
-- Calling it outside a trigger context should fail on OLD/NEW being unset, but
-- an endpoint that exists only to be fired by the database has no business
-- answering the internet at all.
revoke all on function public.reset_approval_on_edit()            from public, anon, authenticated;

-- Zero call sites, and it reads auth.uid() -- an anonymous caller learns only
-- that they are not a teacher. Closed for tidiness, not urgency.
revoke all on function public.is_teacher()                        from public, anon, authenticated;
grant execute on function public.is_teacher()                     to authenticated;

-- DELIBERATELY LEFT OPEN, with the reasoning recorded:
--   is_admin()                used inside other functions' bodies and by RLS
--                             policies; returns false to anon
--   check_user_exists(text)   one call site, in the sign-in flow, which runs
--   check_user_has_password   before the user is authenticated -- so anon
--                             EXECUTE is required for sign-in to work.
-- Both are user-enumeration shaped and worth revisiting: an endpoint that
-- answers "does this email have an account" is a way to test a list of
-- addresses against your user base. Both currently return false even for a
-- known-real address, so either they are already inert or they are broken;
-- that is worth establishing before anyone relies on them. Out of scope here
-- because changing them touches the sign-in path.

commit;

-- ===========================================================================
-- VERIFY
--   select p.proname, pg_catalog.array_to_string(p.proacl, ' | ') as acl
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('purge_read_events','read_quota_exceeded',
--                       'teacher_own_contact','admin_teacher_contacts',
--                       'site_counts','bank_paper_questions','teacher_whatsapp_link')
--   order by p.proname;
--
-- purge_read_events and read_quota_exceeded must show NO anon and NO
-- authenticated entry. teacher_own_contact and admin_teacher_contacts must
-- show authenticated but not anon. The other three must show both.
--
-- And from outside, as an anonymous caller:
--   POST /rest/v1/rpc/purge_read_events   -> 404 (PostgREST hides what you
--                                            cannot execute)
--   POST /rest/v1/rpc/site_counts         -> 200
-- ===========================================================================

-- ===========================================================================
-- WORTH CHECKING SEPARATELY: every other function in this schema created
-- since Supabase's default privileges were set has the same direct anon grant
-- unless it was explicitly revoked by role name. 20260818120000 revoked from
-- PUBLIC only, so the two functions it locked down may still carry it.
--   select p.proname, pg_catalog.array_to_string(p.proacl, ' | ')
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname='public' and p.prosecdef
--     and pg_catalog.array_to_string(p.proacl,',') like '%anon=X%';
-- ===========================================================================
