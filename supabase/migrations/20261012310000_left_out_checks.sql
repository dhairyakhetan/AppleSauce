-- HOD desk follow-up (owner decision 2026-10-12): questions that were set aside are
-- deliberately LEFT OUT of the live paper.
--
-- Check 1 "Every question is checked" now fails only for OPEN questions (neither passed
-- nor set aside), or when no question is passed at all (a paper with nothing to publish).
-- Set-aside questions are reported as left_out:
--   * approval_paper_checks: check 1 gains the keys left_out and open (existing keys unchanged)
--   * hod_ready_papers:      gains a trailing column left_out
--   * hod_paper_preview:     counts.left_out and paper.left_out (existing keys unchanged)
-- Question text is untouched; only passed questions are published, as before.

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
  elsif v_open > 0 then
    v_d1 := v_open || case when v_open = 1 then ' question is' else ' questions are' end
            || ' still open. Every question must be passed or set aside.';
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
                       'ok', v_total > 0 and v_open = 0 and v_passed > 0, 'detail', v_d1,
                       'left_out', v_aside, 'open', v_open),
    jsonb_build_object('key', 'pictures_present', 'label', 'Pictures are in place',
                       'ok', v_unstaged = 0, 'detail', v_d2),
    jsonb_build_object('key', 'header_complete', 'label', 'Paper details are complete',
                       'ok', coalesce(array_length(v_missing, 1), 0) = 0, 'detail', v_d3),
    jsonb_build_object('key', 'scanner_junk_gone', 'label', 'No scanner junk left',
                       'ok', v_noise = 0, 'detail', v_d4));
end;
$$;

-- hod_ready_papers gains a trailing column, so it is dropped and made again (nothing depends on it).
drop function if exists public.hod_ready_papers();

