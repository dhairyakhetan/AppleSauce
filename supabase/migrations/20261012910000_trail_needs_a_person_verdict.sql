-- Students first (owner decision 2026-10-12), step B: the route trail tells the truth.
--
-- hod_paper_trail() put a paper at "Ready" or "Live" and so ticked "Checking by
-- students" even where not one question had been checked by a person. A stop
-- after "Checking by students" now needs every question to have a PERSON verdict
-- (approval_person_verdict(): checked_by_user, or a person's pass or fix in the
-- review log) or to be set aside. AI-only passes do not count.
--
-- Stage of a paper, first match wins (Maths live copies are excluded as before):
--   live        approval_state = 'approved'  (it is on the site, whatever its history)
--   ready       approval_state = 'awaiting' AND every question that is not set aside
--               has a person verdict
--   needs_you   at least one open question in bucket escalated or admin
--               (something a student escalated, or the desk must settle)
--   checking    at least one open question with the students, or no question is open
--               (the rest only owe a person verdict)
--   read        anything else (the swarm has read it; nothing is with people yet)
-- A paper waiting in 'awaiting' with unchecked questions therefore falls back to
-- needs_you or checking instead of showing Ready.
--
-- The return shape is unchanged. hod_desk_counts() reads this function, so its
-- 'ready', 'checking', 'needs_you' and 'read' numbers follow. 'ready_ok' follows
-- approval_paper_checks() (20261012900000).

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
                when ap.approval_state = 'awaiting' and c.no_person = 0 then 'ready'
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
               count(*) filter (where s.st = 'open' and s.bucket in ('escalated', 'admin')) as need,
               count(*) filter (where s.st in ('open', 'passed') and not s.pv) as no_person
          from (select public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) as st,
                       q.review_bucket as bucket,
                       public.approval_person_verdict(q.id, q.checked_by_user) as pv
                  from public.audit_questions q where q.paper_id = ap.id) s
      ) c
      left join public.bank_papers bp on bp.id = ap.live_bank_paper_id
     where ap.source <> 'live_copy'
     order by ap.id;
end;
$$;

revoke all on function public.hod_paper_trail() from public, anon, authenticated;
grant execute on function public.hod_paper_trail() to authenticated;
