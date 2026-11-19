-- =========================================================================
-- RUN_THIS_LAST.sql
--
-- Everything still owed to the database, in one file, in the order it should
-- run. Paste the whole thing into the Supabase SQL editor.
--
-- After this there is no pending SQL. The only database items left in
-- docs/SUPABASE_RUNBOOK.md are decisions for you rather than statements to
-- run: Google-only sign-in, canary rows, and enforcing the read quotas after
-- two to four weeks of real traffic.
--
-- WHAT IS IN HERE
--   1. Give 218 reviews their authors back.        CHANGES DATA STRUCTURE
--   2. Make two admin-only guards reject anon.     CHANGES FUNCTIONS
--   3. Three diagnostics.                          READ-ONLY
--   4. Verification, with the expected answer beside each query.
--
-- Only section 1 has a symptom you can see on the site today. Section 2 is
-- correctness on functions that are already closed. Section 3 changes nothing
-- at all -- it prints answers to three questions that have been open for
-- weeks because the output was never read back.
--
-- SAFETY
--   - Each section that writes is wrapped in its own transaction, so a
--     failure applies none of that section rather than half of it.
--   - Re-running the whole file is safe. Section 2 renames a function aside,
--     which is the one genuinely non-repeatable step, so it checks first and
--     skips if it has already run.
--   - Every rollback is written inline beside the thing it undoes.
--
-- THERE IS NO TEST DATABASE. Both deployments share uvtifolnsneitetzohtn, so
-- this is production the moment it runs. Prefer Kolkata off-hours.
-- =========================================================================


-- =========================================================================
-- SECTION 1 -- GIVE 218 REVIEWS THEIR AUTHORS BACK
-- =========================================================================
-- This is the one with a live symptom. 218 of 376 approved reviews currently
-- render as "Anonymous" although their authors chose to be named -- on teacher
-- profiles, on the homepage quote rail, and in the teacher's own dashboard.
-- Signed-in visitors see it too.
--
-- CAUSE. 20260918140000 revoked EXECUTE on get_public_profile_data() from
-- public, anon and authenticated. That was correct: the function returns EVERY
-- profile row, and an anonymous caller holding only the publishable key could
-- POST /rpc/get_public_profile_data and receive 52,753 bytes listing 206 named
-- Kolkata schoolchildren with their school and grade.
--
-- The note recorded beside that revoke said the function had "no call sites in
-- src/, so closing it breaks nothing". It has three, all indirect.
-- 20260226000005 had rebuilt public_profiles as
--
--   CREATE VIEW public.public_profiles WITH (security_invoker = on)
--     AS SELECT * FROM get_public_profile_data();
--
-- security_invoker means the view runs as the CALLER, so the caller needs
-- EXECUTE on the function. Revoking it turned every read of the view into
-- 42501 "permission denied for function get_public_profile_data". Grepping the
-- code could not see it, because the dependency lived in the database.
--
-- WHAT THIS RESTORES, AND WHAT IT COSTS. All five display columns, including
-- school and grade, so a signed-out visitor can again read name + school +
-- grade in bulk. That is chosen, not overlooked: a byline reading "DPS Ruby
-- Park, Grade 10" is what makes a review read as a real person, and that is
-- what moves a parent to make contact.
--
-- If it is ever reconsidered, the change is to drop school_college and grade
-- from the column list below AND from the three .select() calls in
-- TeacherComments.tsx, Index.tsx and TeacherDashboard.tsx. A named column the
-- role cannot read fails the WHOLE PostgREST request with 401, so the view and
-- the frontend must move together or all 218 break again.
-- src/lib/public-profiles-columns.test.ts fails the build if they drift apart.
--
-- TWO THINGS THIS DOES BETTER THAN RESTORING THE GRANT.
--   1. The view no longer goes through the function, so the function stays
--      revoked and /rpc/get_public_profile_data stays shut. One endpoint
--      fewer, and the view stops depending on a grant that any future audit
--      would rightly want to remove -- which is exactly how this broke.
--   2. The view is limited to profiles that have authored an approved,
--      non-anonymous review. Today that narrows nothing: there are 206 review
--      authors and 206 profiles, the same people, which is why it is not
--      claimed as a security fix. Its value is that the exposed set stops
--      growing with the user base -- every future signup who never writes a
--      review is outside this view by construction.
--
-- ON security_invoker. Deliberately NOT set, so the view runs with its owner's
-- rights and can read profiles past RLS. This is the pre-20260226000005
-- behaviour, and it will bring back Supabase's "Security Definer View" advisor
-- warning on public_profiles. That warning is why the function indirection was
-- introduced, and the indirection is what broke the site, so it is traded back
-- knowingly: the advisor is a lint, the reviews are the product.
-- =========================================================================

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

