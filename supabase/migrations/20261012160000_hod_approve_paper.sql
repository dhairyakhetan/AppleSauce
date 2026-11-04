-- HOD desk, step 7: publish a paper from the HOD desk.
--
-- Runs the four hard checks (every question checked, pictures in place, paper
-- details complete, scanner junk gone). If any fails it refuses with a plain
-- message that lists what is wrong. If all pass it goes through the SAME
-- publish path as admin_approve_paper (approval_publish_paper), so the live
-- paper is written identically: question text byte-exact, no answer key.
--
-- Before publishing, the details the HOD saw in the preview (which may come
-- from the audit paper's own columns rather than publish_meta) are written
-- into publish_meta, so the live paper shows exactly what the preview showed.
-- Only school, class, subject, board, year and total marks need this; the
-- other fields already fall back identically inside the publish path.
--
-- A retro paper (already live) is only recorded as approved, as before.

create or replace function public.hod_approve_paper(p_audit_paper_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.audit_papers;
  v_checks jsonb;
  v_failed text;
  v_hdr jsonb;
  v_meta jsonb;
  v_fill jsonb;
  v_key text;
  v_bank text;
  v_qc integer;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;

  select * into v_p from public.audit_papers where id = p_audit_paper_id for update;
  if v_p.id is null then
    raise exception 'That paper could not be found.' using errcode = 'P0002';
  end if;
  if v_p.source = 'live_copy' then
    raise exception 'This is a live Maths copy. It is frozen and is not part of the HOD desk.' using errcode = '55000';
  end if;
  if v_p.approval_state is distinct from 'awaiting' then
    raise exception 'This paper is not waiting to go live.' using errcode = '55000';
  end if;

  v_checks := public.approval_paper_checks(p_audit_paper_id);
  select string_agg(e ->> 'label' || ': ' || (e ->> 'detail'), ' ')
    into v_failed
    from jsonb_array_elements(v_checks) e
   where not (e ->> 'ok')::boolean;
  if v_failed is not null then
    raise exception 'This paper cannot go live yet. %', v_failed using errcode = '55000';
  end if;

  if v_p.approval_kind <> 'retro' and v_p.live_bank_paper_id is null then
    v_hdr := public.approval_header_values(p_audit_paper_id);
    v_meta := coalesce(v_p.publish_meta, '{}'::jsonb);
    foreach v_key in array array['school', 'cls', 'subject', 'board', 'year'] loop
      if nullif(btrim(v_meta ->> v_key), '') is null then
        v_meta := v_meta - v_key;
      end if;
    end loop;
    if not coalesce((v_meta ->> 'marks') ~ '^[0-9]{1,4}(\.[0-9]+)?$', false) then
      v_meta := v_meta - 'marks';
    end if;
    v_fill := jsonb_strip_nulls(jsonb_build_object(
                'school', v_hdr -> 'school', 'cls', v_hdr -> 'cls', 'subject', v_hdr -> 'subject',
                'board', v_hdr -> 'board', 'year', v_hdr -> 'year', 'marks', v_hdr -> 'marks'));
    update public.audit_papers set publish_meta = v_fill || v_meta where id = p_audit_paper_id;
  end if;

  v_bank := public.approval_publish_paper(p_audit_paper_id, v_note);

  select bp.question_count into v_qc from public.bank_papers bp where bp.id = v_bank;

  return jsonb_build_object(
    'live_bank_paper_id', v_bank,
    'kind', v_p.approval_kind,
    'question_count', v_qc,
    'checks', v_checks);
end;
$$;

revoke all on function public.hod_approve_paper(uuid, text) from public, anon, authenticated;
grant execute on function public.hod_approve_paper(uuid, text) to authenticated;
