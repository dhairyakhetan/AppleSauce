-- =========================================================================
-- SUPERSEDED. Do not run this file on its own.
--
-- Its contents are section 1 of `supabase/RUN_THIS_LAST.sql`, which is the
-- single file to paste into the SQL editor. Running that file and then this
-- one would simply repeat the work -- harmless, but pointless.
--
-- Kept because it is the migration of record for what changed and why.
-- =========================================================================

-- Give 218 reviews their authors back.
--
-- WHAT BROKE. 20260918140000 (shipped inside RUN_THIS_ONE.sql) revoked
-- EXECUTE on get_public_profile_data() from public, anon and authenticated.
-- That was right: the function returns EVERY profile row, and an anonymous
-- caller holding only the publishable key could POST
-- /rpc/get_public_profile_data and receive 52,753 bytes listing 206 named
-- Kolkata schoolchildren with their school and grade.
--
-- The note recorded alongside that revoke said the function had "no call
-- sites in src/, so closing it breaks nothing". That was wrong, and this
-- migration exists because of it. The function has three call sites, all
-- indirect: 20260226000005 had rebuilt public_profiles as
--
--   CREATE VIEW public.public_profiles WITH (security_invoker = on)
--     AS SELECT * FROM get_public_profile_data();
--
-- security_invoker means the view runs as the CALLER, so the caller needs
-- EXECUTE on the function. Revoking it turned every read of the view into
-- 42501 "permission denied for function get_public_profile_data".
--
-- Measured on production before writing this: 376 approved reviews, of which
-- 218 are non-anonymous with a real user_id. All 218 were rendering as
-- "Anonymous", on teacher profiles, on the homepage quote rail, and in the
-- teacher's own dashboard. It affected signed-in visitors too, because the
-- revoke covered `authenticated` as well as `anon`.
--
-- WHAT THIS RESTORES, AND WHAT IT COSTS. The owner asked for all five display
-- columns back, having been shown the alternative. So name, role, school and
-- grade are readable again by a signed-out visitor, in bulk. That is a real
-- cost and it is chosen, not overlooked: a byline reading "DPS Ruby Park,
-- Grade 10" is the thing that makes a review read as a real person rather
-- than a testimonial, and that is what persuades a parent to make contact.
-- If it is ever reconsidered, the change is to drop school_college and grade
-- from the column list below AND from the three .select() calls in
-- TeacherComments.tsx, Index.tsx and TeacherDashboard.tsx -- a named column
-- the role cannot read fails the WHOLE PostgREST request with 401, so the
-- view and the frontend have to move together or reviews break again.
--
-- TWO THINGS THIS DOES BETTER THAN SIMPLY RESTORING THE GRANT.
--
-- 1. The view no longer goes through the function, so the function stays
--    revoked and /rpc/get_public_profile_data stays shut. One endpoint fewer,
--    and the view stops depending on a grant that any future audit would
--    correctly want to remove -- which is exactly how this broke.
--
-- 2. The view is limited to profiles that have actually authored an approved,
--    non-anonymous review. Today that narrows nothing: there are 206 review
--    authors and 206 profiles, so the two sets are the same people, which is
--    why it is not offered as a security fix. Its value is that the exposed
--    set stops growing with the user base. Every future signup who never
--    writes a review is outside this view by construction. All three call
--    sites pass ids taken from teacher_comments_public, so no byline we
--    render is ever outside the filter -- this costs nothing today and bounds
--    the leak tomorrow.
--
-- ON security_invoker. It is deliberately NOT set, so the view runs with its
-- owner's rights and can read profiles past RLS. That is the pre-20260226000005
-- behaviour. It will bring back Supabase's "Security Definer View" advisor
-- warning on public_profiles. That warning is the reason the function
-- indirection was introduced, and the indirection is what broke the site, so
-- it is being traded back knowingly: the advisor is a lint, the reviews are
-- the product.

begin;

drop view if exists public.public_profiles;

create view public.public_profiles as
  select p.id,
         p.full_name,
         p.role,
         p.school_college,
         p.grade,
         p.avatar_url
  from public.profiles p
  where exists (
    select 1
    from public.teacher_comments c
    where c.user_id = p.id
      and c.approved
      and not c.is_anonymous
  );

grant select on public.public_profiles to anon, authenticated;

comment on view public.public_profiles is
'Display data for review authors: non-PII columns only, limited to profiles that have written an approved non-anonymous review. Owner rights (no security_invoker) so it reads past RLS on profiles; this is intentional and replaces the get_public_profile_data() indirection, which broke every read of this view when that function was correctly revoked. See 20260919120000.';

commit;

-- ===========================================================================
-- VERIFY
--
-- 1. The view answers, and returns only review authors:
--      select count(*) from public.public_profiles;
--    Expect 206 today -- equal to the number of distinct authors of approved
--    non-anonymous reviews, NOT the number of rows in profiles, once those
--    two numbers diverge.
--
-- 2. The function it used to depend on is still shut. As an anonymous caller:
--      POST /rest/v1/rpc/get_public_profile_data  -> 401 with code 42501
--    A 200 here means someone restored the grant; it is no longer needed by
--    anything and should be revoked again.
--
-- 3. In the app, signed OUT, on a teacher with a named review
--    (/tuition-teachers/supriya-jana was the case this was found on): the
--    review shows a person's name, not "Anonymous". The second review on that
--    page is genuinely is_anonymous = true and MUST still read "Anonymous" --
--    if both show names, the filter is wrong and anonymity has been broken.
--
-- 4. Then signed IN, same page: still a name. The original revoke covered
--    `authenticated` too, so checking only the signed-out case would miss
--    half of what was broken.
--
-- ROLLBACK
--   drop view if exists public.public_profiles;
--   create view public.public_profiles with (security_invoker = on)
--     as select * from public.get_public_profile_data();
--   grant select on public.public_profiles to anon, authenticated;
--   -- and the view is dead again until this is also run, which is the bug:
--   grant execute on function public.get_public_profile_data() to anon, authenticated;
-- ===========================================================================
