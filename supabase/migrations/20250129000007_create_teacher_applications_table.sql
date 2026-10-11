-- Migration: Create teacher_applications table for onboarding form submissions
-- Stores pending teacher applications before admin approval

CREATE TABLE IF NOT EXISTS public.teacher_applications (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic Info
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  sir_maam TEXT NOT NULL CHECK (sir_maam IN ('Sir', 'Ma''am')),
  
  -- Teaching Details
  subjects TEXT NOT NULL, -- Comma-separated list
  classes_taught_for_backend TEXT NOT NULL, -- Comma-separated numbers (e.g., "1,2,3,UG")
  school_boards_catered TEXT, -- Comma-separated list
  location_v2 TEXT, -- TEACHER'S HOME TUTORING, STUDENT'S HOME TUTORING ONLY, BOTH OPTIONS LISTED
  students_home_areas TEXT, -- Comma-separated list
  tutors_home_areas TEXT, -- Comma-separated list
  mode_of_teaching TEXT, -- Comma-separated: Online, Offline
  class_size TEXT, -- Comma-separated: Group, Solo
  
  -- Additional Info
  description TEXT,
  qualifications_etc TEXT,
  years_started_teaching TEXT,
  featured_subject TEXT,
  whatsapp_link TEXT,
  hero_image_url TEXT,
  
  -- MOU Consent
  mou_consent BOOLEAN NOT NULL DEFAULT false,
  mou_consent_timestamp TIMESTAMP WITH TIME ZONE,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_teacher_applications_status 
  ON public.teacher_applications(status);
CREATE INDEX IF NOT EXISTS idx_teacher_applications_email 
  ON public.teacher_applications(email);
CREATE INDEX IF NOT EXISTS idx_teacher_applications_created_at 
  ON public.teacher_applications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_teacher_applications_reviewed_by 
  ON public.teacher_applications(reviewed_by) 
  WHERE reviewed_by IS NOT NULL;

-- Enable RLS
ALTER TABLE public.teacher_applications ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Policy: Anyone can insert applications (for form submissions)
CREATE POLICY "Anyone can submit teacher applications"
  ON public.teacher_applications FOR INSERT
  WITH CHECK (true);

-- Policy: Admins can view all applications
CREATE POLICY "Admins can view all teacher applications"
  ON public.teacher_applications FOR SELECT
  USING (public.is_admin());

-- Policy: Admins can update applications (approve/reject)
CREATE POLICY "Admins can update teacher applications"
  ON public.teacher_applications FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Policy: Users can view their own applications (by email match)
-- Note: This requires the user to be authenticated and have email in their profile
CREATE POLICY "Users can view own teacher applications"
  ON public.teacher_applications FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND LOWER(TRIM(p.email)) = LOWER(TRIM(teacher_applications.email))
    )
  );

-- Add comments for documentation
COMMENT ON TABLE public.teacher_applications IS 'Stores pending teacher onboarding applications before admin approval';
COMMENT ON COLUMN public.teacher_applications.mou_consent IS 'Indicates whether the applicant has consented to the Memorandum of Understanding';
COMMENT ON COLUMN public.teacher_applications.status IS 'Application status: pending (awaiting review), approved (created in Shikshaqmine), rejected (not approved)';

