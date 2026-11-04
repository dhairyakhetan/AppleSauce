-- HOD desk, step 9: edit the details of a live paper from the HOD desk.
--
-- admin_edit_bank_paper's body moves, unchanged, into an internal function
-- bank_paper_edit_core(paper, field, value, allowed_fields). The admin
-- function becomes "check admin, call the core with the full field list"; the
-- new hod_edit_live_paper does "check HOD, call the core with the HOD list".
-- Same validation, same typed update, same revision row (bank_question_revisions,
-- action admin_edit), so History and undo treat both alike.
--
-- HODs may change: school, year, exam, cls, subject, board, marks,
-- allowed_time_minutes, general_instructions, incomplete_note. Showing or hiding
-- a paper is hod_hide_paper / hod_restore_paper; needs_review is not editable
-- on the HOD desk (the counters no longer use it).
--
-- bank_paper_edit_core is internal: revoked from public, anon AND authenticated.

create or replace function public.bank_paper_edit_core(p_paper_id text, p_field text, p_value text, p_allowed text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_num numeric;
  v_type text;
begin
  if not coalesce(p_field = any(p_allowed), false) then
    raise exception 'Field % is not editable through this function', p_field using errcode = '22023';
  end if;

  if p_field in ('school', 'cls', 'subject') then
    if p_value is null or p_value ~ '^\s*$' then
      raise exception 'This cannot be blank' using errcode = '22023';
    end if;
  elsif p_field = 'marks' then
    if p_value is not null then
      begin
        v_num := p_value::numeric;
      exception when others then
        raise exception 'Marks must be a number' using errcode = '22023';
      end;
      if not (v_num >= 0 and v_num <= 1000) then
        raise exception 'Paper marks must be between 0 and 1000' using errcode = '22023';
      end if;
    end if;
  elsif p_field = 'allowed_time_minutes' then
    if p_value is not null and (case
         when p_value !~ '^[0-9]+$' or length(p_value) > 3 then true
         else p_value::int < 1 or p_value::int > 600
       end) then
      raise exception 'Time allowed must be a whole number of minutes from 1 to 600' using errcode = '22023';
    end if;
  elsif p_field in ('is_published', 'needs_review') then
    if p_value is null or p_value not in ('true', 'false') then
      raise exception '% must be true or false', p_field using errcode = '22023';
    end if;
  elsif p_field in ('year', 'exam', 'board') then
    if p_value is not null and length(p_value) > 200 then
      raise exception '% is too long', p_field using errcode = '22023';
    end if;
  end if;

  select to_jsonb(bp.*) into v_before from public.bank_papers bp where bp.id = p_paper_id;
  if v_before is null then
    raise exception 'Paper not found';
  end if;

  select format_type(a.atttypid, a.atttypmod) into v_type
  from pg_attribute a
  where a.attrelid = 'public.bank_papers'::regclass and a.attname = p_field
    and a.attnum > 0 and not a.attisdropped;
  if v_type is null then
    raise exception 'Field % does not exist', p_field using errcode = '22023';
  end if;

  execute format('update public.bank_papers set %I = $1::%s where id = $2', p_field, v_type)
    using case
      when p_field in ('marks', 'allowed_time_minutes') then p_value::numeric::text
      when p_field in ('is_published', 'needs_review') then p_value::boolean::text
      else p_value
    end, p_paper_id;

  v_after := case
    when p_field in ('marks', 'allowed_time_minutes') then to_jsonb(p_value::numeric)
    when p_field in ('is_published', 'needs_review') then to_jsonb(p_value::boolean)
    else to_jsonb(p_value)
  end;

  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source)
  values ('bank_papers', p_paper_id, 'admin_edit', p_field, v_before->p_field, v_after, auth.uid()::text, auth.uid(), 'admin');
end;
$$;

revoke all on function public.bank_paper_edit_core(text, text, text, text[]) from public, anon, authenticated;

create or replace function public.admin_edit_bank_paper(p_paper_id text, p_field text, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform public.bank_paper_edit_core(p_paper_id, p_field, p_value, array[
    'school', 'year', 'exam', 'cls', 'subject', 'board',
    'marks', 'is_published', 'needs_review', 'allowed_time_minutes',
    'general_instructions', 'incomplete_note'
  ]);
end;
$$;

create or replace function public.hod_edit_live_paper(p_paper_id text, p_field text, p_value text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  perform public.bank_paper_edit_core(p_paper_id, p_field, p_value, array[
    'school', 'year', 'exam', 'cls', 'subject', 'board',
    'marks', 'allowed_time_minutes', 'general_instructions', 'incomplete_note'
  ]);
end;
$$;

revoke all on function public.hod_edit_live_paper(text, text, text) from public, anon, authenticated;
grant execute on function public.hod_edit_live_paper(text, text, text) to authenticated;