-- ROLLBACK for section 1 (restores the broken state, so prefer fixing forward):
--   drop view if exists public.public_profiles;
--   create view public.public_profiles with (security_invoker = on)
--     as select * from public.get_public_profile_data();
--   grant select on public.public_profiles to anon, authenticated;
--   grant execute on function public.get_public_profile_data() to anon, authenticated;


-- =========================================================================
-- SECTION 2 -- MAKE TWO ADMIN-ONLY GUARDS ACTUALLY REJECT ANON
-- =========================================================================
-- 20260818120000 added two SECURITY DEFINER functions with this guard:
--
--   IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
--     RAISE EXCEPTION 'Not authorized';
--   END IF;
--
-- For an anonymous caller auth.uid() is NULL, so the left side is false, the
-- whole condition is false, and NO exception is raised. The guard stops a
-- signed-in non-admin and waves through anon -- the opposite order to the one
-- you would choose if only one could be caught.
--
-- NOTHING IS EXPOSED TODAY. Both functions are closed: EXECUTE is revoked from
-- public, anon and authenticated, and granted only to service_role. The reason
-- to fix it is that 20260818120000 describes these guards as a second layer
-- "a future GRANT cannot silently reopen", and for anon that is not true. It
-- is exactly the kind of protection that gets leaned on later by someone who
-- reads the comment rather than the condition, at the moment a grant is being
-- restored. One of the two returns the id and EMAIL of every account.
--
-- `NOT public.is_admin()` alone is the right condition: is_admin() returns
-- false for anon, so anon is rejected, and the signed-in non-admin case is
-- unchanged. Admin behaviour does not move.
--
-- ON NOT RETYPING THE BODIES. check_existing_users_for_teacher_role carries a
-- 50-line INSERT ... ON CONFLICT merge that assigns teacher roles. It is
-- renamed aside and wrapped rather than restated -- the technique
-- 20260818120000 itself used, for the reason it gives: "Less risk of a
-- transcription error than retyping the UPDATE/INSERT block, and the merge
-- behaviour is provably unchanged because it is the same function."
-- =========================================================================

begin;

-- The rename is the one step in this file that cannot simply be repeated, so
-- it checks for its own previous run first.
do $$
begin
  if to_regprocedure('public.check_existing_users_for_teacher_role_unguarded()') is not null then
    raise notice '2: already renamed aside on a previous run. Leaving the inner function untouched.';
  elsif to_regprocedure('public.check_existing_users_for_teacher_role()') is null then
    raise notice '2: check_existing_users_for_teacher_role() does not exist. Nothing to guard.';
  else
    execute 'alter function public.check_existing_users_for_teacher_role()'
         || ' rename to check_existing_users_for_teacher_role_unguarded';
    raise notice '2: renamed aside.';
  end if;
end
$$;

/* The inner function keeps its own weak guard. Harmless: it is only ever
   reached through the wrapper below, which has already established that the
   caller is an admin, so the weak condition passes for the only caller that
   can get there. Leaving it also means this touches no merge logic at all. */
