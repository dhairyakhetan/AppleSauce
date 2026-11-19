-- Corrections to papers the pipeline already published reach the site.
--
-- Why: apply_live_copy_paper_to_live() deliberately returns for source
-- 'new_ocr', and admin_approve_paper() records a retro approval without moving
-- anything. So a fix applied to a pipeline-published (new_ocr, already live)
-- paper changed only the review copy: on 2026-10-03, 32 passed questions on 2
-- live papers (def53e, 9bca60) differed from their fixed review rows.
--
-- What: apply_new_ocr_fixes_to_live(audit paper id) is Pass 2 of the
-- chokepoint only: for every PASSED question with a live row IN THIS PAPER,
-- write body / display_number / marks / answer_key where they differ (the
-- byte-exact rule: only on difference), one bank_question_revisions row per
-- field. It never inserts, deletes, reorders, publishes or hides anything.
-- Service role only (the pipeline calls it after apply_plan).

create or replace function public.apply_new_ocr_fixes_to_live(p_audit_paper_id uuid)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_paper record;
  v_q record;
  v_before jsonb;
  v_live_paper_id text;
  v_actor text;
  v_actor_user_id uuid;
  v_source text;
  v_written int := 0;
begin
  select * into v_paper from public.audit_papers where id = p_audit_paper_id;
  if v_paper is null or v_paper.source <> 'new_ocr' or v_paper.live_bank_paper_id is null then
    return 0; -- only pipeline papers that are already live
  end if;
  v_live_paper_id := v_paper.live_bank_paper_id;
  perform pg_advisory_xact_lock(hashtext(v_live_paper_id));

  for v_q in
    select * from public.audit_questions
    where paper_id = p_audit_paper_id
      and kind = 'question'
      and question_passed = true
      and live_bank_question_id is not null
  loop
    v_actor := coalesce(v_q.checked_by, v_q.checked_by_user::text, 'unknown-checker');
    v_actor_user_id := case when v_q.checked_by is null then v_q.checked_by_user else null end;
    v_source := case when v_q.checked_by is null then 'checker' else 'ai' end;

    select to_jsonb(bq.*) into v_before from public.bank_questions bq
      where bq.id = v_q.live_bank_question_id and bq.paper_id = v_live_paper_id;
    if v_before is null then
      insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
      values (null, v_actor_user_id, p_audit_paper_id, v_q.id, 'live_apply',
              'skipped: live_bank_question_id ' || v_q.live_bank_question_id || ' not found in paper ' || v_live_paper_id);
      continue;
    end if;

    if v_q.body is not null and v_q.body is distinct from (v_before->>'body') then
      update public.bank_questions set body = v_q.body
        where id = v_q.live_bank_question_id and paper_id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
      values ('bank_questions', v_q.live_bank_question_id, 'live_apply', 'body',
              to_jsonb(v_before->>'body'), to_jsonb(v_q.body), v_actor, v_actor_user_id, v_source,
              p_audit_paper_id, v_q.id);
      v_written := v_written + 1;
    end if;

    if v_q.display_number is not null and v_q.display_number is distinct from (v_before->>'display_number') then
      update public.bank_questions set display_number = v_q.display_number
        where id = v_q.live_bank_question_id and paper_id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
      values ('bank_questions', v_q.live_bank_question_id, 'live_apply', 'display_number',
              to_jsonb(v_before->>'display_number'), to_jsonb(v_q.display_number), v_actor, v_actor_user_id, v_source,
              p_audit_paper_id, v_q.id);
      v_written := v_written + 1;
    end if;

    if v_q.marks is not null and v_q.marks is distinct from ((v_before->>'marks')::numeric) then
      update public.bank_questions set marks = v_q.marks
        where id = v_q.live_bank_question_id and paper_id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
      values ('bank_questions', v_q.live_bank_question_id, 'live_apply', 'marks',
              to_jsonb((v_before->>'marks')::numeric), to_jsonb(v_q.marks), v_actor, v_actor_user_id, v_source,
              p_audit_paper_id, v_q.id);
      v_written := v_written + 1;
    end if;

    if v_q.answer_key is not null and v_q.answer_key is distinct from (v_before->>'answer_key') then
      update public.bank_questions set answer_key = v_q.answer_key
        where id = v_q.live_bank_question_id and paper_id = v_live_paper_id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
      values ('bank_questions', v_q.live_bank_question_id, 'live_apply', 'answer_key',
              to_jsonb(v_before->>'answer_key'), to_jsonb(v_q.answer_key), v_actor, v_actor_user_id, v_source,
              p_audit_paper_id, v_q.id);
      v_written := v_written + 1;
    end if;
  end loop;

  return v_written;
end;
$function$;

-- Closed to the browser: Supabase grants EXECUTE to anon and authenticated by
-- role name, so revoking from public alone is not enough.
revoke all on function public.apply_new_ocr_fixes_to_live(uuid) from public, anon, authenticated;
grant execute on function public.apply_new_ocr_fixes_to_live(uuid) to service_role;
