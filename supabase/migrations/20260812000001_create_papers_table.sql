-- Migration: Create papers table for the Past Papers search feature
-- Stores school past-paper metadata + optional file, searchable alongside teachers_list

CREATE TABLE IF NOT EXISTS public.papers (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),

  title TEXT NOT NULL,              -- e.g. "Prelims 2025"
  school TEXT NOT NULL,             -- e.g. "La Martiniere for Boys"
  subject TEXT NOT NULL,            -- e.g. "Maths"
  class TEXT NOT NULL,              -- e.g. "10"
  board TEXT NOT NULL,              -- e.g. "ICSE"
  exam_type TEXT NOT NULL DEFAULT 'Prelims' CHECK (exam_type IN ('Prelims', 'Half-Yearly', 'Final', 'Unit Test', 'Sample Paper')),
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),

  file_url TEXT,                    -- storage path in the paper-files bucket

  is_published BOOLEAN NOT NULL DEFAULT true,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Filter indexes
CREATE INDEX IF NOT EXISTS idx_papers_subject ON public.papers(subject);
CREATE INDEX IF NOT EXISTS idx_papers_class ON public.papers(class);
CREATE INDEX IF NOT EXISTS idx_papers_board ON public.papers(board);
CREATE INDEX IF NOT EXISTS idx_papers_school ON public.papers(school);
CREATE INDEX IF NOT EXISTS idx_papers_is_published ON public.papers(is_published);
CREATE INDEX IF NOT EXISTS idx_papers_created_at ON public.papers(created_at DESC);

-- Fuzzy/typo-tolerant search indexes (pg_trgm already enabled by an earlier migration)
CREATE INDEX IF NOT EXISTS idx_papers_title_trgm ON public.papers USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_papers_school_trgm ON public.papers USING gin (school gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_papers_subject_trgm ON public.papers USING gin (subject gin_trgm_ops);

-- Keep updated_at current
CREATE OR REPLACE FUNCTION public.set_papers_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS papers_set_updated_at ON public.papers;
CREATE TRIGGER papers_set_updated_at
  BEFORE UPDATE ON public.papers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_papers_updated_at();

-- RLS
ALTER TABLE public.papers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view published papers"
  ON public.papers FOR SELECT
  USING (is_published = true OR public.is_admin());

CREATE POLICY "Admins can insert papers"
  ON public.papers FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update papers"
  ON public.papers FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete papers"
  ON public.papers FOR DELETE
  USING (public.is_admin());

COMMENT ON TABLE public.papers IS 'School past-paper metadata and files, searchable alongside teachers_list from the dual-mode search control';
