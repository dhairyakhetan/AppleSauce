-- 20261012200200: explain_assignment(p_checker, p_audit_paper), HOD desk "why this person for this paper".
-- HOD or admin only (42501 for everyone else, anon cannot execute). Read-only; returns jsonb:
--   { "eligible": bool, "score": int, "summary": text,
--     "reasons": [ { "key": "subject|grade|board|school|load|status|frozen", "ok": true|false|null, "text": plain English } ] }
-- ok true = counts in the person's favour, false = a problem (a hard rule when eligible is false), null = neutral.
-- Uses the same numbers as the hand-out (assignment_points) so the explanation always matches what auto-assign does.
-- Plain site copy: no em or en dashes.

create or replace function public.explain_assignment(p_checker uuid, p_audit_paper uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  ap record;
  vp record;
  v_active boolean;
  v_expired boolean;
  v_admin boolean;
  v_sub text;
  v_pref text[];
  v_pg int;
  v_cg int;
  v_known boolean;
  v_pb text;
  v_cb text;
  v_papers int;
  v_load int;
  v_same_s int;
  v_same_g int;
  v_cap int := public.verifier_paper_cap();
  v_school_same boolean;
  v_blockers int := 0;
  v_reasons jsonb := '[]'::jsonb;
  v_pts record;
  v_eligible boolean;
  v_summary text;
  v_who text;
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select a.id, a.subject, a.class, a.board, a.school, a.source, a.publish_meta into ap
  from public.audit_papers a where a.id = p_audit_paper;
  if not found then
    raise exception 'Paper not found' using errcode = '22023';
  end if;
  select v.* into vp from public.verifier_profiles v where v.user_id = p_checker;
  v_active := exists (select 1 from public.paper_checkers pc where pc.user_id = p_checker and pc.active);
  v_admin := exists (select 1 from public.admins ad where ad.id = p_checker);
  v_expired := vp.valid_until is not null and vp.valid_until < current_date;
  v_who := coalesce(nullif(btrim(vp.full_name), ''), 'the verifier');

  v_sub := public.subject_family(ap.subject);
  v_pref := (select array_agg(public.subject_family(s)) from unnest(vp.preferred_subjects) s);
  v_pg := public.class_grade(ap.class);
  v_cg := coalesce(vp.grade, 12);
  v_known := vp.grade is not null;
  v_pb := public.board_family(ap.board);
  v_cb := public.board_family(vp.board);
  v_school_same := public.school_norm(vp.school) is not null
                   and (public.school_norm(vp.school) is not distinct from public.school_norm(ap.school)
                        or public.school_norm(vp.school) is not distinct from public.school_norm(ap.publish_meta ->> 'school'));

  select count(*)::int into v_papers
  from public.checker_assignments a
  where a.user_id = p_checker and a.status in ('queued', 'assigned') and public.verifier_has_work(a.audit_paper_id);
  select coalesce(count(*)::int, 0) into v_load
  from public.checker_assignments a
  join public.audit_questions q on q.paper_id = a.audit_paper_id
  where a.user_id = p_checker and a.status in ('queued', 'assigned')
    and q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question'
    and public.checker_question_servable(q);
  select count(*)::int into v_same_s
  from public.checker_assignments a join public.audit_papers x on x.id = a.audit_paper_id
  where a.user_id = p_checker and a.status in ('queued', 'assigned') and public.subject_family(x.subject) = v_sub;
  select count(*)::int into v_same_g
  from public.checker_assignments a join public.audit_papers x on x.id = a.audit_paper_id
  where a.user_id = p_checker and a.status in ('queued', 'assigned') and public.class_grade(x.class) = v_pg;

  select * into v_pts
  from public.assignment_points(v_sub, v_pg, v_pb, v_pref, v_cg, v_known, v_cb, v_papers, v_load, v_same_s, v_same_g);

  -- hard rules first
  if ap.source = 'live_copy' then
    v_blockers := v_blockers + 1;
    v_reasons := v_reasons || jsonb_build_object('key', 'frozen', 'ok', false,
      'text', 'This is a frozen Maths copy. Those papers are never handed out.');
  end if;
  if not v_active then
    v_blockers := v_blockers + 1;
    v_reasons := v_reasons || jsonb_build_object('key', 'status', 'ok', false,
      'text', 'This person is not an active verifier.');
  elsif v_admin then
    v_blockers := v_blockers + 1;
    v_reasons := v_reasons || jsonb_build_object('key', 'status', 'ok', false,
      'text', 'Admins are not given papers automatically.');
  elsif v_expired then
    v_blockers := v_blockers + 1;
    v_reasons := v_reasons || jsonb_build_object('key', 'status', 'ok', false,
      'text', format('Their details ran out on %s. They need to update them first.', to_char(vp.valid_until, 'DD Mon YYYY')));
  end if;

  -- school
  if v_school_same then
    v_blockers := v_blockers + 1;
    v_reasons := v_reasons || jsonb_build_object('key', 'school', 'ok', false,
      'text', format('Same school (%s). People never get a paper from their own school.', btrim(vp.school)));
  elsif public.school_norm(vp.school) is null or (public.school_norm(ap.school) is null and public.school_norm(ap.publish_meta ->> 'school') is null) then
    v_reasons := v_reasons || jsonb_build_object('key', 'school', 'ok', null,
      'text', 'School is unknown on one side, so it could not be compared.');
  else
    v_reasons := v_reasons || jsonb_build_object('key', 'school', 'ok', true,
      'text', 'Different school from the paper.');
  end if;

  -- class
  if v_pg is null then
    v_reasons := v_reasons || jsonb_build_object('key', 'grade', 'ok', null,
      'text', 'The paper has no class recorded, so class could not be compared.');
  elsif v_pg > v_cg then
    v_blockers := v_blockers + 1;
    v_reasons := v_reasons || jsonb_build_object('key', 'grade', 'ok', false,
      'text', format('This is a Class %s paper and %s is in Class %s. Papers above their class are never given.', v_pg, v_who, v_cg));
  elsif not v_known then
    v_reasons := v_reasons || jsonb_build_object('key', 'grade', 'ok', null,
      'text', format('Their class is not set. This Class %s paper is allowed.', v_pg));
  elsif v_pg >= v_cg - 2 then
    v_reasons := v_reasons || jsonb_build_object('key', 'grade', 'ok', true,
      'text', format('Class %s paper for a Class %s student: inside the Class %s to %s range they get first.', v_pg, v_cg, greatest(v_cg - 2, 1), v_cg));
  else
    v_reasons := v_reasons || jsonb_build_object('key', 'grade', 'ok', null,
      'text', format('Class %s paper is well below their Class %s. Allowed, but they are not the first choice.', v_pg, v_cg));
  end if;

  -- board
  if v_pb is null or v_cb is null then
    v_reasons := v_reasons || jsonb_build_object('key', 'board', 'ok', null,
      'text', 'Board is unknown on one side, so it counts neither way.');
  elsif v_pb = v_cb then
    v_reasons := v_reasons || jsonb_build_object('key', 'board', 'ok', true,
      'text', format('Same board (%s).', v_pb));
  else
    v_reasons := v_reasons || jsonb_build_object('key', 'board', 'ok', false,
      'text', format('The paper is %s and they study %s. Allowed, but a matching board comes first.', v_pb, v_cb));
  end if;

  -- subject
  if coalesce(array_length(v_pref, 1), 0) = 0 then
    v_reasons := v_reasons || jsonb_build_object('key', 'subject', 'ok', null,
      'text', 'They have not picked preferred subjects, so any subject is equal for them.');
  elsif v_sub is not null and v_sub = any(v_pref) then
    v_reasons := v_reasons || jsonb_build_object('key', 'subject', 'ok', true,
      'text', format('%s is one of their preferred subjects (%s).', coalesce(ap.subject, 'This subject'),
                     array_to_string(vp.preferred_subjects, ', ')));
  else
    v_reasons := v_reasons || jsonb_build_object('key', 'subject', 'ok', false,
      'text', format('%s is not on their preferred list (%s). Allowed, but their own subjects come first.',
                     coalesce(ap.subject, 'This subject'), array_to_string(vp.preferred_subjects, ', ')));
  end if;

  -- workload
  if v_papers >= v_cap then
    v_blockers := v_blockers + 1;
    v_reasons := v_reasons || jsonb_build_object('key', 'load', 'ok', false,
      'text', format('They already hold %s papers, which is the limit.', v_papers));
  elsif v_papers = 0 then
    v_reasons := v_reasons || jsonb_build_object('key', 'load', 'ok', true,
      'text', 'They hold no papers right now, so the workload is light.');
  else
    v_reasons := v_reasons || jsonb_build_object('key', 'load', 'ok', case when v_papers <= 3 then true else null end,
      'text', format('They hold %s paper%s with %s open question%s (the limit is %s papers).',
                     v_papers, case when v_papers = 1 then '' else 's' end,
                     v_load, case when v_load = 1 then '' else 's' end, v_cap));
  end if;

  v_eligible := v_blockers = 0;
  v_summary := case
    when not v_eligible then 'Not allowed: ' || (select r ->> 'text' from jsonb_array_elements(v_reasons) r where (r ->> 'ok') = 'false' and (r ->> 'key') not in ('board', 'subject') limit 1)
    when v_pts.total >= 80 then 'Strong match.'
    when v_pts.total >= 40 then 'Reasonable match.'
    else 'Weak match, but allowed.' end;

  return jsonb_build_object('eligible', v_eligible, 'score', v_pts.total, 'summary', v_summary, 'reasons', v_reasons);
end;
$function$;

revoke all on function public.explain_assignment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.explain_assignment(uuid, uuid) to authenticated;
