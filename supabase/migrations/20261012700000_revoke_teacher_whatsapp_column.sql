-- Close the last open path to a teacher's WhatsApp number.
--
-- FOUND 12 October 2026 (Shikshaq Papers\pipeline\swarm\logs\whatsapp_exposure_20261012.md):
-- public.teachers_list.whatsapp_number was readable by anon and authenticated.
-- RLS policy "Allow public read access" is `using (true)`, and both roles held
-- TABLE-level SELECT (relacl: anon=arwdDxtm, authenticated=arwdDxtm), so one
-- REST call, teachers_list?select=slug,whatsapp_number, returned all 148
-- numbers with no sign-in. The gated function teacher_whatsapp_link() returns
-- null to a signed-out caller by design, so the table was a side door around it.
--
-- DEPLOY ORDER (do not apply this first):
--   1. Deploy the front end whose teachers_list reads name explicit columns and
--      never name whatsapp_number (src/lib/teachers.ts TEACHER_PROFILE_COLUMNS).
--   2. Only then apply this file. A column that is NAMED in a query but revoked
--      fails the WHOLE request with 401 / 42501, so applying it while the old
--      bundle (which does select('*') on the profile and names whatsapp_number
--      in TS) is live would blank the profile page. select('*') alone only
--      shrinks, but the old build is not worth reasoning about.
--
-- Why the TABLE-level revoke: a column REVOKE is a no-op while a table-level
-- SELECT grant exists (the table grant already covers every column). The same
-- pattern as 20260909000002 for "Shikshaqmine": revoke table SELECT, grant it
-- back column by column, leave the contact column out.
--
-- Untouched on purpose:
--   * INSERT / UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER grants and the
--     RLS policies (admin-only writes). service_role and postgres keep all.
--   * SECURITY DEFINER sync functions (sync_shikshaqmine_to_teachers_list and
--     sync_teachers_list_from_shikshaqmine_unguarded) run as owner and still
--     write whatsapp_number.
--   * Views over teachers_list (teachers_enriched, teacher_rating_stats,
--     teacher_upvote_stats) run as their owner and none of them names the
--     column; they are unaffected.
--   * teacher_whatsapp_link(), teacher_own_contact(), admin_teacher_contacts():
--     all read Shikshaqmine, not this table.
--
-- NOTE for the future: a column added to teachers_list is NOT readable by anon
-- or authenticated until it is granted here, which is the safe default.
--
-- ROLLBACK (restores the leak, so only if the public site breaks):
--   grant select on public.teachers_list to anon, authenticated;

begin;

-- Revoke by name, from all three: PUBLIC, anon and authenticated.
revoke select on public.teachers_list from public;
revoke select on public.teachers_list from anon;
revoke select on public.teachers_list from authenticated;
-- Belt and braces: the column grant itself, in case one is ever added by hand.
revoke select (whatsapp_number) on public.teachers_list from public;
revoke select (whatsapp_number) on public.teachers_list from anon;
revoke select (whatsapp_number) on public.teachers_list from authenticated;

-- Re-assert every other column. Every column except whatsapp_number.
grant select (
  id, name, slug, subject_id, image_url, bio, location, is_verified,
  is_featured, created_at, subjects, classes, honorific, "Sir/Ma'am?"
) on public.teachers_list to anon, authenticated;

-- Fail the migration, not the site, if the end state is wrong.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_column_privilege(r, 'public.teachers_list', 'whatsapp_number', 'SELECT') then
      raise exception 'whatsapp_number is still readable by %', r;
    end if;
    if not has_column_privilege(r, 'public.teachers_list', 'slug', 'SELECT')
       or not has_column_privilege(r, 'public.teachers_list', 'name', 'SELECT')
       or not has_column_privilege(r, 'public.teachers_list', 'subject_id', 'SELECT') then
      raise exception 'listing columns lost for %', r;
    end if;
  end loop;
end
$$;

commit;
