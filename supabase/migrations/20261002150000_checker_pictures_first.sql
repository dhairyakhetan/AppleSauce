-- Student checker: questions that carry a picture of the printed page come
-- first (owner 2026-10-02: "show questions with images first").
--
-- A picture is audit_questions.source.snippet_object, written by
-- upload_snippets.py. On 2026-10-02 the visible queue held 430 questions with
-- a picture and 645 without; a student checking against the page is the
-- whole point of the kid bucket, so the pictured ones go to the front.
--
-- Only the ORDER BY changes. Who may call it, what it returns, the lease and
-- the filters are untouched. The student's own lease and a paper they just
-- skipped still rank above the picture key, so a question they hold is never
-- taken from them and a skipped paper does not come straight back.
-- CREATE OR REPLACE keeps the existing grants (the function refuses anyone
-- who is not a paper checker).

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
        and btrim(coalesce(aq.body, '')) <> ''
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
            and btrim(coalesce(r.body, '')) <> ''
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

    update public.audit_questions
    set locked_by = v_uid, locked_until = now() + interval '10 minutes', leased_at = now()
    where public.audit_questions.id = v_id
      and (public.audit_questions.locked_until is null
           or public.audit_questions.locked_until < now()
           or public.audit_questions.locked_by = v_uid)
      and public.audit_questions.review_bucket = 'kid'
      and not public.audit_questions.question_passed
      and btrim(coalesce(public.audit_questions.body, '')) <> ''
    returning public.audit_questions.id into v_claimed_id;

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

revoke execute on function public.checker_next_question() from public, anon;
