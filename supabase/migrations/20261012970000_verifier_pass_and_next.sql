-- 20261012970000: verifier_verdict_and_next / verifier_pass_and_next -- give the verdict AND get the next question, in ONE call.
--
-- Why (the checker speed plan, 12 Oct 2026, owner approved): after Pass the screen waits for the verdict write, then for
-- verifier_next_in_paper, then for checker_question_context, three sequential round trips before the next question's
-- WORDS are on screen. The verdict has to commit before the next row is chosen (the next query filters
-- question_passed = false), so the two cannot simply be fired in parallel. One transaction removes the gap and the race.
--
-- What this adds, and nothing else: two new functions. No existing function is changed.
--
--   verifier_verdict_and_next(p_action text, p_question_id uuid, p_paper_id uuid default null, p_expected_version integer
--       default null, p_body text default null, p_display_number text default null, p_marks numeric default null,
--       p_printed_typo boolean default false, p_typo_note text default null, p_reason text default null,
--       p_include_skipped boolean default false) returns jsonb
--     p_action is 'pass', 'fix', 'skip' or 'ask_help' (anything else raises 22023). The four verdict functions all take
--     the question id and differ only in their other arguments, so one wrapper covers them. It
--       1. checks the caller is a paper checker (42501 'Not authorized'), the same refusal the verdict functions give;
--       2. calls the EXISTING verdict function and nothing else for the verdict:
--            pass     -> checker_pass_locked(p_question_id, p_expected_version)
--            fix      -> checker_fix_locked(p_question_id, p_expected_version, p_body, p_display_number, p_marks,
--                        p_printed_typo, p_typo_note)
--            skip     -> checker_skip_question(p_question_id)
--            ask_help -> checker_ask_for_help(p_question_id, p_reason)
--          No rule is copied here: the lease check, the stale-version check (40001), the no-words check (22023),
--          the audit_review_log row and the content_checks row all happen inside those functions, with their errors;
--       3. then claims the next question of the same paper by calling verifier_next_in_paper (so the lease, the
--          assignment check, the servable rule, the skip rule, verifier_close_finished on an empty paper and
--          leased_at all behave exactly as in the two-call path), and reads the context of the question just
--          claimed with checker_question_context (the lease it just took is what lets that call through).
--     Everything runs in one transaction. If the verdict function raises, the whole call raises the same error and the
--     next question is never looked at, so nothing is claimed. If anything after the verdict raises, the verdict is
--     rolled back with it: a verdict is never saved without the caller learning what came next.
--
--     p_paper_id is optional; when absent the paper of the answered question is used. When given it must be the paper
--     of that question (22023 otherwise, after which the verdict is rolled back).
--
--     Returns jsonb:
--       { "verdict_ok": true,
--         "verdict": 'pass' | 'fix' | 'skip' | 'ask_help',
--         "verdict_version": <integer, the version pass/fix ended on; null for skip and ask_help>,
--         "next": null | { ...every column verifier_next_in_paper returns (id, paper_id, ord, display_number, number_path,
--                          body, options, marks, instructions, flag_reasons, flag_detail, source, subject, school, cls,
--                          exam, year, version, page, page_path, snippet_path, raw_ocr)...,
--                          "context": [ ...checker_question_context rows, in order; [] when none ] },
--         "next_paper_id": <uuid of the paper the next question belongs to; null when nothing is left> }
--
--   verifier_pass_and_next(p_question_id uuid, p_expected_version integer, p_paper_id uuid default null,
--       p_include_skipped boolean default false) returns jsonb
--     The Pass case of the above, because Pass is the common press. Same result.
--
-- Grants follow CLAUDE.md: revoke from public, anon AND authenticated by name, then grant to authenticated only.

create or replace function public.verifier_verdict_and_next(
  p_action text,
  p_question_id uuid,
  p_paper_id uuid default null,
  p_expected_version integer default null,
  p_body text default null,
  p_display_number text default null,
  p_marks numeric default null,
  p_printed_typo boolean default false,
  p_typo_note text default null,
  p_reason text default null,
  p_include_skipped boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_version integer;
  v_qpaper uuid;
  v_paper uuid;
  v_next record;
  v_ctx jsonb := '[]'::jsonb;
  v_nextj jsonb := null;
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('pass', 'fix', 'skip', 'ask_help') then
    raise exception 'Unknown verdict: %', coalesce(p_action, 'none') using errcode = '22023';
  end if;

  -- (1) the verdict: the existing function does all of it, with its own checks, log rows and errors
  if p_action = 'pass' then
    v_version := public.checker_pass_locked(p_question_id, p_expected_version);
  elsif p_action = 'fix' then
    v_version := public.checker_fix_locked(p_question_id, p_expected_version, p_body, p_display_number, p_marks,
                                           p_printed_typo, p_typo_note);
  elsif p_action = 'skip' then
    perform public.checker_skip_question(p_question_id);
  else
    perform public.checker_ask_for_help(p_question_id, p_reason);
  end if;

  -- (2) which paper the next question comes from
  select aq.paper_id into v_qpaper from public.audit_questions aq where aq.id = p_question_id;
  if p_paper_id is not null and p_paper_id is distinct from v_qpaper then
    raise exception 'That question is not on this paper' using errcode = '22023';
  end if;
  v_paper := coalesce(p_paper_id, v_qpaper);

  -- (3) the next question, claimed exactly as verifier_next_in_paper claims it (gate, lease, order, close-when-finished)
  select * into v_next from public.verifier_next_in_paper(v_paper, coalesce(p_include_skipped, false)) limit 1;

  if found and v_next.id is not null then
    -- (4) its context, readable now because the claim above leased it to the caller
    begin
      select coalesce(jsonb_agg(to_jsonb(c) order by c.ord), '[]'::jsonb) into v_ctx
      from public.checker_question_context(v_next.id) c;
    exception when insufficient_privilege then
      v_ctx := '[]'::jsonb; -- the context is a help, never a reason to block checking (the client does the same)
    end;
    v_nextj := to_jsonb(v_next) || jsonb_build_object('context', v_ctx);
  end if;

  return jsonb_build_object(
    'verdict_ok', true,
    'verdict', p_action,
    'verdict_version', v_version,
    'next', v_nextj,
    'next_paper_id', case when v_nextj is null then null else v_paper end
  );
end;
$function$;

create or replace function public.verifier_pass_and_next(
  p_question_id uuid,
  p_expected_version integer,
  p_paper_id uuid default null,
  p_include_skipped boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return public.verifier_verdict_and_next('pass', p_question_id, p_paper_id, p_expected_version,
                                          null, null, null, false, null, null, p_include_skipped);
end;
$function$;

revoke all on function public.verifier_verdict_and_next(text, uuid, uuid, integer, text, text, numeric, boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function public.verifier_verdict_and_next(text, uuid, uuid, integer, text, text, numeric, boolean, text, text, boolean) to authenticated;

revoke all on function public.verifier_pass_and_next(uuid, integer, uuid, boolean) from public, anon, authenticated;
grant execute on function public.verifier_pass_and_next(uuid, integer, uuid, boolean) to authenticated;
