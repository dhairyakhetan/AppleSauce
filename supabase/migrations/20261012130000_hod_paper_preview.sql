-- HOD desk, step 4: the preview of a paper before it goes live.
--
-- One call returns everything the preview page needs: the header as it will
-- be published (publish_meta first, the audit paper's own columns as the
-- fallback), every row of the paper in order with its picture and tables
-- (tables live inside the body text, rendered by the front end), and the
-- four checks. Question text is returned verbatim.

create or replace function public.hod_paper_preview(p_audit_paper_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.audit_papers;
  v_hdr jsonb;
  v_rows jsonb;
  v_counts jsonb;
  v_pages jsonb;
  v_live boolean;
  v_marks_sum numeric;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  select * into v_p from public.audit_papers where id = p_audit_paper_id;
  if v_p.id is null then
    raise exception 'That paper could not be found.' using errcode = 'P0002';
  end if;
  if v_p.source = 'live_copy' then
    raise exception 'This is a live Maths copy. It is frozen and is not part of the HOD desk.' using errcode = '55000';
  end if;

  v_hdr := public.approval_header_values(p_audit_paper_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id,
           'ord', q.ord,
           'kind', q.kind,
           'parent_id', q.parent_id,
           'section_label', q.section_label,
           'number_path', q.number_path,
           'display_number', q.display_number,
           'instructions', q.instructions,
           'body', q.body,
           'options', q.options,
           'marks', q.marks,
           'figure_path', q.figure ->> 'path',
           'figure_storage_path', fg.storage_path,
           'has_picture', (q.figure ->> 'path') is not null or fg.storage_path is not null or fg.id is not null,
           'picture_staged', (q.figure ->> 'path') is not null or fg.id is null,
           'page', case when (q.source ->> 'page') ~ '^[0-9]{1,6}$' then (q.source ->> 'page')::integer end,
           'state', public.approval_question_state(q.kind, q.question_passed, q.set_aside_at),
           'version', q.version,
           'review_bucket', q.review_bucket,
           'flag_reasons', to_jsonb(q.flag_reasons),
           'set_aside_reason', q.set_aside_reason,
           'scanner_junk', exists (select 1 from public.paper_noise_hits(p_audit_paper_id) n where n.question_id = q.id)
         ) order by q.ord, q.id), '[]'::jsonb)
    into v_rows
  from public.audit_questions q
  left join lateral (
    select f.id, f.storage_path from public.audit_figures f
     where f.question_id = q.id and f.status = 'active'
     order by f.ord, f.created_at limit 1
  ) fg on true
  where q.paper_id = p_audit_paper_id;

  select jsonb_build_object(
           'total', count(*) filter (where q.kind = 'question'),
           'passed', count(*) filter (where public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'passed'),
           'open', count(*) filter (where public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open'),
           'set_aside', count(*) filter (where public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'set_aside'))
    into v_counts
  from public.audit_questions q
  where q.paper_id = p_audit_paper_id;

  -- What the passed questions add up to (a stem whose parts carry marks does
  -- not count twice), so the header's total can be compared with the paper.
  select coalesce(sum(q.marks), 0) into v_marks_sum
  from public.audit_questions q
  where q.paper_id = p_audit_paper_id and q.kind = 'question' and q.question_passed
    and not exists (select 1 from public.audit_questions c where c.parent_id = q.id and c.marks is not null);

  select coalesce(jsonb_agg(jsonb_build_object('page', pg.page, 'object_path', pg.object_path) order by pg.page), '[]'::jsonb)
    into v_pages
  from public.audit_paper_pages pg
  where pg.audit_paper_id = p_audit_paper_id;

  select bp.is_published into v_live from public.bank_papers bp where bp.id = v_p.live_bank_paper_id;

  return jsonb_build_object(
    'paper', jsonb_build_object(
      'audit_paper_id', v_p.id,
      'title', coalesce(nullif(btrim(v_p.title), ''),
                        concat_ws(' ', v_hdr ->> 'school', v_hdr ->> 'subject', v_hdr ->> 'cls',
                                  v_hdr ->> 'exam', v_hdr ->> 'year')),
      'approval_state', v_p.approval_state,
      'kind', v_p.approval_kind,
      'queued_at', v_p.queued_at,
      'live_bank_paper_id', v_p.live_bank_paper_id,
      'is_live', coalesce(v_live, false),
      'page_count', v_p.page_count,
      'header', v_hdr,
      'publish_meta', v_p.publish_meta,
      'marks_from_questions', v_marks_sum,
      'approval_note', v_p.approval_note),
    'questions', v_rows,
    'counts', v_counts,
    'pages', v_pages,
    'checks', public.approval_paper_checks(p_audit_paper_id));
end;
$$;

revoke all on function public.hod_paper_preview(uuid) from public, anon, authenticated;
grant execute on function public.hod_paper_preview(uuid) to authenticated;
