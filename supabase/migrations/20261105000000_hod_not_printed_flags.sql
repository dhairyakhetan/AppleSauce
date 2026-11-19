-- 5 November 2026. HOD desk: "not printed" flags, and a count for the "waiting to be queued" banner.
--
-- Why: 39 of the 61 queued papers cannot go live because the printed paper has no general instructions
-- or no time allowed. The HOD cannot invent those. The owner chose: let the HOD mark them "not printed".
-- A flag set to true makes that one missing value pass the header_complete check. Nothing else changes.
--
-- Three live function bodies are re-created exactly as read from the database on 5 November 2026,
-- with only the lines marked "NEW" or "CHANGED" different. One additive function is added.
-- Apply by pasting into the Supabase SQL editor. Safe to run twice (create or replace).

-- 1. The HOD can set the two flags (same yes/no handling as is_board_paper and has_school).
create or replace function public.hod_update_publish_meta(p_audit_paper_id uuid, p_field text, p_value text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_p public.audit_papers;
  v_meta jsonb;
  v_before jsonb;
  v_after jsonb;
  v_txt text := btrim(p_value);
  v_allowed text[] := array['school', 'school_raw', 'is_board_paper', 'year', 'exam', 'cls', 'subject', 'board',
                            'has_school', 'incomplete_note', 'marks', 'allowed_time_minutes', 'general_instructions',
                            'instructions_not_printed', 'time_not_printed'];  -- CHANGED: two flags added
  v_num numeric;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  if not coalesce(p_field = any (v_allowed), false) then
    raise exception 'The field "%" cannot be changed here.', coalesce(p_field, '') using errcode = '22023';
  end if;

  select * into v_p from public.audit_papers where id = p_audit_paper_id for update;
  if v_p.id is null then
    raise exception 'That paper could not be found.' using errcode = 'P0002';
  end if;
  if v_p.source = 'live_copy' then
    raise exception 'This is a live Maths copy. It is frozen and is not part of the HOD desk.' using errcode = '55000';
  end if;
  if v_p.approval_state = 'approved' then
    raise exception 'This paper is already approved. Change its details from Live papers.' using errcode = '55000';
  end if;

  if p_field in ('school', 'cls', 'subject', 'board') then
    if v_txt is null or v_txt = '' then
      raise exception 'This cannot be left blank.' using errcode = '22023';
    end if;
    if length(v_txt) > 200 then
      raise exception 'That is too long (200 characters at most).' using errcode = '22023';
    end if;
    v_after := to_jsonb(v_txt);
  elsif p_field in ('school_raw', 'year', 'exam') then
    if v_txt is not null and length(v_txt) > 200 then
      raise exception 'That is too long (200 characters at most).' using errcode = '22023';
    end if;
    v_after := case when coalesce(v_txt, '') = '' then null else to_jsonb(v_txt) end;
  elsif p_field = 'incomplete_note' then
    if v_txt is not null and length(v_txt) > 1000 then
      raise exception 'That note is too long (1000 characters at most).' using errcode = '22023';
    end if;
    v_after := case when coalesce(v_txt, '') = '' then null else to_jsonb(v_txt) end;
  elsif p_field = 'general_instructions' then
    if v_txt is not null and length(v_txt) > 8000 then
      raise exception 'The instructions are too long (8000 characters at most).' using errcode = '22023';
    end if;
    v_after := case when coalesce(v_txt, '') = '' then null else to_jsonb(v_txt) end;
  elsif p_field in ('is_board_paper', 'has_school', 'instructions_not_printed', 'time_not_printed') then  -- CHANGED
    if v_txt is null or v_txt not in ('true', 'false') then
      raise exception 'Choose yes or no.' using errcode = '22023';
    end if;
    v_after := to_jsonb(v_txt::boolean);
  elsif p_field = 'marks' then
    if coalesce(v_txt, '') = '' then
      v_after := null;
    else
      if v_txt !~ '^[0-9]{1,4}(\.[0-9]+)?$' then
        raise exception 'Total marks must be a number.' using errcode = '22023';
      end if;
      v_num := v_txt::numeric;
      if v_num > 1000 then
        raise exception 'Total marks must be between 0 and 1000.' using errcode = '22023';
      end if;
      v_after := to_jsonb(v_num);
    end if;
  elsif p_field = 'allowed_time_minutes' then
    if coalesce(v_txt, '') = '' then
      v_after := null;
    else
      if v_txt !~ '^[0-9]{1,3}$' or v_txt::integer < 1 or v_txt::integer > 600 then
        raise exception 'Time allowed must be a whole number of minutes from 1 to 600.' using errcode = '22023';
      end if;
      v_after := to_jsonb(v_txt::integer);
    end if;
  end if;

  v_meta := coalesce(v_p.publish_meta, '{}'::jsonb);
  v_before := v_meta -> p_field;
  if v_after is null then
    v_meta := v_meta - p_field;
  else
    v_meta := jsonb_set(v_meta, array[p_field], v_after, true);
  end if;

  update public.audit_papers set publish_meta = v_meta where id = p_audit_paper_id;

  insert into public.audit_review_log (actor_user_id, paper_id, question_id, action, field, before, after)
  values (auth.uid(), p_audit_paper_id, null, 'hod_edit_publish_meta', p_field, v_before, v_after);

  return v_meta;
end;
$function$;

-- 2. The flags are part of the header values the HOD desk, the preview and the checks all read.
create or replace function public.approval_header_values(p_audit_paper_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'school',   coalesce(nullif(btrim(p.publish_meta ->> 'school'), ''), nullif(btrim(p.school), '')),
    'school_raw', coalesce(nullif(btrim(p.publish_meta ->> 'school_raw'), ''), nullif(btrim(p.school), '')),
    'is_board_paper', coalesce(case when (p.publish_meta ->> 'is_board_paper') in ('true', 'false')
                                    then (p.publish_meta ->> 'is_board_paper')::boolean end, false),
    'has_school', coalesce(case when (p.publish_meta ->> 'has_school') in ('true', 'false')
                                then (p.publish_meta ->> 'has_school')::boolean end, true),
    'cls',      coalesce(nullif(btrim(p.publish_meta ->> 'cls'), ''), nullif(btrim(p.class), '')),
    'subject',  coalesce(nullif(btrim(p.publish_meta ->> 'subject'), ''), nullif(btrim(p.subject), '')),
    'board',    coalesce(nullif(btrim(p.publish_meta ->> 'board'), ''), nullif(btrim(p.board), '')),
    'year',     nullif(coalesce(nullif(btrim(p.publish_meta ->> 'year'), ''), nullif(btrim(p.year), '')), 'year-unknown'),
    'exam',     coalesce(nullif(btrim(p.publish_meta ->> 'exam'), ''), nullif(btrim(p.exam_type), '')),
    'marks',    coalesce(case when (p.publish_meta ->> 'marks') ~ '^[0-9]{1,4}(\.[0-9]+)?$'
                              then (p.publish_meta ->> 'marks')::numeric end,
                         p.max_marks),
    'allowed_time_minutes',
                coalesce(case when (p.publish_meta ->> 'allowed_time_minutes') ~ '^[0-9]{1,3}$'
                              then (p.publish_meta ->> 'allowed_time_minutes')::integer end,
                         p.allowed_time_minutes),
    'general_instructions',
                coalesce(nullif(btrim(p.publish_meta ->> 'general_instructions'), ''), nullif(btrim(p.instructions), '')),
    'incomplete_note', nullif(btrim(p.publish_meta ->> 'incomplete_note'), ''),
    -- NEW: the HOD says the printed paper has no general instructions / no time allowed.
    'instructions_not_printed', coalesce(case when (p.publish_meta ->> 'instructions_not_printed') in ('true', 'false')
                                              then (p.publish_meta ->> 'instructions_not_printed')::boolean end, false),
    'time_not_printed', coalesce(case when (p.publish_meta ->> 'time_not_printed') in ('true', 'false')
                                      then (p.publish_meta ->> 'time_not_printed')::boolean end, false)
  )
  from public.audit_papers p
  where p.id = p_audit_paper_id;
$function$;

-- 3. The go-live check: a missing time or missing instructions passes only when the HOD marked it not printed.
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
    select count(*) into v_ai_only
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
                       'left_out', v_aside, 'open', v_open_eff, 'ai_only', v_ai_only),
    jsonb_build_object('key', 'pictures_present', 'label', 'Pictures are in place',
                       'ok', v_unstaged = 0, 'detail', v_d2),
    jsonb_build_object('key', 'header_complete', 'label', 'Paper details are complete',
                       'ok', coalesce(array_length(v_missing, 1), 0) = 0, 'detail', v_d3),
    jsonb_build_object('key', 'scanner_junk_gone', 'label', 'No scanner junk left',
                       'ok', v_noise = 0, 'detail', v_d4));
end;
$function$;

-- 4. NEW, additive: how many pipeline papers are fully checked (no open question, at least one passed)
-- but not yet queued for the HOD. Same rule as queue_for_approval.py classify() for a new paper.
-- A paper the segmentation guard parked (is_red, "needs re-segment") is not counted: it is not waiting for a queue run.
create or replace function public.hod_unqueued_papers_count()
 returns integer
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  return (
    select count(*)::integer
      from public.audit_papers ap
     where ap.source = 'new_ocr'
       and ap.live_bank_paper_id is null
       and ap.approval_state is null
       and not coalesce(ap.is_red, false)
       and exists (select 1 from public.audit_questions q
                    where q.paper_id = ap.id and q.kind = 'question' and q.question_passed)
       and not exists (select 1 from public.audit_questions q
                        where q.paper_id = ap.id and q.kind = 'question'
                          and not coalesce(q.question_passed, false) and q.set_aside_at is null)
  );
end;
$function$;

revoke all on function public.hod_unqueued_papers_count() from public, anon, authenticated;
grant execute on function public.hod_unqueued_papers_count() to authenticated;