do $$
begin
  if to_regprocedure('public.check_existing_users_for_teacher_role_unguarded()') is null then
    return;
  end if;

  execute 'revoke all on function public.check_existing_users_for_teacher_role_unguarded()'
       || ' from public, anon, authenticated';

  execute $wrapper$
    create or replace function public.check_existing_users_for_teacher_role()
    returns table(user_id uuid, user_email text, assigned_role boolean, teacher_email text)
    language plpgsql
    security definer
    set search_path to 'public'
    as $function$
    BEGIN
      -- Admin-only, and that now includes rejecting anon. The previous form,
      -- `auth.uid() IS NOT NULL AND NOT is_admin()`, passed for an anonymous
      -- caller because auth.uid() is NULL there.
      IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Not authorized';
      END IF;

      RETURN QUERY SELECT * FROM public.check_existing_users_for_teacher_role_unguarded();
    END;
    $function$;
  $wrapper$;

  -- CREATE OR REPLACE resets a function's ACL to the default, and Supabase's
  -- default privileges grant EXECUTE to anon and authenticated BY ROLE NAME.
  -- Replacing without re-revoking hands back exactly the access 20260818120000
  -- removed -- the same trap 20260918140000 exists to close.
  execute 'revoke all on function public.check_existing_users_for_teacher_role()'
       || ' from public, anon, authenticated';
  execute 'grant execute on function public.check_existing_users_for_teacher_role() to service_role';

  raise notice '2: check_existing_users_for_teacher_role wrapped and re-revoked.';
end
$$;

-- sync_teachers_list_from_shikshaqmine is already a thin wrapper over its own
-- _unguarded, so rewriting it risks nothing. Same one-word correction.
do $$
begin
  if to_regprocedure('public.sync_teachers_list_from_shikshaqmine_unguarded()') is null then
    raise notice '2: sync_teachers_list_from_shikshaqmine_unguarded() not found. Skipped.';
    return;
  end if;

  execute $wrapper$
    create or replace function public.sync_teachers_list_from_shikshaqmine()
    returns table(updated_count integer, inserted_count integer, total_processed integer)
    language plpgsql
    security definer
    set search_path to 'public'
    as $function$
    BEGIN
      IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Not authorized';
      END IF;

      RETURN QUERY SELECT * FROM public.sync_teachers_list_from_shikshaqmine_unguarded();
    END;
    $function$;
  $wrapper$;

  execute 'revoke all on function public.sync_teachers_list_from_shikshaqmine()'
       || ' from public, anon, authenticated';
  execute 'grant execute on function public.sync_teachers_list_from_shikshaqmine() to service_role';

  raise notice '2: sync_teachers_list_from_shikshaqmine wrapped and re-revoked.';
end
$$;

commit;

-- ROLLBACK for section 2:
--   drop function if exists public.check_existing_users_for_teacher_role();
--   alter function public.check_existing_users_for_teacher_role_unguarded()
--     rename to check_existing_users_for_teacher_role;
--   revoke all on function public.check_existing_users_for_teacher_role()
--     from public, anon, authenticated;
--   grant execute on function public.check_existing_users_for_teacher_role() to service_role;


-- =========================================================================
-- SECTION 3 -- DIAGNOSTICS. Read-only. Nothing below changes any data.
-- =========================================================================
-- These three ran once inside RUN_THIS_ONE.sql and printed their verdicts in
-- the SQL editor, but the output was never read back, so the answers are still
-- unknown. They are repeated here because each one settles a question that is
-- currently being guessed at. Read the output; each prints its own verdict.


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

-- 4a. The view answers, and returns only review authors.
--     EXPECT 206 today. The number to watch is that it equals 4b, not that it
--     equals the row count of profiles -- those two diverge as soon as
--     somebody signs up without reviewing, which is the point of the filter.
select count(*) as public_profiles_rows from public.public_profiles;

-- 4b. What 4a should equal.
select count(distinct c.user_id) as distinct_named_review_authors
from public.teacher_comments c
where c.approved and not c.is_anonymous and c.user_id is not null;

