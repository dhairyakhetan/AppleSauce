-- Publishing a paper failed with "DELETE requires a WHERE clause" (owner screenshot, 6 Nov 2026).
--
-- Cause: the API roles load the `safeupdate` extension (session_preload_libraries), which refuses any
-- DELETE or UPDATE that has no WHERE. Two publish functions empty their own scratch tables with a bare
-- DELETE, so the guard stopped them:
--   approval_publish_paper   : delete from pg_temp.approval_leaves;
--   _update_live_paper       : delete from pg_temp.live_update_plan;  delete from pg_temp.live_update_ord;
-- (A scan of every function in the database found no other bare DELETE or UPDATE. TRUNCATE is not
--  covered by the guard, so distribute_unassigned_papers is fine.)
--
-- Fix: add `where true` to those three statements, and change nothing else. The DO block reads the LIVE
-- function text, swaps exactly those statements, refuses to continue if a swap did not happen, and
-- re-creates the function. CREATE OR REPLACE keeps each function's settings (search_path) and grants.
-- Safe to run twice: a function that is already fixed is left alone.

do $fix$
declare
  v_oid  oid;
  v_def  text;
  v_new  text;
  v_item record;
  v_tbl  text;
  v_pat  text;
begin
  for v_item in
    select * from (values
      ('approval_publish_paper', 'p_audit_paper_id uuid, p_note text',   array['pg_temp.approval_leaves']),
      ('_update_live_paper',     'p_audit_paper_id uuid, p_actor text',  array['pg_temp.live_update_plan', 'pg_temp.live_update_ord'])
    ) as t(fname, fargs, tables)
  loop
    select p.oid into v_oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_item.fname
       and pg_get_function_identity_arguments(p.oid) = v_item.fargs;
    if v_oid is null then
      raise exception 'function public.%(%) not found', v_item.fname, v_item.fargs;
    end if;

    v_def := pg_get_functiondef(v_oid);
    v_new := v_def;
    foreach v_tbl in array v_item.tables loop
      v_pat := 'delete\s+from\s+' || replace(v_tbl, '.', '\.');
      -- only a bare "delete from <table>;" is touched; one that already has a where is left alone
      v_new := regexp_replace(v_new, '(' || v_pat || ')\s*;', '\1 where true;', 'gi');
      if v_new !~* (v_pat || '\s+where\s') then
        raise exception 'could not fix the delete on % inside %', v_tbl, v_item.fname;
      end if;
    end loop;

    if v_new <> v_def then
      execute v_new;
    end if;
  end loop;
end
$fix$;

-- Prove it: no bare scratch-table delete is left in either function.
do $check$
declare v_bad int;
begin
  select count(*) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('approval_publish_paper', '_update_live_paper')
     and pg_get_functiondef(p.oid) ~* 'delete\s+from\s+pg_temp\.\w+\s*;';
  if v_bad <> 0 then
    raise exception 'a bare delete is still there in % function(s)', v_bad;
  end if;
end
$check$;
