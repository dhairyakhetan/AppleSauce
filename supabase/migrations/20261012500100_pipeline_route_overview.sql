-- The papers route, brought up to the new way of working, and opened to HODs.
--
-- Owner, 12 Oct 2026: "one pipeline overview page ... how many PDFs are there in total right now on my
-- computer ... how many have been OCR'd, how many run through AI, how many pending image uploads, how
-- many pending clearance from students, how many pending clearance from admin to go live" (for admin
-- AND HOD).
--
-- What changes against 20261011130000_admin_pipeline_route.sql:
--   1. The gate is is_hod() (an admin counts), not is_admin(). Refusals are still 42501. The function
--      returns counts only: no question text, no names, no contacts.
--   2. Papers copied from the earlier library (audit_papers.source = 'live_copy') are frozen and are
--      left out of every count on the route. Before, registry rows for them that were not flagged frozen
--      (774 live ones on 12 Oct) counted as live new-route papers, and the open-question counts included
--      them. A registry row is "left out" when frozen is set OR its source is 'live_copy'.
--   3. "Open" now means what the HOD desk means: not passed AND not set aside.
--   4. New keys, all additive (the old keys keep their names and shapes):
--        registry.read_total / registry.ai_read_total  cumulative: papers that have EVER been read /
--                                                      AI-read, not only the ones sitting at that stage
--        checking   open questions with students, and the papers they sit on
--        needs_you  open escalated + admin questions, and the papers they sit on
--        ready      papers waiting to go live, how many pass all four checks, questions left out
--        live       published papers: made on the new route vs from the earlier library
--        trust      the one AI trust counter (X of 100 checks) and the state of each confidence level
--        pictures   the picture backlog the desk synced (null until the desk has synced once)
--        drive      how many PDFs the desk counted on the computer (null until it has synced once)
--        synced     when the data was last written by the desk, separate from the browser read time
--
-- The two swarm counts the old route carried (desk.swarm_papers, desk.swarm_questions) are gone: finding
-- them means opening the source column of every question (2 seconds on its own), which is too dear for a
-- page that asks every 20 seconds. "Read by the swarm" is counted from the registry instead.
--
-- Speed: the page asks every 20 seconds, so the open questions are read once into a CTE and every
-- block counts from that (a first draft that called approval_question_state per row, five times over,
-- took 30 seconds). "Open" is written out: a real question that is not passed and not set aside.
--
-- Read-only, SECURITY DEFINER, search_path pinned. Revoked from public, anon AND authenticated by name
-- (Supabase grants new functions to anon by role name), then granted to authenticated; the is_hod()
-- check inside is the gate. CREATE OR REPLACE keeps the grants, but they are restated so the file is
-- complete on its own.

