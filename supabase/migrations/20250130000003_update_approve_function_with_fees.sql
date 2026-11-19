-- Migration: Update approve_teacher_application function to include fees
-- Adds min_fees and max_fees from teacher_applications to Shikshaqmine

CREATE OR REPLACE FUNCTION public.approve_teacher_application(
  application_id UUID,
  admin_id UUID
)
RETURNS INTEGER -- Returns the created Shikshaqmine ID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_record RECORD;
  generated_slug TEXT;
  shikshaqmine_id INTEGER;
  classes_taught_roman TEXT;
  whatsapp_link TEXT;
  phone_digits TEXT;
BEGIN
  -- Verify admin
  IF NOT EXISTS (
    SELECT 1 FROM public.admins WHERE id = admin_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = admin_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'User is not an admin';
  END IF;
  
  -- Fetch application
  SELECT * INTO app_record
  FROM public.teacher_applications
  WHERE id = application_id AND status = 'pending';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found or already processed';
  END IF;
  
  -- Verify MOU consent
  IF app_record.mou_consent IS NOT TRUE THEN
    RAISE EXCEPTION 'Application cannot be approved without MOU consent';
  END IF;
  
  -- Generate unique slug
  generated_slug := public.generate_unique_slug(app_record.name);
  
  -- Auto-generate WhatsApp link from phone number if not provided
  -- Phone number is stored as 10 digits, we add 91 country code
  IF app_record.whatsapp_link IS NULL OR app_record.whatsapp_link = '' THEN
    -- Extract only digits from phone number
    phone_digits := regexp_replace(app_record.phone_number, '[^0-9]', '', 'g');
    -- Ensure it's 10 digits (should be validated in form, but double-check)
    IF length(phone_digits) = 10 THEN
      whatsapp_link := 'https://wa.me/91' || phone_digits;
    ELSE
      -- If phone number format is unexpected, use as-is with 91 prefix
      whatsapp_link := 'https://wa.me/91' || phone_digits;
    END IF;
  ELSE
    -- Use provided WhatsApp link (admin can override)
    whatsapp_link := app_record.whatsapp_link;
  END IF;
  
  -- Convert classes to Roman numerals (using existing logic)
  -- This will be handled by the trigger, but we can compute it here for immediate display
  -- The trigger will handle the conversion automatically
  
  -- Insert into Shikshaqmine
  INSERT INTO public."Shikshaqmine" (
    "Title",
    "Slug",
    "Email ID",
    "Phone Number",
    "Sir/Ma'am?",
    "Subjects",
    "Classes Taught for Backend",
    "School Boards Catered",
    "LOCATION V2",
    "STUDENT'S HOME IN THESE AREAS",
    "TUTOR'S HOME IN THESE AREAS",
    "Mode of Teaching",
    "Class Size (Group/ Solo)",
    "Description",
    "Qualifications etc",
    "Years they started teaching",
    "Featured Subject",
    "Link",
    "Hero Image",
    "MOU",
    "Min Fees",
    "Max Fees"
  )
  VALUES (
    app_record.name,
    generated_slug,
    app_record.email,
    app_record.phone_number,
    app_record.sir_maam,
    app_record.subjects,
    app_record.classes_taught_for_backend,
    app_record.school_boards_catered,
    app_record.location_v2,
    app_record.students_home_areas,
    app_record.tutors_home_areas,
    app_record.mode_of_teaching,
    app_record.class_size,
    app_record.description,
    app_record.qualifications_etc,
    app_record.years_started_teaching,
    app_record.featured_subject,
    whatsapp_link, -- Use auto-generated or provided WhatsApp link
    app_record.hero_image_url,
    true, -- MOU consent was required to submit
    app_record.min_fees, -- Minimum fees per month
    app_record.max_fees  -- Maximum fees per month
  )
  RETURNING id INTO shikshaqmine_id;
  
  -- Update application status
  UPDATE public.teacher_applications
  SET 
    status = 'approved',
    reviewed_by = admin_id,
    reviewed_at = now(),
    updated_at = now()
  WHERE id = application_id;
  
  -- Update user role to 'teacher' if they already have an account
  -- This handles the case where someone joined as student/guardian first
  UPDATE public.profiles
  SET 
    role = 'teacher',
    email = COALESCE(profiles.email, app_record.email),
    updated_at = now()
  WHERE EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = profiles.id
      AND LOWER(TRIM(u.email)) = LOWER(TRIM(app_record.email))
  );
  
  RETURN shikshaqmine_id;
END;
$$;

-- Grant execute permission to authenticated users (admins will use this)
GRANT EXECUTE ON FUNCTION public.approve_teacher_application(UUID, UUID) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.approve_teacher_application(UUID, UUID) IS 'Approves a teacher application by creating an entry in Shikshaqmine table with auto-generated unique slug. Auto-generates WhatsApp link from phone number (10 digits + 91 country code) if not provided. Includes min_fees and max_fees from application. If the applicant already has an account (student/guardian), their role is updated to teacher. Requires admin privileges. Returns the created Shikshaqmine ID.';

