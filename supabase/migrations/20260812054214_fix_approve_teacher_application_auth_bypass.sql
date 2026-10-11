-- Security fix: approve_teacher_application(application_id, admin_id) verified
-- that the *admin_id parameter* belonged to an admin, but never verified the
-- *caller* actually was that admin. Since admin_id is client-supplied, anyone
-- who obtained a valid admin's user id (e.g. it's written into
-- teacher_applications.reviewed_by after every approval) could call this RPC
-- directly and forge an approval while authenticated as themselves.
--
-- Fix: require auth.uid() = admin_id before proceeding. Verified against the
-- only caller (src/pages/AdminApplications.tsx), which already always passes
-- the caller's own user.id as admin_id, so this doesn't change legitimate
-- behavior.

CREATE OR REPLACE FUNCTION public.approve_teacher_application(application_id uuid, admin_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  app_record RECORD;
  generated_slug TEXT;
  shikshaqmine_id INTEGER;
  classes_taught_roman TEXT;
  whatsapp_link TEXT;
  phone_digits TEXT;
BEGIN
  -- Verify the caller IS the admin they claim to be (not just that admin_id
  -- happens to belong to some admin) -- previously this only checked the
  -- latter, which let a caller pass in ANY known admin's id to forge an
  -- approval while authenticated as themselves (or anonymously).
  IF auth.uid() IS DISTINCT FROM admin_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

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
$function$
;
