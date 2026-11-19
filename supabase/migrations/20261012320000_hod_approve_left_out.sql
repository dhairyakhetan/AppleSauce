-- HOD desk follow-up (owner decision 2026-10-12): publishing a paper that has
-- questions left out (set aside) needs an explicit confirmation.
--
-- hod_approve_paper(uuid, text) becomes hod_approve_paper(uuid, text, boolean default false).
-- The third parameter has a default, so every old two-argument call (SQL positional or
-- PostgREST with only p_audit_paper_id and p_note) still resolves to this one function.
-- A separate two-argument wrapper is deliberately NOT kept: two overloads that both match
-- {p_audit_paper_id, p_note} make PostgREST refuse the call (PGRST203).
--
-- After the four checks pass, if the paper has left-out questions and
-- p_confirm_left_out is not true, it refuses with
--   message: 'N questions are left out of this paper. Confirm to publish it without them.'
--            (N = 1: '1 question is left out of this paper. Confirm to publish it without it.')
--   errcode P0001, detail 'left_out:N', hint 'left_out'
-- Question text stays byte-exact; only passed questions are published (approval_publish_paper
-- is untouched). The result gains the key left_out.

drop function if exists public.hod_approve_paper(uuid, text);

create function public.hod_approve_paper(p_audit_paper_id uuid, p_note text default null, p_confirm_left_out boolean default false)
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
  v_left integer;
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

  v_left := coalesce((v_checks -> 0 ->> 'left_out')::integer, 0);
  if v_left > 0 and not coalesce(p_confirm_left_out, false) then
    raise exception '% left out of this paper. Confirm to publish it without %.',
      v_left || case when v_left = 1 then ' question is' else ' questions are' end,
      case when v_left = 1 then 'it' else 'them' end
      using errcode = 'P0001', detail = 'left_out:' || v_left, hint = 'left_out';
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
    'checks', v_checks,
    'left_out', v_left);
end;
$$;

revoke all on function public.hod_approve_paper(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.hod_approve_paper(uuid, text, boolean) to authenticated;
