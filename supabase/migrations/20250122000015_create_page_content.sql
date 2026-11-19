-- Create table for storing page-specific content for "Find the best teachers" section
-- Content changes based on URL (subject, board, or general pages)

CREATE TABLE IF NOT EXISTS public.page_content (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  page_type TEXT NOT NULL CHECK (page_type IN ('general', 'subject', 'board', 'subject_board')),
  subject_slug TEXT, -- e.g., 'biology', 'physics', 'maths'
  board_slug TEXT, -- e.g., 'icse', 'cbse', 'igcse'
  heading TEXT NOT NULL DEFAULT 'Find the best teachers for you',
  short_content TEXT, -- Content shown initially (optional - if null, shows heading only)
  full_content TEXT NOT NULL, -- Content shown when "Read more" is clicked
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Ensure subject_slug is provided for subject pages
  CONSTRAINT check_subject_page_has_subject 
    CHECK (page_type != 'subject' OR subject_slug IS NOT NULL),
  
  -- Ensure board_slug is provided for board pages  
  CONSTRAINT check_board_page_has_board 
    CHECK (page_type != 'board' OR board_slug IS NOT NULL),
  
  -- Ensure both are provided for subject_board pages
  CONSTRAINT check_subject_board_has_both 
    CHECK (page_type != 'subject_board' OR (subject_slug IS NOT NULL AND board_slug IS NOT NULL))
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_page_content_page_type 
  ON public.page_content(page_type);

CREATE INDEX IF NOT EXISTS idx_page_content_subject_slug 
  ON public.page_content(subject_slug) 
  WHERE subject_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_page_content_board_slug 
  ON public.page_content(board_slug) 
  WHERE board_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_page_content_active 
  ON public.page_content(is_active, display_order) 
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_page_content_lookup 
  ON public.page_content(page_type, subject_slug, board_slug, is_active);

-- Partial unique index: one active content per page type/subject/board combination
CREATE UNIQUE INDEX IF NOT EXISTS idx_page_content_unique_active 
  ON public.page_content(page_type, subject_slug, board_slug) 
  WHERE is_active = true;

-- Enable RLS
ALTER TABLE public.page_content ENABLE ROW LEVEL SECURITY;

-- Public read access for page content
CREATE POLICY "Anyone can view page content" 
  ON public.page_content 
  FOR SELECT 
  USING (is_active = true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_page_content_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER update_page_content_updated_at
  BEFORE UPDATE ON public.page_content
  FOR EACH ROW
  EXECUTE FUNCTION public.update_page_content_updated_at();

-- Add comments for documentation
COMMENT ON TABLE public.page_content IS 'Stores content for "Find the best teachers" section based on URL/page type';
COMMENT ON COLUMN public.page_content.page_type IS 'Type of page: general, subject, board, or subject_board';
COMMENT ON COLUMN public.page_content.subject_slug IS 'Subject slug for subject pages (e.g., biology, physics, maths)';
COMMENT ON COLUMN public.page_content.board_slug IS 'Board slug for board pages (e.g., icse, cbse, igcse)';
COMMENT ON COLUMN public.page_content.heading IS 'Heading text (default: Find the best teachers for you)';
COMMENT ON COLUMN public.page_content.short_content IS 'Optional short content shown initially';
COMMENT ON COLUMN public.page_content.full_content IS 'Full content shown when "Read more" is clicked';

