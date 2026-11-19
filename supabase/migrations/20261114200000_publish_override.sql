-- Shikshaq: "Publish anyway" for HODs and admins (14 Nov 2026).
-- Paste this whole file into the Supabase SQL editor and press Run. Then send me a picture of the 5 lines at the
-- bottom (all five should say "ok").
--
-- WHY: the owner asked: "allow me to ignore and pass as an override". Today a paper that fails any of the four
-- publish checks (every question checked, pictures in place, paper details complete, no scanner junk) cannot go
-- live at all. This adds a second, deliberate way: the HOD ticks a box, types why (at least 10 characters), and the
-- paper goes live anyway. The reason, who did it and which checks were skipped are saved in the paper's history.
--
-- WHAT THIS ADDS (the old "Publish" button and every old function keep working exactly as before):
--   1. hod_publish_anyway(paper, reason, note, confirm_left_out)  the new button's function. It runs the same four
--      checks, then publishes through the SAME shared publish function. If a check failed it saves the override in
--      the history. Only an HOD or an admin can run it (anyone else gets "Not authorized").
--   2. hod_override_marks()  a read-only list: which papers were published anyway, by whom, why. The HOD desk uses it
--      for a small marker in Live papers. The public site shows nothing different.
--   3. approval_publish_paper learns one thing: when hod_publish_anyway has switched the override on inside its own
--      call, the "questions still open" and "picture not on the site yet" stops are skipped. Nothing else in that
--      function changes (its text is read from the live database, edited in two places, and re-saved; if the text
--      is not what was expected the paste stops with an error and changes nothing).
--   4. One plain-words line for the history screen.
--
-- WHAT STAYS A HARD STOP (a live paper cannot exist without these, so "Publish anyway" refuses with a plain sentence):
--   * no question is passed yet (there would be nothing to show)
--   * the school, class, subject or board is missing (the live paper needs all four)
--   * questions left out (set aside) still need the usual "I know they will not go live" confirmation
--   * a live Maths copy is frozen and is never published or changed from here
--
-- Question text is never touched. The answer key is never copied (the shared publish function is unchanged in that).
--
-- ROLLBACK (nothing else depends on the new functions):
--   drop function if exists public.hod_publish_anyway(uuid, text, text, boolean);
--   drop function if exists public.hod_override_marks();
--   delete from public.log_action_catalog where action = 'hod_publish_override';
--   -- the shared publish function: to put it back exactly as it was, run the file
--   --   supabase/migrations/20261012150000_shared_publish_function.sql  (the approval_publish_paper part), then
--   --   supabase/migrations/20261106300000_publish_scratch_deletes_need_where.sql  (the "where true" fix).
--   -- Leaving it as it is after a rollback is also safe: with no override switched on it behaves exactly as before.
--   -- Papers already published anyway stay live. Their history lines stay (history is never deleted).

-- 1. The shared publish function: skip two stops only when the override is on ---------------------------------------
do $patch$
declare
  v_oid oid;
  v_def text;
  v_new text;
begin
  select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'approval_publish_paper'
     and pg_get_function_identity_arguments(p.oid) = 'p_audit_paper_id uuid, p_note text';
  if v_oid is null then
    raise exception 'function public.approval_publish_paper(uuid, text) not found';
  end if;

  v_def := pg_get_functiondef(v_oid);
  if v_def like '%shikshaq.publish_override%' then
    return; -- already patched: leave it alone
  end if;

  v_new := v_def;
  v_new := replace(v_new, 'v_try integer := 0;',
    $r$v_try integer := 0;
  v_override boolean := coalesce(current_setting('shikshaq.publish_override', true), '') = 'on';$r$);
  v_new := replace(v_new, 'if v_open > 0 then', 'if v_open > 0 and not v_override then');
  v_new := replace(v_new, 'if v_unstaged > 0 then', 'if v_unstaged > 0 and not v_override then');

  -- Each of the three edits must have happened exactly once, or nothing is saved.
  if v_new not like '%v_override boolean%'
     or v_new not like '%if v_open > 0 and not v_override then%'
     or v_new not like '%if v_unstaged > 0 and not v_override then%'
     or (length(v_new) - length(replace(v_new, 'not v_override', ''))) <> 2 * length('not v_override') then
    raise exception 'approval_publish_paper is not in the shape expected; nothing was changed';
  end if;

  execute v_new;
