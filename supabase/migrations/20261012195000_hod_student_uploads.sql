-- HOD desk, step 11: the "Student uploads" tab.
--
-- Submissions from /submit-a-paper land in paper_submissions, which only
-- admins can read or update (RLS). These two functions give HODs a safe path:
--
-- hod_student_uploads(status)  list uploads, newest first (status: pending,
--                              approved, rejected or all). The submitter's
--                              contact details are NOT returned.
-- hod_review_upload(id, decision, note)
--                              approve or reject a pending upload. Approving
--                              records the decision (the upload then enters the
--                              pipeline when the owner runs it); rejecting needs
--                              a reason. It does not create a row in `papers`
--                              (that table is not the library).
--
-- Each decision is written to admin_audit_log, the admin actions log.
-- Opening the files needs a storage rule too: see the next migration.

create or replace function public.hod_student_uploads(p_status text default 'all')
returns table (
  id uuid,
  created_at timestamptz,
  school text,
  board text,
  cls text,
  subject text,
  year text,
  exam_type text,
  submitter_name text,
  file_count integer,
  file_paths text[],
  status text,
  review_note text,
  reviewed_at timestamptz,
  reviewed_by_name text
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
  if coalesce(p_status, 'all') not in ('all', 'pending', 'approved', 'rejected') then
    raise exception 'Choose pending, approved, rejected or all.' using errcode = '22023';
  end if;

  return query
    select s.id, s.created_at, s.school, s.board, s.class, s.subject, s.year, s.exam_type, s.submitter_name,
           coalesce(array_length(s.file_paths, 1), 0)::integer,
           s.file_paths, s.status, s.review_note, s.reviewed_at,
           case when s.reviewed_by is not null then public.history_person_name(s.reviewed_by) end
      from public.paper_submissions s
     where coalesce(p_status, 'all') = 'all' or s.status = p_status
     order by s.created_at desc
     limit 500;
end;
$$;

create or replace function public.hod_review_upload(p_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_s public.paper_submissions;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Choose approved or rejected.' using errcode = '22023';
  end if;
  select * into v_s from public.paper_submissions where paper_submissions.id = p_id for update;
  if v_s.id is null then
    raise exception 'That upload could not be found.' using errcode = 'P0002';
  end if;
  if v_s.status <> 'pending' then
    raise exception 'This upload has already been %.', v_s.status using errcode = '55000';
  end if;
  if p_decision = 'rejected' and v_note is null then
    raise exception 'Say why the upload is being rejected.' using errcode = '22023';
  end if;

  update public.paper_submissions
     set status = p_decision, review_note = v_note, reviewed_at = now(), reviewed_by = auth.uid()
   where paper_submissions.id = p_id;

  insert into public.admin_audit_log (actor_id, actor_name, action, target_type, target_id, target_label, reason)
  values (auth.uid(), coalesce(public.history_person_name(auth.uid()), 'A HOD'),
          case p_decision when 'approved' then 'approve_upload' else 'reject_upload' end,
          'paper_submission', p_id::text,
          left(concat_ws(' ', v_s.school, v_s.subject, v_s.class, v_s.exam_type, v_s.year), 200),
          v_note);

  return jsonb_build_object('id', p_id, 'status', p_decision, 'review_note', v_note);
end;
$$;

revoke all on function public.hod_student_uploads(text) from public, anon, authenticated;
grant execute on function public.hod_student_uploads(text) to authenticated;
revoke all on function public.hod_review_upload(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hod_review_upload(uuid, text, text) to authenticated;