create function public.hod_ready_papers()
returns table(audit_paper_id uuid, title text, subject text, cls text, school text, question_count integer,
              passed_count integer, checks jsonb, board text, year text, exam text, kind text,
              queued_at timestamptz, all_ok boolean, is_live boolean, left_out integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;

  return query
    select ap.id,
           coalesce(nullif(btrim(ap.title), ''),
                    concat_ws(' ', coalesce(ap.publish_meta ->> 'school', ap.school),
                              coalesce(ap.publish_meta ->> 'subject', ap.subject),
                              coalesce(ap.publish_meta ->> 'cls', ap.class),
                              coalesce(ap.publish_meta ->> 'exam', ap.exam_type),
                              nullif(coalesce(ap.publish_meta ->> 'year', ap.year), 'year-unknown'))),
           coalesce(ap.publish_meta ->> 'subject', ap.subject),
           coalesce(ap.publish_meta ->> 'cls', ap.class),
           coalesce(ap.publish_meta ->> 'school', ap.school),
           c.total::integer,
           c.n_passed::integer,
           k.chk,
           coalesce(ap.publish_meta ->> 'board', ap.board),
           coalesce(ap.publish_meta ->> 'year', ap.year),
           coalesce(ap.publish_meta ->> 'exam', ap.exam_type),
           ap.approval_kind,
           ap.queued_at,
           not exists (select 1 from jsonb_array_elements(k.chk) e where not (e ->> 'ok')::boolean),
           coalesce(bp.is_published, false),
           c.n_aside::integer
      from public.audit_papers ap
      cross join lateral (select public.approval_paper_checks(ap.id) as chk) k
      cross join lateral (
        select count(*) filter (where q.kind = 'question') as total,
               count(*) filter (where q.kind = 'question' and q.question_passed) as n_passed,
               count(*) filter (where q.kind = 'question' and not q.question_passed and q.set_aside_at is not null) as n_aside
          from public.audit_questions q where q.paper_id = ap.id
      ) c
      left join public.bank_papers bp on bp.id = ap.live_bank_paper_id
     where ap.approval_state = 'awaiting'
       and ap.source <> 'live_copy'
     order by ap.queued_at, ap.id;
end;
$$;

revoke all on function public.hod_ready_papers() from public, anon, authenticated;
grant execute on function public.hod_ready_papers() to authenticated;

create or replace function public.hod_paper_preview(p_audit_paper_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.audit_papers;
  v_hdr jsonb;
  v_rows jsonb;
  v_counts jsonb;
  v_pages jsonb;
  v_live boolean;
  v_marks_sum numeric;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  select * into v_p from public.audit_papers where id = p_audit_paper_id;
  if v_p.id is null then
    raise exception 'That paper could not be found.' using errcode = 'P0002';
  end if;
  if v_p.source = 'live_copy' then
    raise exception 'This is a live Maths copy. It is frozen and is not part of the HOD desk.' using errcode = '55000';
  end if;

  v_hdr := public.approval_header_values(p_audit_paper_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id,
           'ord', q.ord,
           'kind', q.kind,
           'parent_id', q.parent_id,
           'section_label', q.section_label,
           'number_path', q.number_path,
           'display_number', q.display_number,
           'instructions', q.instructions,
           'body', q.body,
           'options', q.options,
           'marks', q.marks,
           'figure_path', q.figure ->> 'path',
           'figure_storage_path', fg.storage_path,
           'has_picture', (q.figure ->> 'path') is not null or fg.storage_path is not null or fg.id is not null,
           'picture_staged', (q.figure ->> 'path') is not null or fg.id is null,
           'page', case when (q.source ->> 'page') ~ '^[0-9]{1,6}$' then (q.source ->> 'page')::integer end,
           'state', public.approval_question_state(q.kind, q.question_passed, q.set_aside_at),
           'version', q.version,
           'review_bucket', q.review_bucket,
           'flag_reasons', to_jsonb(q.flag_reasons),
           'set_aside_reason', q.set_aside_reason,
           'scanner_junk', exists (select 1 from public.paper_noise_hits(p_audit_paper_id) n where n.question_id = q.id)
         ) order by q.ord, q.id), '[]'::jsonb)
    into v_rows
  from public.audit_questions q
  left join lateral (
    select f.id, f.storage_path from public.audit_figures f
     where f.question_id = q.id and f.status = 'active'
     order by f.ord, f.created_at limit 1
  ) fg on true
  where q.paper_id = p_audit_paper_id;

  select jsonb_build_object(
           'total', count(*) filter (where q.kind = 'question'),
           'passed', count(*) filter (where public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'passed'),
           'open', count(*) filter (where public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open'),
           'set_aside', count(*) filter (where public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'set_aside'),
           'left_out', count(*) filter (where public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'set_aside'))
    into v_counts
  from public.audit_questions q
  where q.paper_id = p_audit_paper_id;

  select coalesce(sum(q.marks), 0) into v_marks_sum
  from public.audit_questions q
  where q.paper_id = p_audit_paper_id and q.kind = 'question' and q.question_passed
    and not exists (select 1 from public.audit_questions c where c.parent_id = q.id and c.marks is not null);

  select coalesce(jsonb_agg(jsonb_build_object('page', pg.page, 'object_path', pg.object_path) order by pg.page), '[]'::jsonb)
    into v_pages
  from public.audit_paper_pages pg
  where pg.audit_paper_id = p_audit_paper_id;

  select bp.is_published into v_live from public.bank_papers bp where bp.id = v_p.live_bank_paper_id;

  return jsonb_build_object(
    'paper', jsonb_build_object(
      'audit_paper_id', v_p.id,
      'title', coalesce(nullif(btrim(v_p.title), ''),
                        concat_ws(' ', v_hdr ->> 'school', v_hdr ->> 'subject', v_hdr ->> 'cls',
                                  v_hdr ->> 'exam', v_hdr ->> 'year')),
      'approval_state', v_p.approval_state,
      'kind', v_p.approval_kind,
      'queued_at', v_p.queued_at,
      'live_bank_paper_id', v_p.live_bank_paper_id,
      'is_live', coalesce(v_live, false),
      'page_count', v_p.page_count,
      'header', v_hdr,
      'publish_meta', v_p.publish_meta,
      'marks_from_questions', v_marks_sum,
      'approval_note', v_p.approval_note,
      'left_out', (v_counts ->> 'left_out')::integer),
    'questions', v_rows,
    'counts', v_counts,
    'pages', v_pages,
    'checks', public.approval_paper_checks(p_audit_paper_id));
end;
$$;
