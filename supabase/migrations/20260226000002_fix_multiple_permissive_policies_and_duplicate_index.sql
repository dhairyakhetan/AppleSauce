-- Migration: Fix duplicate index on teacher_upvotes (lint 0009); add index on Shikshaqmine."Title"
-- Table teacher_upvotes had two identical indexes on teacher_id; keep one.
-- Index on Shikshaqmine."Title" for lookups/filters by title.
-- RLS policies are unchanged.

DROP INDEX IF EXISTS public.teacher_upvotes_teacher_id_idx;

CREATE INDEX IF NOT EXISTS idx_shikshaqmine_title ON public."Shikshaqmine" USING btree ("Title");
