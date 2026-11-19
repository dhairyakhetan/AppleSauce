-- 20261012600000: the pipeline page for HODs (owner decision 2026-10-12: "HODs may see the whole Admin pipeline page").
--
-- Audit: Shikshaq Papers\pipeline\swarm\logs\pipeline_hod_exposure_20261012.md. admin_pipeline_route() already admits
-- is_hod(). The four reads below were is_admin() only, and none of them returns a person field. They are copied here as
-- NEW hod_* functions with the gate is_hod() (an admin counts). The existing admin_* functions are NOT touched.
--
--   hod_pipeline_stats()                    = admin_pipeline_stats(): library, subjects, boards, desk, queues, 15 newest
--                                             papers (school is an institution), 30-day daily counts. Counts and paper facts.
--   hod_registry_summary()                  = admin_paper_registry_summary(): counts by state, subject, board.
--   hod_registry(state, search, subject,    = admin_paper_registry(): the desk's list of every paper. ONE pdf_name in the
--                limit, offset)               registry holds an email-shaped string (checked 12 Oct 2026: 1 of 8,049 rows,
--                                             pdf_name only; registry_key, school, bank_paper_id, subject, board are clean).
--                                             For anyone who is not an admin, pdf_name is returned with any word holding
--                                             an @ replaced by [hidden], and the search runs against that redacted
--                                             text, so an HOD cannot probe for the hidden part. An admin sees it as is.
--   hod_nav_counts()                        = admin_nav_counts(): four counts (applications, reviews, ready, admin queue).
--
-- NOT opened: admin_activity_feed() returns an account id and free text, so it stays admin-only and the page hides that
-- panel from HODs.
--
-- Rule for every hod_* function: SECURITY DEFINER, search_path = public, pg_temp, is_hod() checked inside (42501),
-- EXECUTE revoked from public, anon AND authenticated and then granted to authenticated only (Supabase's default
-- privileges grant EXECUTE to the roles by name, so revoking from public alone does not close a function).

