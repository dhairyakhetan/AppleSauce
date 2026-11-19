-- When a Shikshaqmine row is deleted, set matching profiles back to student
-- only if no other Shikshaqmine row still uses that email (teacher still listed).

CREATE OR REPLACE FUNCTION public.revert_teacher_profile_role_on_shikshaqmine_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  v_email := NULLIF(TRIM(OLD."Email ID"), '');
  IF v_email IS NULL THEN
    RETURN OLD;
  END IF;

  -- Another Shikshaqmine row still claims this email → keep teacher role
  IF EXISTS (
    SELECT 1
    FROM public."Shikshaqmine" s
    WHERE NULLIF(TRIM(s."Email ID"), '') IS NOT NULL
      AND LOWER(NULLIF(TRIM(s."Email ID"), '')) = LOWER(v_email)
  ) THEN
    RETURN OLD;
  END IF;

  UPDATE public.profiles
  SET
    role = 'student',
    updated_at = now()
  WHERE role = 'teacher'
    AND email IS NOT NULL
    AND NULLIF(TRIM(email), '') IS NOT NULL
    AND LOWER(NULLIF(TRIM(email), '')) = LOWER(v_email);

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.revert_teacher_profile_role_on_shikshaqmine_delete() IS
  'After Shikshaqmine delete: if no remaining row uses the same Email ID, set profiles.role to student for matching teacher emails.';

DROP TRIGGER IF EXISTS trigger_revert_profile_role_on_shikshaqmine_delete ON public."Shikshaqmine";

CREATE TRIGGER trigger_revert_profile_role_on_shikshaqmine_delete
  AFTER DELETE ON public."Shikshaqmine"
  FOR EACH ROW
  EXECUTE FUNCTION public.revert_teacher_profile_role_on_shikshaqmine_delete();

COMMENT ON TRIGGER trigger_revert_profile_role_on_shikshaqmine_delete ON public."Shikshaqmine" IS
  'Demotes profiles from teacher to student when their Shikshaqmine row is removed and no duplicate teacher email remains.';
