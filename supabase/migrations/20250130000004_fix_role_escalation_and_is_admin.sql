-- Migration: Fix role escalation vulnerability
-- 
-- Problem 1: is_admin() checks both admins table AND profiles.role = 'admin'
--   Any user could set their profiles.role to 'admin' via direct Supabase client call
--   and gain full admin privileges.
--
-- Problem 2: Users can change their own role to 'teacher' via profiles table update,
--   bypassing the intended auto_assign_teacher_role flow.
--
-- Fix 1: Update is_admin() to ONLY check the admins table.
--   Admin status is managed exclusively via the admins table in Supabase dashboard.
--
-- Fix 2: Add a trigger that prevents users from escalating their role via direct
--   profile updates. Only server-side SECURITY DEFINER functions (like auto_assign)
--   can set role to 'teacher'. Users can only choose 'student' or 'guardian'.

-- ============================================================================
-- FIX 1: Update is_admin() to only check admins table
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admins
    WHERE id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.is_admin() IS 'Check if current user is an admin. Only checks the admins table to prevent privilege escalation via profiles.role.';

-- ============================================================================
-- FIX 2: Trigger to prevent role escalation via direct profile updates
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If role hasn't changed, allow the update (user editing other profile fields)
  IF OLD.role IS NOT DISTINCT FROM NEW.role THEN
    RETURN NEW;
  END IF;

  -- If running in a privileged context (SECURITY DEFINER function/trigger),
  -- current_user will be the function owner (e.g., postgres/supabase_admin),
  -- not 'authenticated' or 'anon'. Allow these privileged operations.
  -- This permits auto_assign_teacher_role and approve_teacher_application to
  -- set role = 'teacher' as intended.
  IF current_user NOT IN ('anon', 'authenticated', 'authenticator') THEN
    RETURN NEW;
  END IF;

  -- Client-side request: only allow role changes to 'student' or 'guardian'
  -- 'teacher' role is assigned server-side by auto_assign_teacher_role trigger
  IF NEW.role NOT IN ('student', 'guardian') THEN
    RAISE EXCEPTION 'Role change to ''%'' is not permitted', NEW.role;
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger (drop first for idempotency)
DROP TRIGGER IF EXISTS prevent_role_escalation_trigger ON public.profiles;
CREATE TRIGGER prevent_role_escalation_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_role_escalation();

-- Add comments
COMMENT ON FUNCTION public.prevent_role_escalation() IS 
'Prevents users from escalating their role via direct profile updates. Only allows client-side changes to student/guardian. Teacher role is assigned by server-side SECURITY DEFINER triggers.';

