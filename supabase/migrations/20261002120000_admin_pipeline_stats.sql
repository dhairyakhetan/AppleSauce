-- admin_pipeline_stats(): one read-only snapshot for /admin/pipeline, the
-- papers dashboard (owner 2026-10-02: "a dashboard on the admin page ... how
-- many papers, last papers ... graphs stats logs ... in one place").
--
-- Counts only, plus the newest papers' header fields. No question text, no
-- answer keys, no contacts. Admin-only: is_admin() or 42501, and EXECUTE is
-- revoked from public, anon AND authenticated before being granted back to
-- authenticated (Supabase grants new functions to anon by role name).

create or replace function public.admin_pipeline_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
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
$$;

revoke all on function public.admin_pipeline_stats() from public, anon, authenticated;
grant execute on function public.admin_pipeline_stats() to authenticated;
