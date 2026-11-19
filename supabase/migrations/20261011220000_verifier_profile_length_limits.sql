-- 20261011220000: length limits on a verifier's self-declared details (leak audit finding F18, 2026-10-11).
-- verifier_set_my_profile accepted any length for name, school and board. Now: name 120, school 160, board 60 characters
-- (after trimming), with a clear error (22023, same code as the grade rule). The grade rule (1 to 17) is unchanged.
-- Patched from the live definition so the rest of the function, its signature, SECURITY DEFINER, search_path and grants
-- stay exactly as they are. No data row is touched.

do $patch$
declare
  v_def text;
  v_needle text := 'if p_grade is not null and p_grade not between 1 and 17 then raise exception ''Grade is out of range'' using errcode = ''22023''; end if;';
  v_repl text;
  v_hits int;
begin
  v_repl := v_needle
    || E'\n  if length(btrim(coalesce(p_full_name, ''''))) > 120 then raise exception ''Your name is too long (120 characters at most)'' using errcode = ''22023''; end if;'
    || E'\n  if length(btrim(coalesce(p_school, ''''))) > 160 then raise exception ''The school name is too long (160 characters at most)'' using errcode = ''22023''; end if;'
    || E'\n  if length(btrim(coalesce(p_board, ''''))) > 60 then raise exception ''The board name is too long (60 characters at most)'' using errcode = ''22023''; end if;';
  v_def := pg_get_functiondef('public.verifier_set_my_profile(text, integer, text, text)'::regprocedure);
  if position('is too long (120 characters at most)' in v_def) > 0 then
    return; -- already patched
  end if;
  v_hits := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  if v_hits <> 1 then
    raise exception 'patch did not apply: verifier_set_my_profile (found % of 1)', v_hits;
  end if;
  execute replace(v_def, v_needle, v_repl);
end
$patch$;

revoke all on function public.verifier_set_my_profile(text, integer, text, text) from public, anon, authenticated;
grant execute on function public.verifier_set_my_profile(text, integer, text, text) to authenticated;
