-- 20261011200000: a plain checker may no longer call the paper hand-out directly (leak audit finding F3, 2026-10-11).
-- distribute_unassigned_papers() took a global advisory lock and ran 3 to 6 seconds (14 at worst), and its guard let any
-- paper checker in, so a student could call it in a loop and collide with the 2-minute cron and the HOD button.
-- Now it is for the HOD or admin (the "Give out papers now" button), service_role (the cron wrapper sets that role claim)
-- and the throttled wrapper that verifier_my_papers uses. The wrapper marks its own call with a transaction-local setting
-- (app.dist_internal) that it sets just before the call and clears straight after; a client cannot set it, because the
-- API only runs one function call per transaction and never exposes set_config.
-- Signatures, SECURITY DEFINER, search_path and grants are unchanged: authenticated keeps EXECUTE on
-- distribute_unassigned_papers (the HOD button is an authenticated user), the check is inside, a student gets 42501.
-- distribute_unassigned_papers_throttled stays closed to every API role. No data row is touched.

do $patch$
declare
  v_def text;
  v_new text;
  v_hits int;
  r record;
begin
  for r in
    select * from (values
      ('public.distribute_unassigned_papers()',
       'if not (public.is_paper_checker() or public.is_hod() or auth.role() = ''service_role'') then',
       'if not (public.is_hod() or auth.role() = ''service_role'' or coalesce(current_setting(''app.dist_internal'', true), '''') = ''1'') then',
       1),
      ('public.distribute_unassigned_papers_throttled()',
       'declare v_due boolean;',
       'declare v_due boolean; v_n integer;',
       1),
      ('public.distribute_unassigned_papers_throttled()',
       '  return public.distribute_unassigned_papers();',
       E'  perform set_config(''app.dist_internal'', ''1'', true);\n  v_n := public.distribute_unassigned_papers();\n  perform set_config(''app.dist_internal'', '''', true);\n  return v_n;',
       1)
    ) as t(fn, needle, repl, expected)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if position(r.repl in v_def) > 0 then
      continue; -- already patched
    end if;
    v_hits := (length(v_def) - length(replace(v_def, r.needle, ''))) / length(r.needle);
    if v_hits <> r.expected then
      raise exception 'patch did not apply: % (found % of %)', r.fn, v_hits, r.expected;
    end if;
    v_new := replace(v_def, r.needle, r.repl);
    execute v_new;
  end loop;
end
$patch$;

-- Re-assert the grants as they were.
revoke all on function public.distribute_unassigned_papers() from public, anon, authenticated;
grant execute on function public.distribute_unassigned_papers() to authenticated;
revoke all on function public.distribute_unassigned_papers_throttled() from public, anon, authenticated;
