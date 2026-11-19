-- Student checker lanes: "no picture, no student" in the database, and lost
-- text a student can confirm (PLAN_ROUND27 3.7, 3.8, 3.9; owner 2026-10-03).
--
-- 1. Belt and braces. checker_next_question() only hands out a question that
--    has a picture: a trusted crop (own or the parent's), a whole-question
--    crop, or a verified page with a row in audit_paper_pages (any subject).
--    The pipeline's enforce_picture_rule.py already moves picture-less
--    questions to an admin; this makes it true between pipeline runs too.
--    The open counts that rank papers use the same two tests.
--
-- 2. Lost text. A question whose words were lost (body blank) used to be
--    skipped. It is now reachable when the AI left a transcription for it
--    (audit_questions.flag_detail carries "suggestion: {"body": ...}") AND it
--    has a picture. The student sees that text beside the page and confirms or
--    corrects it through the existing checker_fix_locked / checker_fix_question,
--    which already refuse a blank body, log, and version the change.
--
-- Two helpers do the testing so the picking query and the counts cannot drift.
-- They take the audit_questions row, are SECURITY DEFINER (they read
-- audit_paper_pages) and are closed to every client role: only
-- checker_next_question() calls them. Nothing else about who may call the RPC,
-- what it returns, the lease or the ordering changes.

create or replace function public.checker_has_picture(p_q public.audit_questions)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select
    coalesce(p_q.source ->> 'whole_snippet_object', '') <> ''
    or (coalesce(p_q.source ->> 'snippet_object', '') <> ''
        and (case when coalesce(p_q.source ->> 'align_score', '') = '' then true
                  when (p_q.source ->> 'align_score') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p_q.source ->> 'align_score')::numeric >= 0.9
                  else false end))
    or exists (
         select 1 from public.audit_questions par
         where par.id = p_q.parent_id
           and (coalesce(par.source ->> 'whole_snippet_object', '') <> ''
                or (coalesce(par.source ->> 'snippet_object', '') <> ''
                    and (case when coalesce(par.source ->> 'align_score', '') = '' then true
                  when (par.source ->> 'align_score') ~ '^-?[0-9]+(\.[0-9]+)?$' then (par.source ->> 'align_score')::numeric >= 0.9
                  else false end))))
    or (p_q.source ->> 'page_verified' = 'true'
        and (p_q.source ->> 'page') ~ '^[0-9]{1,3}$'
        and exists (
              select 1 from public.audit_paper_pages pg
              where pg.audit_paper_id = p_q.paper_id
                and pg.page = case when (p_q.source ->> 'page') ~ '^[0-9]{1,3}$' then (p_q.source ->> 'page')::int end));
$function$;

-- A malformed align_score counts as no crop (the site treats it as doubtful);
-- the regex guards the cast so a bad value cannot make the whole queue error.

create or replace function public.checker_body_ok(p_q public.audit_questions)
 returns boolean
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  select btrim(coalesce(p_q.body, '')) <> ''
      or (coalesce(p_q.flag_detail, '') like '%suggestion: {%body%');
$function$;

revoke all on function public.checker_has_picture(public.audit_questions) from public, anon, authenticated;
revoke all on function public.checker_body_ok(public.audit_questions) from public, anon, authenticated;

