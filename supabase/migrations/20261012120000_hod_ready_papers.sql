-- HOD desk, step 3: the "Ready to go live" list.
--
-- Papers the pipeline queued for approval (approval_state = 'awaiting'),
-- each with the four hard checks already worked out so the list can show a
-- green or red mark before anyone opens the paper. Maths live copies are
-- frozen and excluded.
--
-- The first eight columns are the contract; the rest are extras the list can
-- use (board, year, exam, kind new/retro, queued_at, all_ok, is_live).

create or replace function public.hod_ready_papers()
returns table (
  audit_paper_id uuid,
  title text,
  subject text,
  cls text,
  school text,
  question_count integer,
  passed_count integer,
  checks jsonb,
  board text,
  year text,
  exam text,
  kind text,
  queued_at timestamptz,
  all_ok boolean,
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
           coalesce(nullif(btrim(ap.title), ''),
                    concat_ws(' ', coalesce(ap.publish_meta ->> 'school', ap.school),
                              coalesce(ap.publish_meta ->> 'subject', ap.subject),
                              coalesce(ap.publish_meta ->> 'cls', ap.class),
                              coalesce(ap.publish_meta ->> 'exam', ap.exam_type),
                              nullif(coalesce(ap.publish_meta ->> 'year', ap.year), 'year-unknown'))),
           coalesce(ap.publish_meta ->> 'subject', ap.subject),
           coalesce(ap.publish_meta ->> 'cls', ap.class),
           coalesce(ap.publish_meta ->> 'school', ap.school),
           c.total::integer,
           c.n_passed::integer,
           k.chk,
           coalesce(ap.publish_meta ->> 'board', ap.board),
           coalesce(ap.publish_meta ->> 'year', ap.year),
           coalesce(ap.publish_meta ->> 'exam', ap.exam_type),
           ap.approval_kind,
           ap.queued_at,
           not exists (select 1 from jsonb_array_elements(k.chk) e where not (e ->> 'ok')::boolean),
           coalesce(bp.is_published, false)
      from public.audit_papers ap
      cross join lateral (select public.approval_paper_checks(ap.id) as chk) k
      cross join lateral (
        select count(*) filter (where q.kind = 'question') as total,
               count(*) filter (where q.kind = 'question' and q.question_passed) as n_passed
          from public.audit_questions q where q.paper_id = ap.id
      ) c
      left join public.bank_papers bp on bp.id = ap.live_bank_paper_id
     where ap.approval_state = 'awaiting'
       and ap.source <> 'live_copy'
     order by ap.queued_at, ap.id;
end;
$$;

revoke all on function public.hod_ready_papers() from public, anon, authenticated;
grant execute on function public.hod_ready_papers() to authenticated;
