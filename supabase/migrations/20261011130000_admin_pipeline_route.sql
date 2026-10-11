-- The papers route: one admin-only call that says how many papers sit at each stop between
-- "a PDF in the folder" and "live in the library", and how many questions are left at the
-- checking stops.
--
-- Owner, 11 Oct 2026: "show me how many papers are where on that pipeline, like a route ...
-- how many papers are there in the folder, how many done OCR, how many left out like maths,
-- how many processed by Haiku, how many have how many questions left, how many are waiting
-- for the checkers, how many waiting for the admin to approve".
--
-- Counts and names only. No question text and no answer keys leave this function.
-- Sources:
--   paper_registry          one row per PDF the desk knows (folder, read, loaded, ... live); frozen = Maths hold,
--                           excluded = not a real paper
--   audit_questions         source ? 'swarm' marks a question the Haiku swarm cleaned (written by the loader)
--   audit_questions         review_bucket / question_passed give the questions still open at each checking stop
--   checker_assignments     papers currently with a named verifier
--
-- Read-only, SECURITY DEFINER, admin check inside. Revoked from public, anon and authenticated, then
-- granted to authenticated (the admin check is the gate), the same shape as admin_paper_registry_summary().

create or replace function public.admin_pipeline_route()
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

  select jsonb_build_object(
    'generated_at', now(),
    -- the folder, by where each PDF has got to; Maths (frozen) is counted apart so it never inflates a live stop
    'registry', jsonb_build_object(
      'total', (select count(*) from public.paper_registry r where not coalesce(r.excluded, false)),
      'excluded', (select count(*) from public.paper_registry r where coalesce(r.excluded, false)),
      'by_state', coalesce((
        select jsonb_object_agg(s.st, s.n)
        from (select coalesce(r.processed_state, 'not_started') as st, count(*) as n
              from public.paper_registry r
              where not coalesce(r.excluded, false) and not coalesce(r.frozen, false)
              group by 1) s), '{}'::jsonb),
      'frozen_by_state', coalesce((
        select jsonb_object_agg(s.st, s.n)
        from (select coalesce(r.processed_state, 'not_started') as st, count(*) as n
              from public.paper_registry r
              where not coalesce(r.excluded, false) and coalesce(r.frozen, false)
              group by 1) s), '{}'::jsonb),
      'last_updated_at', (select max(r.updated_at) from public.paper_registry r)
    ),
    -- the review copies on the checking desk
    'desk', jsonb_build_object(
      'papers', (select count(*) from public.audit_papers p where p.source = 'new_ocr'),
      'papers_by_status', coalesce((
        select jsonb_object_agg(s.status, s.n)
        from (select p.status, count(*) as n from public.audit_papers p where p.source = 'new_ocr' group by 1) s), '{}'::jsonb),
      'swarm_papers', (select count(distinct q.paper_id) from public.audit_questions q where q.source ? 'swarm'),
      'swarm_questions', (select count(*) from public.audit_questions q where q.source ? 'swarm'),
      'questions', (select count(*) from public.audit_questions q where q.kind = 'question'),
      'questions_passed', (select count(*) from public.audit_questions q where q.kind = 'question' and q.question_passed)
    ),
    -- questions still open, by the pile that has to clear them, and how many papers each pile holds up
    'open', jsonb_build_object(
      'questions_by_pile', coalesce((
        select jsonb_object_agg(s.review_bucket, s.n)
        from (select q.review_bucket, count(*) as n from public.audit_questions q
              where q.kind = 'question' and not q.question_passed group by 1) s), '{}'::jsonb),
      'papers_by_pile', coalesce((
        select jsonb_object_agg(s.review_bucket, s.n)
        from (select q.review_bucket, count(distinct q.paper_id) as n from public.audit_questions q
              where q.kind = 'question' and not q.question_passed group by 1) s), '{}'::jsonb),
      -- a histogram of "how many questions are left" for papers still in the student pile
      'student_papers_by_questions_left', coalesce((
        select jsonb_object_agg(s.band, s.n)
        from (select case when c.left_n <= 5 then '1-5' when c.left_n <= 15 then '6-15'
                          when c.left_n <= 40 then '16-40' else '41+' end as band, count(*) as n
              from (select q.paper_id, count(*) as left_n from public.audit_questions q
                    where q.kind = 'question' and not q.question_passed and q.review_bucket = 'kid'
                    group by 1) c
              group by 1) s), '{}'::jsonb)
    ),
    'checkers', jsonb_build_object(
      'papers_assigned', (select count(distinct a.audit_paper_id) from public.checker_assignments a where a.status in ('queued', 'assigned')),
      'active_verifiers', (select count(*) from public.paper_checkers c where c.active)
    )
  ) into v;

  return v;
end;
$$;

revoke all on function public.admin_pipeline_route() from public, anon, authenticated;
grant execute on function public.admin_pipeline_route() to authenticated;