create or replace function public.hod_pipeline_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v jsonb;
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  with bp as (
    select b.*, (b.subject ilike '%math%') as is_maths from bank_papers b
  ),
  library as (
    select jsonb_build_object(
      'papers', count(*),
      'published', count(*) filter (where is_published),
      'verified', count(*) filter (where is_published and not coalesce(needs_review, false)),
      'needs_review', count(*) filter (where is_published and coalesce(needs_review, false)),
      'hidden', count(*) filter (where not is_published),
      'questions', coalesce(sum(question_count) filter (where is_published), 0),
      'maths_papers', count(*) filter (where is_maths),
      'maths_verified', count(*) filter (where is_maths and is_published and not coalesce(needs_review, false)),
      'maths_needs_review', count(*) filter (where is_maths and is_published and coalesce(needs_review, false)),
      'maths_hidden', count(*) filter (where is_maths and not is_published)
    ) j from bp
  ),
  by_subject as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'subject', subject, 'published', published, 'verified', verified,
      'needs_review', needs_review, 'hidden', hidden) order by published desc, subject), '[]'::jsonb) j
    from (
      select subject,
             count(*) filter (where is_published) published,
             count(*) filter (where is_published and not coalesce(needs_review, false)) verified,
             count(*) filter (where is_published and coalesce(needs_review, false)) needs_review,
             count(*) filter (where not is_published) hidden
      from bp group by subject
    ) s
  ),
  by_board as (
    select coalesce(jsonb_object_agg(coalesce(board, 'unknown'), n), '{}'::jsonb) j
    from (select board, count(*) n from bp where is_published group by board) s
  ),
  desk as (
    select jsonb_build_object(
      'papers', count(*),
      'new_scans', count(*) filter (where source is distinct from 'live_copy'),
      'live_copies', count(*) filter (where source = 'live_copy'),
      'passed', count(*) filter (where paper_passed),
      'red', count(*) filter (where is_red),
      'by_status', (select coalesce(jsonb_object_agg(coalesce(status, 'none'), n), '{}'::jsonb)
                    from (select status, count(*) n from audit_papers group by status) s)
    ) j from audit_papers
  ),
  queues as (
    select jsonb_build_object(
      'questions', count(*),
      'passed', count(*) filter (where question_passed),
      'student_queue', count(*) filter (where not coalesce(question_passed, false) and review_bucket = 'kid'),
      'admin_queue', count(*) filter (where not coalesce(question_passed, false) and review_bucket = 'admin'),
      'other_open', count(*) filter (where not coalesce(question_passed, false)
                                       and coalesce(review_bucket, 'none') not in ('kid', 'admin')),
      'with_figure', count(*) filter (where figure is not null)
    ) j from audit_questions where kind = 'question'
  ),
  recent as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'subject', subject, 'cls', cls, 'board', board, 'school', school, 'year', year,
      'exam', exam, 'questions', question_count, 'published', is_published,
      'needs_review', coalesce(needs_review, false), 'created_at', created_at) order by created_at desc), '[]'::jsonb) j
    from (select * from bank_papers order by created_at desc limit 15) r
  ),
  days as (
    select generate_series((current_date - 29)::timestamp, current_date::timestamp, interval '1 day')::date d
  ),
  daily as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'day', d.d,
      'papers_added', (select count(*) from bank_papers b where b.created_at::date = d.d),
      'desk_papers', (select count(*) from audit_papers a where a.created_at::date = d.d),
      'questions_cleared', (select count(*) from audit_questions q
                            where q.question_passed and q.kind = 'question' and q.updated_at::date = d.d)
    ) order by d.d), '[]'::jsonb) j
    from days d
  )
  select jsonb_build_object(
    'generated_at', now(),
    'library', (select j from library),
    'by_subject', (select j from by_subject),
    'by_board', (select j from by_board),
    'desk', (select j from desk),
    'queues', (select j from queues),
    'recent_papers', (select j from recent),
    'daily', (select j from daily)
  ) into v;
  return v;
end;
$function$;

create or replace function public.hod_registry_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v jsonb;
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total', (select count(*) from public.paper_registry r where not coalesce(r.excluded, false)),
    'by_state', coalesce((
      select jsonb_object_agg(s.processed_state, s.n)
      from (
        select coalesce(r.processed_state, 'not_started') as processed_state, count(*) as n
        from public.paper_registry r
        where not coalesce(r.excluded, false)
        group by 1
      ) s
    ), '{}'::jsonb),
    'by_subject', coalesce((
      select jsonb_agg(
        jsonb_build_object('subject', t.subject, 'total', t.total, 'by_state', t.by_state)
        order by t.total desc, t.subject)
      from (
        select x.subject, sum(x.n)::integer as total, jsonb_object_agg(x.processed_state, x.n) as by_state
        from (
          select coalesce(nullif(r.subject, ''), 'Not recorded') as subject,
                 coalesce(r.processed_state, 'not_started') as processed_state,
                 count(*) as n
          from public.paper_registry r
          where not coalesce(r.excluded, false)
          group by 1, 2
        ) x
        group by x.subject
      ) t
    ), '[]'::jsonb),
    'by_board', coalesce((
      select jsonb_object_agg(b.board, b.n)
      from (
        select coalesce(nullif(r.board, ''), 'Not recorded') as board, count(*) as n
        from public.paper_registry r
        where not coalesce(r.excluded, false)
        group by 1
      ) b
    ), '{}'::jsonb),
    'frozen', (select count(*) from public.paper_registry r
               where coalesce(r.frozen, false) and not coalesce(r.excluded, false)),
    'excluded', (select count(*) from public.paper_registry r where coalesce(r.excluded, false)),
    'last_updated_at', (select max(r.updated_at) from public.paper_registry r)
  ) into v;

  return v;
end;
$function$;

