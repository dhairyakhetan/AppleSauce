-- Mirrors the real gate just added for bank_questions (see
-- 20260909000001_bank_paper_questions_rpc.sql), for the same class of
-- problem: Shikshaqmine's RLS policy is `for select using (true)` with no
-- `to` clause, so anon has full row-level access, and PostgREST serves
-- whatever columns a query asks for. "Link" (the teacher's WhatsApp number)
-- was sitting in the same fetch as every public profile field, reachable by
-- any signed-out browser via the normal page load, and separately, the
-- `/tuition-teachers/:slug/whatsapp-click` route had no auth guard at all --
-- a bare GET against that URL, no sign-in, no click, resolved and redirected
-- to the teacher's real number.
--
-- Postgres RLS is row-level, not column-level, so it cannot restrict just
-- these two columns while leaving the rest of a public teacher profile
-- readable -- that needs column-level privileges, a separate, older
-- Postgres feature (REVOKE/GRANT SELECT (columns)) layered under RLS. Revoke
-- table-wide SELECT from anon, then grant it back column by column, leaving
-- out "Link" and "Phone Number". `authenticated` keeps full access
-- unchanged -- a teacher's own dashboard and admin still need every column,
-- including their own.

revoke select on public."Shikshaqmine" from anon;
grant select (
  "Area", "Class Size (Group/ Solo)", "Classes Taught", "Classes Taught for Backend",
  "Description", "EXPANDED", "Featured", "Featured Subject", "Hero Image", "id",
  "is_paused", "LOCATION V2", "Max Fees", "Min Fees", "Mode of Teaching", "MOU",
  "Place of Teaching", "Qualifications etc", "Review 1", "Review 2", "Review 3",
  "School Boards Catered", "Sir/Ma'am?", "Slug", "STUDENT'S HOME IN THESE AREAS",
  "Subjects", "Title", "TUTOR'S HOME IN THESE AREAS", "Video", "Video Link",
  "Years they started teaching"
) on public."Shikshaqmine" to anon;
-- "Link" and "Phone Number" deliberately absent from anon's column grant.
-- "Email ID" also absent -- already never selected by any public-facing
-- query (confirmed: not in teachers.ts's PROFILE_COLUMNS/BASIC_COLUMNS),
-- left out here too rather than granted back unnecessarily.

-- The only anon-reachable path to the WhatsApp link: returns it only when
-- auth.uid() is set. Deliberately no fallback/partial value for signed-out
-- callers -- the whole point is that a real gate has nothing to leak.
create or replace function public.teacher_whatsapp_link(p_slug text)
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  select case when auth.uid() is null then null else "Link" end
  from public."Shikshaqmine"
  where "Slug" = p_slug
  limit 1;
$function$;

revoke all on function public.teacher_whatsapp_link(text) from public;
grant execute on function public.teacher_whatsapp_link(text) to anon, authenticated;

comment on function public.teacher_whatsapp_link(text) is
  'The only anon-reachable read of Shikshaqmine."Link". Returns null for a signed-out caller, the real number for a signed-in one -- decided from auth.uid() inside the function, not from any client-supplied flag.';
