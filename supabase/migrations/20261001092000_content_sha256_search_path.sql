-- 20261001092000_content_sha256_search_path.sql
--
-- The Supabase security advisor flagged content_sha256 (20261001090000) for a
-- role-mutable search_path. It only calls pg_catalog functions, so pin it
-- there. EXECUTE stays revoked from public, anon and authenticated.

alter function public.content_sha256(jsonb) set search_path to 'pg_catalog', 'pg_temp';
revoke all on function public.content_sha256(jsonb) from public, anon, authenticated;
