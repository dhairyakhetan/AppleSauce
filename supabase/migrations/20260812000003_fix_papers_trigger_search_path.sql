-- Migration: Fix mutable search_path warning on papers updated_at trigger function

CREATE OR REPLACE FUNCTION public.set_papers_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