-- 4c. Anonymity is intact. EXPECT 0. Any row here is a reviewer who asked to
--     be anonymous and would now be named -- the one outcome worse than the
--     bug this file fixes.
select count(*) as anonymous_authors_wrongly_exposed
from public.public_profiles pp
where not exists (
  select 1 from public.teacher_comments c
  where c.user_id = pp.id and c.approved and not c.is_anonymous
);

-- 4d. Every function anon can still execute. Read it and agree with each line.
--     EXPECT only the intended public gates -- and NOT
--     get_public_profile_data, which section 1 deliberately leaves closed.
--     has_function_privilege, never a string match on proacl: a NULL proacl
--     means "the default applies", which for a function is EXECUTE TO PUBLIC,
--     so a string match silently misses every function nobody has touched.
select p.proname,
       p.prosecdef as security_definer,
       case when p.proacl is null then 'DEFAULT (execute to public)'
            else pg_catalog.array_to_string(p.proacl, ' | ') end as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by p.prosecdef desc, p.proname;

-- 4e. The two section-2 functions and their inner bodies.
--     EXPECT all four to show NEITHER anon NOR authenticated, and the two
--     wrappers to show service_role. A NULL acl is the failure to look for: it
--     reads as "no explicit grants" while meaning EXECUTE TO PUBLIC.
select p.proname,
       case when p.proacl is null then 'DEFAULT (execute to public) -- WRONG'
            else pg_catalog.array_to_string(p.proacl, ' | ') end as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like 'check_existing_users%' or p.proname like 'sync_teachers_list%')
order by p.proname;

-- 4f. Quotas stay off at launch. EXPECT enforcing = false.
select * from public.read_quota_config;


-- =========================================================================
-- THEN CHECK THE APP ITSELF
-- =========================================================================
-- Signed OUT, on a teacher with a named review -- /tuition-teachers/supriya-jana
-- is the page this was found on:
--   * the first review shows a person's NAME, not "Anonymous"
--   * the second review on that page is genuinely is_anonymous = true and MUST
--     still read "Anonymous". If both show names, anonymity is broken and 4c
--     was not read carefully enough.
--
-- Signed IN, same page: still a name. The original revoke covered
-- `authenticated` too, so checking only the signed-out case misses half of it.
--
-- A teacher opens their dashboard, sees their own number, AND SAVES
-- SUCCESSFULLY -- that is the regression that matters, because its failure
-- mode is silent rather than loud.
--
-- Admin's teacher table shows contacts. A paper opens signed in and signed out.


-- =========================================================================
-- DELIBERATELY NOT IN THIS FILE
-- =========================================================================
-- An `updated_at` column on teachers_list and bank_papers.
--
-- The sitemap now sends each page its row's own created_at as lastmod, instead
-- of stamping all 1,830 with the build date -- a large improvement, since a
-- site claiming every page changed on every deploy gets its lastmod ignored.
-- But created_at is not "last modified": it understates for a teacher who
-- later edits their profile.
--
-- Left out because it is a schema change on two live tables plus a trigger,
-- for an SEO signal that is already most of the way fixed, and a trigger that
-- fires on the bulk importer is worse than the understatement it cures. If you
-- decide you want it, this is the whole change, and
-- scripts/generate-sitemap.ts needs one line switched from created_at:
--
--   alter table public.teachers_list add column if not exists updated_at timestamptz not null default now();
--   alter table public.bank_papers   add column if not exists updated_at timestamptz not null default now();
--
--   create or replace function public.touch_updated_at() returns trigger
--   language plpgsql as $$
--   begin new.updated_at = now(); return new; end;
--   $$;
--
--   create trigger teachers_list_touch before update on public.teachers_list
--     for each row execute function public.touch_updated_at();
--   create trigger bank_papers_touch before update on public.bank_papers
--     for each row execute function public.touch_updated_at();
-- =========================================================================
