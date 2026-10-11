-- DRAFT — for review only. NOT applied by the app in this pass.
--
-- teachers_list and "Shikshaqmine" have no database-level relationship today.
-- Every page that needs both re-implements the join in JavaScript by
-- string-matching teachers_list.slug against Shikshaqmine."Slug" (see
-- src/lib/teachers.ts for the application-level consolidation that ships in
-- this pass). This view is the proposed real fix: a single joined relation
-- Postgres/PostgREST can serve directly, removing the client-side fan-out
-- entirely.
--
-- Notes for whoever reviews/applies this:
--   * teachers_list.slug is lowercase; Shikshaqmine."Slug" casing has not been
--     audited row-by-row. This join assumes exact match after lower(); confirm
--     against production data before relying on it, since the JS call sites
--     historically matched on raw equality, not lower().
--   * Shikshaqmine is wide and human-edited; this view intentionally exposes
--     only the columns known to be consumed today (see PROFILE_COLUMNS in
--     src/lib/teachers.ts). Extend it if a future call site needs more.
--   * This is a security-invoker view over two existing tables — grants /
--     RLS on the underlying tables continue to apply to callers, so no new
--     privilege escalation is introduced. Verify this with
--     `get_advisors(type: "security")` after applying to a branch.

create or replace view public.teachers_with_shikshaqmine
with (security_invoker = true) as
select
  tl.id,
  tl.slug,
  tl.name,
  tl.image_url,
  tl.is_verified,
  tl.subject_id,
  tl.classes,
  sm."Sir/Ma'am?" as sir_maam,
  sm."Subjects" as subjects_from_shikshaq,
  sm."Classes Taught" as classes_taught,
  sm."Classes Taught for Backend" as classes_taught_for_backend,
  sm."Area" as area,
  sm."School Boards Catered" as boards_taught,
  sm."Class Size (Group/ Solo)" as class_size,
  sm."Mode of Teaching" as mode_of_teaching,
  sm."Place of Teaching" as place_of_teaching,
  sm."LOCATION V2" as location_v2,
  sm."STUDENT'S HOME IN THESE AREAS" as students_home_areas,
  sm."TUTOR'S HOME IN THESE AREAS" as tutors_home_areas,
  sm."EXPANDED" as expanded,
  sm."Description" as description,
  sm."Qualifications etc" as qualifications_etc,
  sm."Years they started teaching" as teaching_since_raw,
  sm."Review 1" as review_1,
  sm."Review 2" as review_2,
  sm."Review 3" as review_3,
  sm."Link" as whatsapp_link,
  sm."Min Fees" as min_fees,
  sm."Max Fees" as max_fees,
  sm."is_paused" as is_paused
from public.teachers_list tl
left join public."Shikshaqmine" sm
  on lower(sm."Slug") = lower(tl.slug);

comment on view public.teachers_with_shikshaqmine is
  'Draft join of teachers_list and Shikshaqmine, keyed on lower(slug) = lower("Slug"). '
  'Not yet wired into the app — src/lib/teachers.ts still does this join in JS. '
  'See migration file header for review notes before switching call sites onto this view.';
