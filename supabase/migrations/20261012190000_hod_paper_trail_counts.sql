-- HOD desk, step 10: the route trail and the tab badges, worked out here.
--
-- One vocabulary everywhere: Read, Checking by students, Needs you, Ready,
-- Live. hod_paper_trail() gives every pipeline paper its current stage and the
-- numbers behind it; hod_desk_counts() gives the numbers for the tab badges
-- (Live and Hidden come from bank_papers.is_published, never from the sticky
-- needs_review flag). Maths live copies are frozen and excluded from both.
--
-- Stage of a paper, first match wins:
--   live        approval_state = 'approved'
--   ready       approval_state = 'awaiting'
--   needs_you   at least one open question in bucket escalated or admin
--   checking    at least one open question with the students, or every
--               question is already settled but the paper is not queued yet
--   read        anything else (the swarm has read it; nothing is with people yet)
-- "Open" is approval_question_state() = 'open' (not passed, not set aside).

create or replace function public.hod_paper_trail()
returns table (
  audit_paper_id uuid,
  stage text,
  total integer,
  passed integer,
  checking integer,
  needs_you integer,
  set_aside integer,
  title text,
  subject text,
  cls text,
  school text,
  is_live boolean
)
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
           case when ap.approval_state = 'approved' then 'live'
                when ap.approval_state = 'awaiting' then 'ready'
                when c.need > 0 then 'needs_you'
                when c.chk > 0 or (c.tot > 0 and c.n_open = 0) then 'checking'
                else 'read' end,
           c.tot::integer, c.n_passed::integer, c.chk::integer, c.need::integer, c.n_aside::integer,
           coalesce(nullif(btrim(ap.title), ''),
                    concat_ws(' ', coalesce(ap.publish_meta ->> 'school', ap.school),
                              coalesce(ap.publish_meta ->> 'subject', ap.subject),
                              coalesce(ap.publish_meta ->> 'cls', ap.class),
                              coalesce(ap.publish_meta ->> 'exam', ap.exam_type),
                              nullif(coalesce(ap.publish_meta ->> 'year', ap.year), 'year-unknown'))),
           coalesce(ap.publish_meta ->> 'subject', ap.subject),
           coalesce(ap.publish_meta ->> 'cls', ap.class),
           coalesce(ap.publish_meta ->> 'school', ap.school),
           coalesce(bp.is_published, false)
      from public.audit_papers ap
      cross join lateral (
        select count(*) filter (where s.st <> 'section') as tot,
               count(*) filter (where s.st = 'passed') as n_passed,
               count(*) filter (where s.st = 'open') as n_open,
               count(*) filter (where s.st = 'set_aside') as n_aside,
               count(*) filter (where s.st = 'open' and s.bucket = 'kid') as chk,
               count(*) filter (where s.st = 'open' and s.bucket in ('escalated', 'admin')) as need
          from (select public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) as st,
                       q.review_bucket as bucket
                  from public.audit_questions q where q.paper_id = ap.id) s
      ) c
      left join public.bank_papers bp on bp.id = ap.live_bank_paper_id
     where ap.source <> 'live_copy'
     order by ap.id;
end;
$$;

create or replace function public.hod_desk_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_trail jsonb;
  v_need_q integer;
  v_ready_ok integer;
  v_live integer;
  v_hidden integer;
  v_uploads integer;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(t.stage, t.n), '{}'::jsonb)
    into v_trail
    from (select stage, count(*) as n from public.hod_paper_trail() group by stage) t;

  select count(*) into v_need_q
    from public.audit_questions q
    join public.audit_papers ap on ap.id = q.paper_id and ap.source <> 'live_copy'
   where q.kind = 'question' and q.review_bucket in ('escalated', 'admin')
     and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open';

  select count(*) into v_ready_ok
    from public.audit_papers ap
   where ap.approval_state = 'awaiting' and ap.source <> 'live_copy'
     and not exists (select 1 from jsonb_array_elements(public.approval_paper_checks(ap.id)) e
                      where not (e ->> 'ok')::boolean);

  select count(*) filter (where bp.is_published), count(*) filter (where not bp.is_published)
    into v_live, v_hidden
    from public.bank_papers bp;

  select count(*) into v_uploads from public.paper_submissions s where s.status = 'pending';

  return jsonb_build_object(
    'read', coalesce((v_trail ->> 'read')::integer, 0),
    'checking', coalesce((v_trail ->> 'checking')::integer, 0),
    'needs_you', coalesce((v_trail ->> 'needs_you')::integer, 0),
    'ready', coalesce((v_trail ->> 'ready')::integer, 0),
    'ready_ok', v_ready_ok,
    'approved', coalesce((v_trail ->> 'live')::integer, 0),
    'needs_you_questions', v_need_q,
    'live', v_live,
    'hidden', v_hidden,
    'student_uploads_pending', v_uploads);
end;
$$;

revoke all on function public.hod_paper_trail() from public, anon, authenticated;
grant execute on function public.hod_paper_trail() to authenticated;
revoke all on function public.hod_desk_counts() from public, anon, authenticated;
grant execute on function public.hod_desk_counts() to authenticated;
