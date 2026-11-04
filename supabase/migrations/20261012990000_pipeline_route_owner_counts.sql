-- The papers route, counted the way the owner asked (12 Oct 2026).
--
-- Owner decisions:
--   (a) "run through AI" is the SWARM only. The old AI-check number is history and leaves the route.
--   (c) "PDFs saved on the main computer" is PDFs on the disk only. Live-only papers and desk papers that
--       have no PDF are a separate small count, never part of that number.
--   (d) "OCR'd" and "read by the AI" are CURRENT STAGE ONLY: each paper is counted once, where it is now.
--       No cumulative "done or later" headline.
--   (b) is on the page: the picture backlog shows papers, pictures and MB side by side (the numbers were
--       already in the pictures section).
--
-- What changes against 20261012500100_pipeline_route_overview.sql (same signature, same return shape,
-- same gate, same grants):
--   registry.read_total and registry.ai_read_total are GONE (cumulative, and the second one was the old
--   AI-check count).
--   registry.swarm_read   NEW  { papers, desk_without_swarm }: papers of the new route whose registry
--                              stage is "loaded" or "ai_checked" (read, on the checking desk, not yet
--                              fully checked), split by whether the swarm has read them (any of their
--                              questions carries a swarm record in source). A paper that has moved on to
--                              fully checked, ready or live is counted at that later stage, not here.
--                              OCR'd, not yet on the desk is registry.by_state.ocr_done, which was already
--                              current stage only.
--   no_pdf                NEW  { audit_papers, live_only }: desk papers with no PDF path recorded, and
--                              published library papers that no desk paper points at.
--
-- The swarm test is limited to the few papers at those two stages (about 80), so it opens the source
-- column of their questions only, not of every question (the reason the earlier swarm counts were taken
-- out of this function). Counts only: no question text, no names, no contacts.
--
-- Read-only, SECURITY DEFINER, search_path pinned. Revoked from public, anon AND authenticated by name,
-- then granted to authenticated; the is_hod() check inside is the gate (an admin counts).

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
  ),
  -- the papers of the new route that are read and on the checking desk but not fully checked yet,
  -- each with "has the swarm read it" (its questions carry a swarm record)
  desk_now as materialized (
    select exists (
             select 1 from public.audit_questions q
              where q.paper_id = r.audit_paper_id and jsonb_exists(q.source, 'swarm')) as swarm_read
      from public.paper_registry r
     where not coalesce(r.excluded, false)
       and not (coalesce(r.frozen, false) or coalesce(r.source, '') = 'live_copy')
       and r.processed_state in ('loaded', 'ai_checked')
       and r.audit_paper_id is not null
  )
  select jsonb_build_object(
    'generated_at', now(),
    'registry', jsonb_build_object(
      -- every PDF the desk knows, frozen ones included. This is the desk's list, NOT the PDFs on the disk
      -- (the page reads that from drive.total_pdfs).
      'total', (select count(*) from public.paper_registry r where not coalesce(r.excluded, false)),
      'excluded', (select count(*) from public.paper_registry r where coalesce(r.excluded, false)),
      -- the route itself, current stage only: held-back (frozen / earlier library) papers are counted apart
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
      -- read by the swarm, where the paper is now (loaded or ai_checked), and the ones there the swarm has not read
      'swarm_read', jsonb_build_object(
        'papers', (select count(*) from desk_now where swarm_read),
        'desk_without_swarm', (select count(*) from desk_now where not swarm_read)),
      'last_updated_at', (select max(r.updated_at) from public.paper_registry r)
    ),
    -- papers the desk has no PDF for: desk papers with no PDF path, and library papers no desk paper points at
    'no_pdf', jsonb_build_object(
      'audit_papers', (select count(*) from public.audit_papers p where nullif(btrim(coalesce(p.pdf_path, '')), '') is null),
      'live_only', (select count(*) from public.bank_papers bp
                     where bp.is_published
                       and not exists (select 1 from public.audit_papers a where a.live_bank_paper_id = bp.id))),
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