create or replace function public.checker_next_question()
 returns table(id uuid, paper_id uuid, ord integer, display_number text, number_path text, body text, options jsonb, marks numeric, instructions text, flag_reasons text[], flag_detail text, source jsonb, subject text, school text, cls text, exam text, year text, version integer)
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_subjects text[];
  v_classes text[];
  v_id uuid;
  v_claimed_id uuid;
  v_tried uuid[] := array[]::uuid[];
  v_attempt int := 0;
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select p.subjects, p.classes into v_subjects, v_classes
  from public.paper_checker_prefs p where p.user_id = v_uid;
  if not found then
    select pc.subjects, pc.classes into v_subjects, v_classes
    from public.paper_checkers pc where pc.user_id = v_uid;
  end if;

  loop
    v_attempt := v_attempt + 1;
    exit when v_attempt > 5;

    with candidates as (
      select aq.id, aq.paper_id, aq.ord, aq.locked_by, aq.locked_until, aq.source,
             ap.subject as p_subject, ap.source as p_source, ap.year as p_year,
             ap.created_at as p_created_at
      from public.audit_questions aq
      join public.audit_papers ap on ap.id = aq.paper_id
      where aq.kind = 'question'
        and aq.review_bucket = 'kid'
        and aq.question_passed = false
        and ap.source in ('live_copy', 'new_ocr')
        and public.checker_body_ok(aq)
        and public.checker_has_picture(aq)
        and (aq.locked_until is null or aq.locked_until < now() or aq.locked_by = v_uid)
        and not (aq.id = any(v_tried))
        and not (coalesce(ap.subject, '') ilike 'English%'
                 or coalesce(aq.source ->> 'pipeline', '') = 'english_w14')
        and (v_subjects is null or array_length(v_subjects, 1) is null or ap.subject = any(v_subjects))
        and (v_classes is null or array_length(v_classes, 1) is null or ap.class = any(v_classes))
        and not exists (
          select 1 from public.audit_question_skips s
          where s.question_id = aq.id and s.user_id = v_uid and s.skipped_at > now() - interval '24 hours'
        )
    ),
    paper_ids as (
      select distinct c0.paper_id from candidates c0
    ),
    paper_open_counts as (
      select p.paper_id,
        (select count(*) from public.audit_questions r
          join public.audit_papers rp on rp.id = r.paper_id
          where r.paper_id = p.paper_id
            and r.kind = 'question'
            and r.review_bucket = 'kid'
            and r.question_passed = false
            and public.checker_body_ok(r)
            and public.checker_has_picture(r)
            and not (coalesce(rp.subject, '') ilike 'English%'
                     or coalesce(r.source ->> 'pipeline', '') = 'english_w14')
        ) as open_count
      from paper_ids p
    ),
    skipped_papers as (
      select distinct aq2.paper_id
      from public.audit_question_skips s2
      join public.audit_questions aq2 on aq2.id = s2.question_id
      join paper_ids p2 on p2.paper_id = aq2.paper_id
      where s2.user_id = v_uid and s2.skipped_at > now() - interval '30 minutes'
    )
    select c.id into v_id
    from candidates c
    left join paper_open_counts poc on poc.paper_id = c.paper_id
    left join skipped_papers sp on sp.paper_id = c.paper_id
    order by
      case when c.locked_by = v_uid and c.locked_until > now() then 0 else 1 end,
      case when sp.paper_id is not null then 1 else 0 end,
      case when coalesce(c.source ->> 'snippet_object', '') <> '' then 0 else 1 end,
      case when c.source ->> 'rescue_decision' = 'ai_doubt' then 1 else 0 end,
      case when c.p_source = 'live_copy' then 0 else 1 end,
      coalesce(poc.open_count, 0),
      case when c.p_year ~ '^\d+$' then c.p_year::int else 0 end desc,
      c.p_created_at, c.ord
    limit 1;

    if v_id is null then
      return;
    end if;

    update public.audit_questions as aqu
    set locked_by = v_uid, locked_until = now() + interval '10 minutes', leased_at = now()
    where aqu.id = v_id
      and (aqu.locked_until is null
           or aqu.locked_until < now()
           or aqu.locked_by = v_uid)
      and aqu.review_bucket = 'kid'
      and not aqu.question_passed
      and public.checker_body_ok(aqu)
      and public.checker_has_picture(aqu)
    returning aqu.id into v_claimed_id;

    if v_claimed_id is not null then
      exit;
    end if;

    v_tried := v_tried || v_id;
    v_id := null;
  end loop;

  if v_claimed_id is null then
    return;
  end if;

  return query
    select aq.id, aq.paper_id, aq.ord, aq.display_number, aq.number_path,
           aq.body, aq.options, aq.marks, aq.instructions,
           aq.flag_reasons, aq.flag_detail, aq.source,
           ap.subject, ap.school, ap.class, ap.exam_type, ap.year,
           aq.version
    from public.audit_questions aq
    join public.audit_papers ap on ap.id = aq.paper_id
    where aq.id = v_claimed_id;
end;
$function$;

revoke all on function public.checker_next_question() from public, anon, authenticated;
grant execute on function public.checker_next_question() to authenticated;
