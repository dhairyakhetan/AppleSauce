-- Migration: Add a self-service "pause listing" flag for teachers.
--
-- Backs the TeacherDashboard.md "Pause listing" action card and status pill
-- (design_handoff_shikshaq/pages/TeacherDashboard.md). A teacher can pause/resume their own
-- listing from their dashboard; the status pill reflects it immediately.
--
-- Scope note: this column only drives the teacher's own dashboard status pill today. It is not
-- yet consumed by the public Browse/SubjectPage/BoardPage queries or the teachers_list sync
-- triggers, so a paused profile does not currently disappear from public results — wiring that up
-- touches those pages' filter logic and is left for whoever owns that follow-up work.

ALTER TABLE public."Shikshaqmine"
  ADD COLUMN IF NOT EXISTS is_paused BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public."Shikshaqmine".is_paused IS
  'Teacher-controlled pause toggle from their dashboard. Not yet enforced in public browse/search filtering.';
