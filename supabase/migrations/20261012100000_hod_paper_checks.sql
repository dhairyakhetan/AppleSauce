-- HOD desk, step 1: the four hard checks that gate going live.
--
--   1. every question is checked   (no open, no set-aside question)
--   2. pictures are in place       (a passed question with a picture has it staged)
--   3. paper details are complete  (school, class, subject, board, year, exam,
--                                   marks, time allowed, general instructions)
--   4. scanner junk is gone        (paper_noise_hits(): noise_* flags and
--                                   obvious watermark phrases)
--
-- Everything here is read-only. The three helper functions are internal: they
-- are revoked from public, anon AND authenticated (Supabase grants EXECUTE to
-- anon and authenticated by role name, so revoking from public alone leaves
-- them open) and are reached only through SECURITY DEFINER functions.
-- hod_paper_checks() is the one door the HOD desk uses.
--
-- Maths live copies (audit_papers.source = 'live_copy') are frozen on the new
-- desk: hod_paper_checks refuses them.

-- ---------------------------------------------------------------------------
-- 4. paper_noise_hits: kept small and separate so it can be improved.
--    Set-aside questions are not published, so junk in them does not count.
-- ---------------------------------------------------------------------------
create or replace function public.paper_noise_hits(p_audit_paper_id uuid)
returns table (question_id uuid, display_number text, reason text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select q.id,
         q.display_number,
         case when exists (select 1 from unnest(coalesce(q.flag_reasons, '{}'::text[])) r
                            where r::text like 'noise\_%')
              then 'Marked as scanner noise'
              else 'Looks like a scanner watermark' end
    from public.audit_questions q
   where q.paper_id = p_audit_paper_id
     and q.set_aside_at is null
     and (
           exists (select 1 from unnest(coalesce(q.flag_reasons, '{}'::text[])) r
                    where r::text like 'noise\_%')
        or coalesce(q.body, '') || ' ' || coalesce(q.instructions, '')
             ~* '(Scanned by|CamScanner|Scanned with|Shot on|Downloaded from|http://|www\.)'
         )
   order by q.ord, q.id;
$$;

revoke all on function public.paper_noise_hits(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The header as it will be published: publish_meta first, the audit paper's
-- own columns as the fallback. Safe casts: a bad value reads as "missing".
-- ---------------------------------------------------------------------------
create or replace function public.approval_header_values(p_audit_paper_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
    'incomplete_note', nullif(btrim(p.publish_meta ->> 'incomplete_note'), '')
  )
  from public.audit_papers p
  where p.id = p_audit_paper_id;
$$;

revoke all on function public.approval_header_values(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The four checks as [{key, label, ok, detail}].
-- ---------------------------------------------------------------------------
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
  if nullif(v_hdr ->> 'school', '') is null then v_missing := v_missing || 'school'; end if;
  if nullif(v_hdr ->> 'cls', '') is null then v_missing := v_missing || 'class'; end if;
  if nullif(v_hdr ->> 'subject', '') is null then v_missing := v_missing || 'subject'; end if;
  if nullif(v_hdr ->> 'board', '') is null then v_missing := v_missing || 'board'; end if;
  if nullif(v_hdr ->> 'year', '') is null then v_missing := v_missing || 'year'; end if;
  if nullif(v_hdr ->> 'exam', '') is null then v_missing := v_missing || 'exam'; end if;
  if v_hdr -> 'marks' is null or jsonb_typeof(v_hdr -> 'marks') <> 'number' then v_missing := v_missing || 'total marks'; end if;
  if v_hdr -> 'allowed_time_minutes' is null or jsonb_typeof(v_hdr -> 'allowed_time_minutes') <> 'number' then
    v_missing := v_missing || 'time allowed';
  end if;
  if nullif(v_hdr ->> 'general_instructions', '') is null then v_missing := v_missing || 'general instructions'; end if;
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

-- ---------------------------------------------------------------------------
-- The HOD desk door.
-- ---------------------------------------------------------------------------
create or replace function public.hod_paper_checks(p_audit_paper_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_source text;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  select ap.source into v_source from public.audit_papers ap where ap.id = p_audit_paper_id;
  if v_source is null then
    raise exception 'That paper could not be found.' using errcode = 'P0002';
  end if;
  if v_source = 'live_copy' then
    raise exception 'This is a live Maths copy. It is frozen and is not part of the HOD desk.' using errcode = '55000';
  end if;
  return public.approval_paper_checks(p_audit_paper_id);
end;
$$;

revoke all on function public.hod_paper_checks(uuid) from public, anon, authenticated;
grant execute on function public.hod_paper_checks(uuid) to authenticated;
