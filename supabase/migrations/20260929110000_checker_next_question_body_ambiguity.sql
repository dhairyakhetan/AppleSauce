-- Hotfix for 20260929100000_plumbing_step1.sql, applied live 2026-09-29.
--
-- The eligibility guard added to checker_next_question's claiming UPDATE
-- (review SHOULD-FIX) wrote `btrim(coalesce(body, ''))`. The function
-- RETURNS TABLE (... body text ...), so inside plpgsql `body` is also an OUT
-- parameter and the reference is ambiguous: every call raised 42702 and the
-- checker could not serve a question. Found by the post-apply verification.
--
-- Fix: qualify it as public.audit_questions.body. Patched from the live
-- definition so nothing else in the function changes; refuses to run if the
-- expected text is not there. CREATE OR REPLACE keeps the existing grants.

do $fix$
declare d text; n text;
begin
  select pg_get_functiondef('public.checker_next_question()'::regprocedure) into d;
  n := replace(d, 'and btrim(coalesce(body, '''')) <> ''''', 'and btrim(coalesce(public.audit_questions.body, '''')) <> ''''');
  if n = d then
    raise exception 'checker_next_question: expected unqualified body guard not found';
  end if;
  execute n;
end
$fix$;
