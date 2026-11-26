-- 20261125110000_checker_set_options.sql
-- Owner, 25 Nov 2026 ("for checkers as well"): a student checker pressing Fix it can change the answer options
-- of a question, the same way the HOD now can.
--
-- ONE new, additive function. verifier_verdict_and_next and checker_fix_locked are NOT touched: the website
-- calls this first (with the version the checker saw) and then gives the verdict with the version this returns.
--
--   verifier_set_options(p_question_id, p_expected_version, p_options) -> the version after the change
--
-- Rules (same shape as checker_fix_locked):
--   * only the checker who holds the question (checker_authorize_question: lease, assignment, role);
--   * the question must still be at the version the checker saw, else 40001 (stale), nothing changes (unless the
--     options are already exactly what was asked for, see below);
--   * options must be a list of up to 30 entries, each a text or an object with a label or text;
--   * when the options are already exactly what was asked for, nothing is written and the current version comes
--     back (so a retry after a dropped connection is harmless);
--   * the change goes through apply_fix_locked, so the old options stay in the version history.
-- No audit_review_log or content_checks row is written here: the verdict that follows (checker_fix) is the one
-- logged answer for the question.

create or replace function public.verifier_set_options(
  p_question_id uuid,
  p_expected_version integer,
  p_options jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_current integer;
  v_item jsonb;
  v_now jsonb;
begin
  perform public.checker_authorize_question(p_question_id);

  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception 'options must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_options) > 30 then
    raise exception 'too many options' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_options) loop
    if jsonb_typeof(v_item) = 'string' then
      continue;
    elsif jsonb_typeof(v_item) = 'object' and (v_item ? 'text' or v_item ? 'label') then
      continue;
    end if;
    raise exception 'each option must be text or have a label or text' using errcode = '22023';
  end loop;

  select aq.version, to_jsonb(aq.options) into v_current, v_now from public.audit_questions aq where aq.id = p_question_id for update;

  -- Already exactly what was asked for (a retry after a dropped connection): nothing to write, hand back the
  -- version it is at now so the verdict that follows can use it.
  if v_now is not distinct from p_options then
    return v_current;
  end if;

  if p_expected_version is null or v_current is distinct from p_expected_version then
    raise exception 'stale question: you saw version %, it is now at version %',
      coalesce(p_expected_version::text, 'none'), v_current using errcode = '40001';
  end if;

  return public.apply_fix_locked(
    'audit_questions', p_question_id::text, v_current,
    jsonb_build_object('options', p_options),
    'checker', 'checker', 'checker changed the options');
end;
$function$;

revoke all on function public.verifier_set_options(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.verifier_set_options(uuid, integer, jsonb) to authenticated;
