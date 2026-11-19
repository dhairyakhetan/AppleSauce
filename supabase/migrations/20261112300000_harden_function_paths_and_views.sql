-- 12 Nov 2026 hardening, found by the whole-flow audit.
-- Nothing here changes what any function or screen does. It only closes doors.
--
-- 1. Every SECURITY DEFINER function in `public` that pins its search path now ends the path with
--    `pg_temp`. Without that, Postgres looks in the caller's temporary schema FIRST, so a signed-in
--    person could create a temporary table with the same name as one the function reads and have the
--    function (which runs with the owner's rights) read theirs instead.
--    111 functions had `public`, 5 had `public, extensions`, 1 had an empty path (left alone, that one is safest).
-- 2. The 8 small helper functions the Supabase advisor flagged ("role mutable search_path") get a fixed path.
--    They are pure (no table reads), so this is safe.
-- 3. A backup table from 12 Oct had row security off. It is turned on (no policy = nobody but the owner can read it).
-- 4. `question_review_state` is a view that runs with its owner's rights and nothing on the site reads it.
--    Signed-in people could read it, so that is taken away. The owner role and service role keep it.

do $$
declare
  r record;
  n_defs int := 0;
begin
  for r in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args, c as cfg
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    cross join lateral unnest(p.proconfig) c
    where ns.nspname = 'public'
      and p.prosecdef
      and c like 'search_path=%'
      and c not like '%pg_temp%'
      and c not like 'search_path=""%'
  loop
    execute format('alter function public.%I(%s) set search_path = %s, pg_temp',
                   r.proname, r.args, substr(r.cfg, length('search_path=') + 1));
    n_defs := n_defs + 1;
  end loop;
  raise notice 'definer functions given pg_temp: %', n_defs;
end $$;

alter function public.verifier_paper_cap()            set search_path = public, pg_temp;
alter function public.ai_trust_overall_threshold()    set search_path = public, pg_temp;
alter function public.ai_trust_bar()                  set search_path = public, pg_temp;
alter function public.subject_key(text)               set search_path = public, pg_temp;
alter function public.subject_family(text)            set search_path = public, pg_temp;
alter function public.board_family(text)              set search_path = public, pg_temp;
alter function public.class_grade(text)               set search_path = public, pg_temp;
alter function public.ai_confidence_level(numeric)    set search_path = public, pg_temp;

alter table public.audit_set_aside_backup_20261012 enable row level security;

revoke all on public.question_review_state from anon, authenticated;
