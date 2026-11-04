-- HOD desk, step 6a: fix for approval_paper_checks (20261012100000).
--
-- `v_missing := v_missing || 'school'` makes Postgres read the literal as an
-- ARRAY ("malformed array literal") the moment any header field is missing, so
-- a paper with an incomplete header would have broken hod_paper_checks, the
-- Ready list and hod_paper_preview instead of showing the red check. Caught in
-- the rehearsal of hod_approve_paper. array_append with an explicit text cast
-- is unambiguous. Nothing else in the function changes.

create or replace function public.approval_paper_checks(p_audit_paper_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_total integer;
  v_passed integer;
  v_open integer;
  v_aside integer;
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
  select count(*) filter (where s.st <> 'section'),
         count(*) filter (where s.st = 'passed'),
         count(*) filter (where s.st = 'open'),
         count(*) filter (where s.st = 'set_aside')
    into v_total, v_passed, v_open, v_aside
    from (select public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) as st
            from public.audit_questions q where q.paper_id = p_audit_paper_id) s;

  if v_total = 0 then
    v_d1 := 'This paper has no questions yet.';
  elsif v_open = 0 and v_aside = 0 then
    v_d1 := 'All ' || v_total || ' questions are checked.';
  else
    v_d1 := concat_ws(', ',
              case when v_open > 0 then v_open || case when v_open = 1 then ' question is' else ' questions are' end || ' still open' end,
              case when v_aside > 0 then v_aside || case when v_aside = 1 then ' question is' else ' questions are' end || ' set aside' end)
            || '. Every question must be passed.';
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
  if v_hdr -> 'allowed_time_minutes' is null or jsonb_typeof(v_hdr -> 'allowed_time_minutes') <> 'number' then
    v_missing := array_append(v_missing, 'time allowed'::text);
  end if;
  if nullif(v_hdr ->> 'general_instructions', '') is null then v_missing := array_append(v_missing, 'general instructions'::text); end if;
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
                       'ok', v_total > 0 and v_open = 0 and v_aside = 0, 'detail', v_d1),
    jsonb_build_object('key', 'pictures_present', 'label', 'Pictures are in place',
                       'ok', v_unstaged = 0, 'detail', v_d2),
    jsonb_build_object('key', 'header_complete', 'label', 'Paper details are complete',
                       'ok', coalesce(array_length(v_missing, 1), 0) = 0, 'detail', v_d3),
    jsonb_build_object('key', 'scanner_junk_gone', 'label', 'No scanner junk left',
                       'ok', v_noise = 0, 'detail', v_d4));
end;
$$;

revoke all on function public.approval_paper_checks(uuid) from public, anon, authenticated;