create or replace function public.hod_registry(
  p_state text default null,
  p_search text default null,
  p_subject text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_pattern text;
  v_total integer;
  v_rows jsonb;
  v_admin boolean;
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  v_admin := public.is_admin();

  if v_search is not null then
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  -- r.shown_name is pdf_name for an admin and, for anyone else, pdf_name with every word that holds an @ hidden.
  select count(*) into v_total
  from (
    select r.*,
           case when v_admin then r.pdf_name
                else regexp_replace(r.pdf_name, '\S*@\S*', '[hidden]', 'g') end as shown_name
    from public.paper_registry r
  ) r
  where not coalesce(r.excluded, false)
    and (nullif(p_state, '') is null or coalesce(r.processed_state, 'not_started') = p_state)
    and (nullif(p_subject, '') is null
         or coalesce(nullif(r.subject, ''), 'Not recorded') = p_subject)
    and (v_pattern is null
         or r.shown_name ilike v_pattern
         or r.registry_key ilike v_pattern
         or r.bank_paper_id ilike v_pattern
         or r.audit_paper_id::text ilike v_pattern);

  select coalesce(jsonb_agg(to_jsonb(p) - 'state_rank' order by p.state_rank, p.pdf_name nulls last, p.registry_key), '[]'::jsonb)
  into v_rows
  from (
    select r.registry_key, r.shown_name as pdf_name, r.board, r.class, r.subject, r.year, r.school,
           r.ocr_state, coalesce(r.processed_state, 'not_started') as processed_state,
           r.audit_paper_id, r.bank_paper_id, r.source,
           r.questions_total, r.questions_passed, r.open_student, r.open_admin,
           r.approval_state, coalesce(r.frozen, false) as frozen,
           coalesce(r.excluded, false) as excluded, r.updated_at,
           case coalesce(r.processed_state, 'not_started')
             when 'not_started' then 0 when 'ocr_queued' then 1 when 'ocr_done' then 2
             when 'loaded' then 3 when 'ai_checked' then 4 when 'fully_checked' then 5
             when 'awaiting_approval' then 6 else 7 end as state_rank
    from (
      select r0.*,
             case when v_admin then r0.pdf_name
                  else regexp_replace(r0.pdf_name, '\S*@\S*', '[hidden]', 'g') end as shown_name
      from public.paper_registry r0
    ) r
    where not coalesce(r.excluded, false)
      and (nullif(p_state, '') is null or coalesce(r.processed_state, 'not_started') = p_state)
      and (nullif(p_subject, '') is null
           or coalesce(nullif(r.subject, ''), 'Not recorded') = p_subject)
      and (v_pattern is null
           or r.shown_name ilike v_pattern
           or r.registry_key ilike v_pattern
           or r.bank_paper_id ilike v_pattern
           or r.audit_paper_id::text ilike v_pattern)
    order by state_rank, r.shown_name nulls last, r.registry_key
    limit v_limit offset v_offset
  ) p;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$function$;

create or replace function public.hod_nav_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'applications', (select count(*) from public.teacher_applications where status = 'pending'),
    'reviews', (select count(*) from public.teacher_comments where approved = false)
             + (select count(*) from public.teacher_recommendations where status = 'pending'),
    'ready', (select count(*) from public.audit_papers where approval_state = 'awaiting'),
    'admin_queue', (select count(*) from public.audit_questions q
                     where q.review_bucket = 'admin' and q.kind = 'question'
                       and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open'));
end;
$function$;

revoke all on function public.hod_pipeline_stats() from public, anon, authenticated;
revoke all on function public.hod_registry_summary() from public, anon, authenticated;
revoke all on function public.hod_registry(text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.hod_nav_counts() from public, anon, authenticated;
grant execute on function public.hod_pipeline_stats() to authenticated;
grant execute on function public.hod_registry_summary() to authenticated;
grant execute on function public.hod_registry(text, text, text, integer, integer) to authenticated;
grant execute on function public.hod_nav_counts() to authenticated;
