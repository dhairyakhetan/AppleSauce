-- 20261126310000: the go-live checks say WHICH questions were checked by the AI only, not just how many (HOD audit,
-- 26 Nov 2026; owner: "finish all tasks fixes").
--
-- Before: the first check ("Every question is checked") carried 'ai_only' = a count. The go-live preview could only
-- say "3 questions were passed by the AI with no person checking" and could not point to them.
--
-- After: the same check also carries 'ai_only_ids', a JSON list of those questions' ids in paper order (empty when
-- none). Nothing else changes: same rule (a question passed with no person verdict counts as open), same words,
-- same 'ok', same keys. The ids come out of the SAME query that already counted them, so it costs nothing extra.
-- hod_paper_checks, hod_paper_preview and hod_ready_papers return this list too, because they read this function.
--
-- The body is the latest one (20261105000000_hod_not_printed_flags.sql, section 3) with only those two additions.
-- approval_paper_checks is internal: it stays revoked from public, anon AND authenticated (only other database
-- functions call it).

create or replace function public.approval_paper_checks(p_audit_paper_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_total integer;
  v_passed integer;
  v_open integer;
  v_aside integer;
  v_ai_only integer := 0;
  v_ai_only_ids uuid[] := '{}'::uuid[];
  v_open_eff integer;
  v_source text;
  v_unstaged integer;
  v_hdr jsonb;
  v_missing text[] := '{}';
  v_noise integer;
  v_noise_nums text;
  v_d1 text;
  v_d2 text;
  v_d3 text;
  v_d4 text;
begin
  select ap.source into v_source from public.audit_papers ap where ap.id = p_audit_paper_id;

  select count(*) filter (where s.st <> 'section'),
         count(*) filter (where s.st = 'passed'),
         count(*) filter (where s.st = 'open'),
         count(*) filter (where s.st = 'set_aside')
    into v_total, v_passed, v_open, v_aside
    from (select public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) as st
            from public.audit_questions q where q.paper_id = p_audit_paper_id) s;

  if v_source is distinct from 'live_copy' then
    -- NEW (20261126310000): which questions, not only how many, in paper order, so the preview can mark each one.
    select count(*), coalesce(array_agg(q.id order by q.ord, q.id), '{}'::uuid[]) into v_ai_only, v_ai_only_ids
      from public.audit_questions q
     where q.paper_id = p_audit_paper_id
       and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'passed'
       and not public.approval_person_verdict(q.id, q.checked_by_user);
  end if;
  v_open_eff := v_open + v_ai_only;

  if v_total = 0 then
    v_d1 := 'This paper has no questions yet.';
  elsif v_open_eff > 0 then
    v_d1 := concat_ws(' and ',
              case when v_open > 0 then v_open || case when v_open = 1 then ' question is' else ' questions are' end || ' still open' end,
              case when v_ai_only > 0 then v_ai_only || case when v_ai_only = 1 then ' question' else ' questions' end || ' checked by the AI only' end)
            || '. Every question must be checked by a person or set aside.';
    if v_aside > 0 then
      v_d1 := v_d1 || ' ' || v_aside || case when v_aside = 1 then ' question is' else ' questions are' end
              || ' left out.';
    end if;
  elsif v_passed = 0 then
    v_d1 := 'No question is passed yet. At least one must be passed to go live.';
  elsif v_aside = 0 then
    v_d1 := 'All ' || v_total || ' questions are checked.';
  else
    v_d1 := 'All ' || v_total || ' questions are checked. '
            || v_aside || case when v_aside = 1 then ' question is left out. It will not go live.'
                               else ' questions are left out. They will not go live.' end;
  end if;

  select count(*) into v_unstaged
    from public.audit_questions q
   where q.paper_id = p_audit_paper_id and q.kind = 'question' and q.question_passed
     and (q.figure ->> 'path') is null
     and exists (select 1 from public.audit_figures f where f.question_id = q.id and f.status = 'active');
  if v_unstaged = 0 then
    v_d2 := 'Every picture is in place.';
  else
    v_d2 := v_unstaged || case when v_unstaged = 1 then ' picture is' else ' pictures are' end
            || ' not on the site yet.';
  end if;

  v_hdr := public.approval_header_values(p_audit_paper_id);
  if nullif(v_hdr ->> 'school', '') is null then v_missing := array_append(v_missing, 'school'::text); end if;
  if nullif(v_hdr ->> 'cls', '') is null then v_missing := array_append(v_missing, 'class'::text); end if;
  if nullif(v_hdr ->> 'subject', '') is null then v_missing := array_append(v_missing, 'subject'::text); end if;
  if nullif(v_hdr ->> 'board', '') is null then v_missing := array_append(v_missing, 'board'::text); end if;
  if nullif(v_hdr ->> 'year', '') is null then v_missing := array_append(v_missing, 'year'::text); end if;
  if nullif(v_hdr ->> 'exam', '') is null then v_missing := array_append(v_missing, 'exam'::text); end if;
  if v_hdr -> 'marks' is null or jsonb_typeof(v_hdr -> 'marks') <> 'number' then v_missing := array_append(v_missing, 'total marks'::text); end if;
  -- CHANGED: time allowed and general instructions are not missing when the HOD marked them "not printed".
  if (v_hdr -> 'allowed_time_minutes' is null or jsonb_typeof(v_hdr -> 'allowed_time_minutes') <> 'number')
     and not coalesce((v_hdr ->> 'time_not_printed')::boolean, false) then
    v_missing := array_append(v_missing, 'time allowed'::text);
  end if;
  if nullif(v_hdr ->> 'general_instructions', '') is null
     and not coalesce((v_hdr ->> 'instructions_not_printed')::boolean, false) then
    v_missing := array_append(v_missing, 'general instructions'::text);
  end if;
  if coalesce(array_length(v_missing, 1), 0) = 0 then
    v_d3 := 'All the paper details are filled in.';
  else
    v_d3 := 'Missing: ' || array_to_string(v_missing, ', ') || '.';
  end if;

  select count(*), string_agg(coalesce(nullif(n.display_number, ''), '?'), ', ')
    into v_noise, v_noise_nums
    from public.paper_noise_hits(p_audit_paper_id) n;
  if v_noise = 0 then
    v_d4 := 'No scanner marks found.';
  else
    v_d4 := v_noise || case when v_noise = 1 then ' question has' else ' questions have' end
            || ' scanner marks (question ' || left(v_noise_nums, 120) || ').';
  end if;

  return jsonb_build_array(
    jsonb_build_object('key', 'questions_checked', 'label', 'Every question is checked',
                       'ok', v_total > 0 and v_open_eff = 0 and v_passed > 0, 'detail', v_d1,
                       'left_out', v_aside, 'open', v_open_eff, 'ai_only', v_ai_only,
                       'ai_only_ids', to_jsonb(v_ai_only_ids)),
    jsonb_build_object('key', 'pictures_present', 'label', 'Pictures are in place',
                       'ok', v_unstaged = 0, 'detail', v_d2),
    jsonb_build_object('key', 'header_complete', 'label', 'Paper details are complete',
                       'ok', coalesce(array_length(v_missing, 1), 0) = 0, 'detail', v_d3),
    jsonb_build_object('key', 'scanner_junk_gone', 'label', 'No scanner junk left',
                       'ok', v_noise = 0, 'detail', v_d4));
end;
$function$;

revoke all on function public.approval_paper_checks(uuid) from public, anon, authenticated;
