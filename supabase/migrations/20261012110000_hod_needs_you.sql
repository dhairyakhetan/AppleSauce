-- HOD desk, step 2: the "Needs you" tab.
--
-- One list of papers that hold questions only a human above the students can
-- settle: review_bucket 'escalated' (a student asked for help) and 'admin'
-- (the pipeline routed it to the desk). Open means approval_question_state()
-- = 'open', so passed and set-aside questions drop out.
--
-- Maths live copies (audit_papers.source = 'live_copy') are frozen and are
-- excluded everywhere on the new desk.
--
-- Shapes follow admin_queue_papers / admin_queue_questions so the front end
-- can reuse its row normalisers; the question rows also carry what
-- hod_escalations() returns (who asked, when, why).

create or replace function public.hod_needs_you_papers()
returns table (
  audit_paper_id uuid,
  title text,
  subject text,
  cls text,
  school text,
  is_live boolean,
  escalated integer,
  admin_bucket integer,
  total integer
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
           coalesce(bp.is_published, false),
           w.esc::integer,
           w.adm::integer,
           coalesce(t.n, 0)::integer
      from (
        select q.paper_id as pid,
               count(*) filter (where q.review_bucket = 'escalated') as esc,
               count(*) filter (where q.review_bucket = 'admin') as adm
          from public.audit_questions q
         where q.kind = 'question'
           and q.review_bucket in ('escalated', 'admin')
           and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open'
         group by q.paper_id
      ) w
      join public.audit_papers ap on ap.id = w.pid and ap.source <> 'live_copy'
      left join public.bank_papers bp on bp.id = ap.live_bank_paper_id
      left join lateral (
        select count(*) as n from public.audit_questions q2
         where q2.paper_id = ap.id and q2.kind = 'question'
      ) t on true
     order by (w.esc + w.adm) desc, ap.id;
end;
$$;

create or replace function public.hod_needs_you_questions(p_audit_paper_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_source text;
  v jsonb;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  select ap.source into v_source from public.audit_papers ap where ap.id = p_audit_paper_id;
  if v_source is null then
    raise exception 'That paper could not be found.' using errcode = 'P0002';
  end if;
  if v_source = 'live_copy' then
    raise exception 'This is a live Maths copy. It is frozen and is not part of the HOD desk.' using errcode = '55000';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id,
           'paper_id', q.paper_id,
           'ord', q.ord,
           'kind', q.kind,
           'parent_id', q.parent_id,
           'number_path', q.number_path,
           'display_number', q.display_number,
           'instructions', q.instructions,
           'body', q.body,
           'options', q.options,
           'marks', q.marks,
           'figure_path', q.figure ->> 'path',
           'state', 'open',
           'version', q.version,
           'flag_reasons', to_jsonb(q.flag_reasons),
           'review_bucket', q.review_bucket,
           'live_bank_question_id', q.live_bank_question_id,
           'ai_decision', q.ai_decision,
           'ai_review_reason', q.ai_review_reason,
           'page', case when (q.source ->> 'page') ~ '^[0-9]{1,6}$' then (q.source ->> 'page')::integer end,
           'page_path', pg.object_path,
           'snippet_path', coalesce(nullif(q.source ->> 'snippet_object', ''), nullif(q.source ->> 'whole_snippet_object', '')),
           'escalated_by', e.actor_user_id,
           'escalated_by_name', public.history_actor_from_key(e.actor_user_id::text) ->> 'name',
           'escalated_at', e.at,
           'reason', e.note
         ) order by q.ord, q.id), '[]'::jsonb)
    into v
  from public.audit_questions q
  left join public.audit_paper_pages pg
         on pg.audit_paper_id = q.paper_id
        and (q.source ->> 'page') ~ '^[0-9]{1,6}$'
        and pg.page = (q.source ->> 'page')::integer
  left join lateral (
    select l.actor_user_id, l.at, l.note from public.audit_review_log_counted l
     where l.question_id = q.id and l.action = 'checker_ask_help'
     order by l.at desc limit 1
  ) e on true
  where q.paper_id = p_audit_paper_id
    and q.kind = 'question'
    and q.review_bucket in ('escalated', 'admin')
    and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open';

  return v;
end;
$$;

revoke all on function public.hod_needs_you_papers() from public, anon, authenticated;
grant execute on function public.hod_needs_you_papers() to authenticated;
revoke all on function public.hod_needs_you_questions(uuid) from public, anon, authenticated;
grant execute on function public.hod_needs_you_questions(uuid) to authenticated;