end
$patch$;

-- 2. Publish anyway ------------------------------------------------------------------------------------------------
create or replace function public.hod_publish_anyway(
  p_audit_paper_id uuid,
  p_reason text,
  p_note text default null,
  p_confirm_left_out boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.audit_papers;
  v_checks jsonb;
  v_failed jsonb;
  v_keys jsonb;
  v_labels jsonb;
  v_label_text text;
  v_hdr jsonb;
  v_meta jsonb;
  v_fill jsonb;
  v_key text;
  v_bank text;
  v_qc integer;
  v_left integer;
  v_passed integer;
  v_missing text[] := '{}';
  v_reason text := btrim(coalesce(p_reason, ''));
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if char_length(v_reason) < 10 then
    raise exception 'Say why you are publishing with this problem (at least 10 characters).' using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'That reason is too long (500 characters at most).' using errcode = '22023';
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
  select coalesce(jsonb_agg(jsonb_build_object('key', e ->> 'key', 'label', e ->> 'label', 'detail', e ->> 'detail')), '[]'::jsonb),
         coalesce(jsonb_agg(e ->> 'key'), '[]'::jsonb),
         coalesce(jsonb_agg(e ->> 'label'), '[]'::jsonb)
    into v_failed, v_keys, v_labels
    from jsonb_array_elements(v_checks) e
   where not (e ->> 'ok')::boolean;

  -- Things a live paper cannot exist without: these are never skipped.
  if v_p.approval_kind <> 'retro' and v_p.live_bank_paper_id is null then
    select count(*) into v_passed
      from public.audit_questions q
     where q.paper_id = p_audit_paper_id and q.kind = 'question'
       and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'passed';
    if v_passed = 0 then
      raise exception 'Publish anyway cannot skip this: no question is passed yet, so there would be nothing to show.'
        using errcode = '55000';
    end if;
    v_hdr := public.approval_header_values(p_audit_paper_id);
    if nullif(btrim(v_hdr ->> 'school'), '') is null then v_missing := array_append(v_missing, 'school'); end if;
    if nullif(btrim(v_hdr ->> 'cls'), '') is null then v_missing := array_append(v_missing, 'class'); end if;
    if nullif(btrim(v_hdr ->> 'subject'), '') is null then v_missing := array_append(v_missing, 'subject'); end if;
    if nullif(btrim(v_hdr ->> 'board'), '') is null then v_missing := array_append(v_missing, 'board'); end if;
    if coalesce(array_length(v_missing, 1), 0) > 0 then
      raise exception 'Publish anyway cannot skip this: the live paper needs a school, class, subject and board. Missing: %.',
        array_to_string(v_missing, ', ') using errcode = '55000';
    end if;
  end if;

  -- Left-out (set aside) questions keep their own confirmation, exactly as in hod_approve_paper.
  v_left := coalesce((v_checks -> 0 ->> 'left_out')::integer, 0);
  if v_left > 0 and not coalesce(p_confirm_left_out, false) then
    raise exception '% left out of this paper. Confirm to publish it without %.',
      v_left || case when v_left = 1 then ' question is' else ' questions are' end,
      case when v_left = 1 then 'it' else 'them' end
      using errcode = 'P0001', detail = 'left_out:' || v_left, hint = 'left_out';
  end if;

  -- Same header fill as hod_approve_paper, so the live paper shows what the preview showed.
  if v_p.approval_kind <> 'retro' and v_p.live_bank_paper_id is null then
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

  -- Switch the override on for this one call only (transaction-local), only when a check really failed.
  if jsonb_array_length(v_keys) > 0 then
    perform set_config('shikshaq.publish_override', 'on', true);
  end if;
  v_bank := public.approval_publish_paper(p_audit_paper_id, v_note);
  perform set_config('shikshaq.publish_override', '', true);

  select bp.question_count into v_qc from public.bank_papers bp where bp.id = v_bank;

  if jsonb_array_length(v_keys) > 0 then
    select string_agg(l, ', ') into v_label_text from jsonb_array_elements_text(v_labels) l;
    insert into public.audit_review_log (actor_user_id, paper_id, question_id, action, before, after, note)
    values (v_uid, p_audit_paper_id, null, 'hod_publish_override',
            jsonb_build_object('failed_checks', v_failed),
            jsonb_build_object('overridden', v_keys, 'overridden_labels', v_labels, 'reason', v_reason,
                               'live_bank_paper_id', v_bank),
            'Why: ' || v_reason || ' Checks skipped: ' || v_label_text || '.');
  end if;

  return jsonb_build_object(
    'live_bank_paper_id', v_bank,
    'kind', v_p.approval_kind,
    'question_count', v_qc,
    'checks', v_checks,
    'left_out', v_left,
    'overridden', v_keys);
end;
$$;

-- 3. Which papers were published anyway (read only) -----------------------------------------------------------------
create or replace function public.hod_override_marks()
returns table(audit_paper_id uuid, live_bank_paper_id text, at timestamptz, by_name text, reason text, skipped text[])
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select distinct on (l.paper_id)
           l.paper_id,
           l.after ->> 'live_bank_paper_id',
           l.at,
           public.history_actor_from_key(l.actor_user_id::text) ->> 'name',
           l.after ->> 'reason',
           array(select jsonb_array_elements_text(coalesce(l.after -> 'overridden_labels', '[]'::jsonb)))
      from public.audit_review_log l
     where l.action = 'hod_publish_override' and l.paper_id is not null
     order by l.paper_id, l.at desc;
end;
$$;

-- 4. The history line, in plain words ------------------------------------------------------------------------------
insert into public.log_action_catalog (action, kind, meaning) values
  ('hod_publish_override', 'admin', 'An HOD or admin published a paper even though a check had failed, and said why')
on conflict (action) do nothing;

-- 5. Who may call them: signed-in people only; each function checks HOD inside ------------------------------------
revoke all on function public.hod_publish_anyway(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.hod_publish_anyway(uuid, text, text, boolean) to authenticated;
revoke all on function public.hod_override_marks() from public, anon, authenticated;
grant execute on function public.hod_override_marks() to authenticated;

-- CHECK: send me a picture of this result. It should show five lines, all "ok". ------------------------------------
select 'publish anyway function exists' as what,
       case when to_regprocedure('public.hod_publish_anyway(uuid, text, text, boolean)') is not null then 'ok' else 'MISSING' end as result
union all
select 'a signed-out visitor cannot run it',
       case when to_regprocedure('public.hod_publish_anyway(uuid, text, text, boolean)') is not null
             and not has_function_privilege('anon', 'public.hod_publish_anyway(uuid, text, text, boolean)', 'execute')
             and not has_function_privilege('anon', 'public.hod_override_marks()', 'execute')
            then 'ok' else 'NOT SAFE' end
union all
select 'a signed-in HOD can run it (it checks HOD inside)',
       case when to_regprocedure('public.hod_publish_anyway(uuid, text, text, boolean)') is not null
             and has_function_privilege('authenticated', 'public.hod_publish_anyway(uuid, text, text, boolean)', 'execute')
             and has_function_privilege('authenticated', 'public.hod_override_marks()', 'execute')
            then 'ok' else 'MISSING' end
union all
select 'the shared publish function understands the override',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'approval_publish_paper'
                            and pg_get_functiondef(p.oid) like '%shikshaq.publish_override%'
                            and pg_get_functiondef(p.oid) like '%delete from pg_temp.approval_leaves where true%')
            then 'ok' else 'MISSING' end
union all
select 'history line exists',
       case when exists (select 1 from public.log_action_catalog where action = 'hod_publish_override') then 'ok' else 'MISSING' end;
