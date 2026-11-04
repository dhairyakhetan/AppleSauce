-- HOD desk, step 5: edit the paper's header before it goes live.
--
-- Before approval nothing could change publish_meta (the details staged for
-- the live paper). This lets a HOD or admin fix one field at a time. Each
-- change is checked, saved on the audit paper, and written to
-- audit_review_log (action 'hod_edit_publish_meta') with the value before and
-- after, the same log the approve and pass/fix actions use.
--
-- Fields: school, school_raw, is_board_paper, year, exam, cls, subject, board,
-- has_school, incomplete_note, marks, allowed_time_minutes, general_instructions.
-- An empty value removes an optional field (the paper's own value is used
-- instead); school, class, subject and board can never be blank.
-- Only before the paper is approved; once it is live, use Live papers.

create or replace function public.hod_update_publish_meta(p_audit_paper_id uuid, p_field text, p_value text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.audit_papers;
  v_meta jsonb;
  v_before jsonb;
  v_after jsonb;
  v_txt text := btrim(p_value);
  v_allowed text[] := array['school', 'school_raw', 'is_board_paper', 'year', 'exam', 'cls', 'subject', 'board',
                            'has_school', 'incomplete_note', 'marks', 'allowed_time_minutes', 'general_instructions'];
  v_num numeric;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  if not coalesce(p_field = any (v_allowed), false) then
    raise exception 'The field "%" cannot be changed here.', coalesce(p_field, '') using errcode = '22023';
  end if;

  select * into v_p from public.audit_papers where id = p_audit_paper_id for update;
  if v_p.id is null then
    raise exception 'That paper could not be found.' using errcode = 'P0002';
  end if;
  if v_p.source = 'live_copy' then
    raise exception 'This is a live Maths copy. It is frozen and is not part of the HOD desk.' using errcode = '55000';
  end if;
  if v_p.approval_state = 'approved' then
    raise exception 'This paper is already approved. Change its details from Live papers.' using errcode = '55000';
  end if;

  if p_field in ('school', 'cls', 'subject', 'board') then
    if v_txt is null or v_txt = '' then
      raise exception 'This cannot be left blank.' using errcode = '22023';
    end if;
    if length(v_txt) > 200 then
      raise exception 'That is too long (200 characters at most).' using errcode = '22023';
    end if;
    v_after := to_jsonb(v_txt);
  elsif p_field in ('school_raw', 'year', 'exam') then
    if v_txt is not null and length(v_txt) > 200 then
      raise exception 'That is too long (200 characters at most).' using errcode = '22023';
    end if;
    v_after := case when coalesce(v_txt, '') = '' then null else to_jsonb(v_txt) end;
  elsif p_field = 'incomplete_note' then
    if v_txt is not null and length(v_txt) > 1000 then
      raise exception 'That note is too long (1000 characters at most).' using errcode = '22023';
    end if;
    v_after := case when coalesce(v_txt, '') = '' then null else to_jsonb(v_txt) end;
  elsif p_field = 'general_instructions' then
    if v_txt is not null and length(v_txt) > 8000 then
      raise exception 'The instructions are too long (8000 characters at most).' using errcode = '22023';
    end if;
    v_after := case when coalesce(v_txt, '') = '' then null else to_jsonb(v_txt) end;
  elsif p_field in ('is_board_paper', 'has_school') then
    if v_txt is null or v_txt not in ('true', 'false') then
      raise exception 'Choose yes or no.' using errcode = '22023';
    end if;
    v_after := to_jsonb(v_txt::boolean);
  elsif p_field = 'marks' then
    if coalesce(v_txt, '') = '' then
      v_after := null;
    else
      if v_txt !~ '^[0-9]{1,4}(\.[0-9]+)?$' then
        raise exception 'Total marks must be a number.' using errcode = '22023';
      end if;
      v_num := v_txt::numeric;
      if v_num > 1000 then
        raise exception 'Total marks must be between 0 and 1000.' using errcode = '22023';
      end if;
      v_after := to_jsonb(v_num);
    end if;
  elsif p_field = 'allowed_time_minutes' then
    if coalesce(v_txt, '') = '' then
      v_after := null;
    else
      if v_txt !~ '^[0-9]{1,3}$' or v_txt::integer < 1 or v_txt::integer > 600 then
        raise exception 'Time allowed must be a whole number of minutes from 1 to 600.' using errcode = '22023';
      end if;
      v_after := to_jsonb(v_txt::integer);
    end if;
  end if;

  v_meta := coalesce(v_p.publish_meta, '{}'::jsonb);
  v_before := v_meta -> p_field;
  if v_after is null then
    v_meta := v_meta - p_field;
  else
    v_meta := jsonb_set(v_meta, array[p_field], v_after, true);
  end if;

  update public.audit_papers set publish_meta = v_meta where id = p_audit_paper_id;

  insert into public.audit_review_log (actor_user_id, paper_id, question_id, action, field, before, after)
  values (auth.uid(), p_audit_paper_id, null, 'hod_edit_publish_meta', p_field, v_before, v_after);

  return v_meta;
end;
$$;

revoke all on function public.hod_update_publish_meta(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hod_update_publish_meta(uuid, text, text) to authenticated;