create or replace function public.admin_pipeline_route()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v jsonb;
  v_pictures jsonb;
  v_trust jsonb;
  v_ready jsonb;
  v_synced timestamptz;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;

  select to_jsonb(t) - 'id', t.desk_synced_at
    into v_pictures, v_synced
    from public.pipeline_picture_queue t
   where t.id = 1;

  -- The one AI trust counter, and the state of each confidence level (the all-subjects rows only).
  select jsonb_build_object(
           'checks_done', o.checks_done, 'agreed', o.agreed, 'changed', o.changed,
           'threshold', o.threshold, 'reached', o.reached, 'agreement_rate', o.agreement_rate,
           'levels', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'level', m.level, 'decision', m.decision, 'checked', m.checked,
                      'agreed', m.as_is, 'waiting', m.waiting, 'trusted', coalesce(m.trusted, false))
                    order by case m.level when 'high' then 0 when 'medium' then 1 else 2 end, m.decision)
               from public.ai_trust_meter() m
              where m.subject is null), '[]'::jsonb))
    into v_trust
    from public.ai_trust_overall() o;

  -- Papers waiting to go live, and how many of them pass all four checks right now.
  select jsonb_build_object(
           'papers', count(*),
           'can_go_live', count(*) filter (where c.all_ok),
           'left_out_questions', coalesce(sum(c.left_out), 0)::int)
    into v_ready
    from public.audit_papers ap
    cross join lateral (select public.approval_paper_checks(ap.id) as ch) x
    cross join lateral (
      select not exists (select 1 from jsonb_array_elements(x.ch) e where not (e ->> 'ok')::boolean) as all_ok,
             coalesce((x.ch -> 0 ->> 'left_out')::int, 0) as left_out
    ) c
   where ap.approval_state = 'awaiting' and ap.source <> 'live_copy';

  with oq as materialized (
    select q.paper_id, q.review_bucket
      from public.audit_questions q
      join public.audit_papers p on p.id = q.paper_id and p.source <> 'live_copy'
     where q.kind = 'question' and not coalesce(q.question_passed, false) and q.set_aside_at is null
  ),
  allq as materialized (
    select count(*) as total, count(*) filter (where q.question_passed) as passed
      from public.audit_questions q
      join public.audit_papers p on p.id = q.paper_id and p.source <> 'live_copy'
     where q.kind = 'question'
  ),
  kid as materialized (
    select paper_id, count(*) as left_n from oq where review_bucket = 'kid' group by 1
  )
  select jsonb_build_object(
    'generated_at', now(),
    'registry', jsonb_build_object(
      -- every PDF the desk knows, frozen ones included: this is the count of PDFs on the computer
      'total', (select count(*) from public.paper_registry r where not coalesce(r.excluded, false)),
      'excluded', (select count(*) from public.paper_registry r where coalesce(r.excluded, false)),
      -- the route itself: held-back (frozen / earlier library) papers are counted apart
      'by_state', coalesce((
        select jsonb_object_agg(s.st, s.n)
        from (select coalesce(r.processed_state, 'not_started') as st, count(*) as n
              from public.paper_registry r
              where not coalesce(r.excluded, false)
                and not (coalesce(r.frozen, false) or coalesce(r.source, '') = 'live_copy')
              group by 1) s), '{}'::jsonb),
      'frozen_by_state', coalesce((
        select jsonb_object_agg(s.st, s.n)
        from (select coalesce(r.processed_state, 'not_started') as st, count(*) as n
              from public.paper_registry r
              where not coalesce(r.excluded, false)
                and (coalesce(r.frozen, false) or coalesce(r.source, '') = 'live_copy')
              group by 1) s), '{}'::jsonb),
      -- cumulative: a paper that is now checked or live was read first
      'read_total', (select count(*) from public.paper_registry r
                      where not coalesce(r.excluded, false)
                        and not (coalesce(r.frozen, false) or coalesce(r.source, '') = 'live_copy')
                        and r.processed_state in ('ocr_done', 'loaded', 'ai_checked', 'fully_checked', 'awaiting_approval', 'live')),
      'ai_read_total', (select count(*) from public.paper_registry r
                         where not coalesce(r.excluded, false)
                           and not (coalesce(r.frozen, false) or coalesce(r.source, '') = 'live_copy')
                           and r.processed_state in ('ai_checked', 'fully_checked', 'awaiting_approval', 'live')),
      'last_updated_at', (select max(r.updated_at) from public.paper_registry r)
    ),
    -- the review copies on the checking desk (the earlier library's frozen copies are not counted)
    'desk', jsonb_build_object(
      'papers', (select count(*) from public.audit_papers p where p.source = 'new_ocr'),
      'papers_by_status', coalesce((
        select jsonb_object_agg(s.status, s.n)
        from (select p.status, count(*) as n from public.audit_papers p where p.source = 'new_ocr' group by 1) s), '{}'::jsonb),
      'questions', (select total from allq),
      'questions_passed', (select passed from allq)
    ),
    -- questions still open (not passed, not set aside), by the pile that has to clear them
    'open', jsonb_build_object(
      'questions_by_pile', coalesce((
        select jsonb_object_agg(s.b, s.n) from (select review_bucket as b, count(*) as n from oq group by 1) s), '{}'::jsonb),
      'papers_by_pile', coalesce((
        select jsonb_object_agg(s.b, s.n) from (select review_bucket as b, count(distinct paper_id) as n from oq group by 1) s), '{}'::jsonb),
      'student_papers_by_questions_left', coalesce((
        select jsonb_object_agg(s.band, s.n)
        from (select case when left_n <= 5 then '1-5' when left_n <= 15 then '6-15'
                          when left_n <= 40 then '16-40' else '41+' end as band, count(*) as n
              from kid group by 1) s), '{}'::jsonb)
    ),
    'checkers', jsonb_build_object(
      'papers_assigned', (select count(distinct a.audit_paper_id)
                            from public.checker_assignments a
                            join public.audit_papers p on p.id = a.audit_paper_id and p.source <> 'live_copy'
                           where a.status in ('queued', 'assigned')),
      'active_verifiers', (select count(*) from public.paper_checkers c where c.active)
    ),
    -- Checking by students: open questions in the student pile and the papers they sit on.
    'checking', jsonb_build_object(
      'questions', (select count(*) from oq where review_bucket = 'kid'),
      'papers', (select count(*) from kid)),
    -- Needs you: escalated by a student + the admin pile, open only
    'needs_you', jsonb_build_object(
      'questions', (select count(*) from oq where review_bucket in ('escalated', 'admin')),
      'papers', (select count(distinct paper_id) from oq where review_bucket in ('escalated', 'admin')),
      'escalated_questions', (select count(*) from oq where review_bucket = 'escalated'),
      'admin_questions', (select count(*) from oq where review_bucket = 'admin')),
    'ready', v_ready,
    -- Live: what visitors can read. "on_route" = made by this pipeline; the rest is the earlier library.
    'live', (
      select jsonb_build_object(
               'total', count(*) filter (where bp.is_published),
               'hidden', count(*) filter (where not bp.is_published),
               'on_route', count(*) filter (where bp.is_published and exists (
                  select 1 from public.audit_papers ap
                   where ap.live_bank_paper_id = bp.id and ap.source = 'new_ocr')))
        from public.bank_papers bp),
    'trust', v_trust,
    'pictures', v_pictures,
    'drive', (select to_jsonb(d) - 'key' from public.paper_drive_summary d where d.key = 'latest'),
    'synced', jsonb_build_object(
      'desk_synced_at', v_synced,
      'drive_synced_at', (select coalesce(d.updated_at, d.generated_at) from public.paper_drive_summary d where d.key = 'latest'),
      'registry_changed_at', (select max(r.updated_at) from public.paper_registry r))
  ) into v;

  return v;
end;
$$;

revoke all on function public.admin_pipeline_route() from public, anon, authenticated;
grant execute on function public.admin_pipeline_route() to authenticated;
