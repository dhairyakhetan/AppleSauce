-- Two questions joined by "OR" become two questions, linked as alternatives.
--
-- Owner, 8 Oct 2026, about a row reading "Compare and contrast ... OR, Explain
-- the role of the Satavahana dynasty ...": "OR separated next section should
-- ideally come as a whole different question, right? (and not in the same
-- question) - i.e., OR being one statement, and the next part being another
-- whole different statement".
--
-- 1. checker_split_question: when the split point sits at an "OR" / "Or" /
--    "OR," (the word alone, with the comma or full stop it may carry), that
--    separator is dropped from both halves and the two halves are linked as
--    alternatives in the format the pipeline and the library already use
--    (contracts/README.md "an OR-choice"): the same alternative_group on both,
--    alternative_label 'main' on the first and 'or' on the second, the second
--    carrying the first's number, marks and chapter. The library shows "OR"
--    between consecutive rows sharing a group (alternativeRuns in
--    bank-paper-display.ts). Every other character of the text is kept byte
--    for byte. The first half is now written through apply_fix_locked (the
--    version lock and history), not a raw update; the second half is a new row
--    (version 1). A split that is not at an OR behaves exactly as before.
-- 2. verifier_or_separator: a row whose whole body is just "OR" is set aside
--    with that reason and the questions either side of it are linked as
--    alternatives if they are not linked yet (through apply_fix_locked, so
--    history shows it and an HOD or admin can put it back).
-- 3. Reaching the live library: a live paper is updated from the checked copy by
--    _update_live_paper, which only copied text, number and marks of questions
--    that were already live. live_paper_plan now also plans alternative_group
--    and alternative_label, and _update_live_paper applies them, so an OR link
--    made on a live paper reaches the library. (New rows already carried both
--    fields.) The old paper_passed chokepoint for live_copy papers is not
--    touched.
--
-- Patches to live functions are done in place (pg_get_functiondef + replace)
-- and the migration refuses to run if one did not apply. Every new or replaced
-- function is revoked from public, anon AND authenticated, then granted to
-- authenticated (the internal helpers to nobody).

-- ---------------------------------------------------------------- the OR rule, in one place

-- Given the two halves a caret would make, drop an OR separator that sits at the
-- cut (starting the second half, or ending the first) and say whether one was
-- there. Case matters: "OR" or "Or", never a lower case "or" inside a sentence;
-- and only the whole word, so "ORANGE" and "FOR" are not separators. Mirrored
-- in src/lib/checker-body.ts (splitOrPlan), which the screen uses to preview.
create or replace function public.split_or_separator(p_first text, p_second text)
returns table(first_part text, second_part text, or_separator boolean)
language plpgsql immutable
set search_path to 'public', 'pg_temp'
as $$
declare
  v_m text;
begin
  first_part := p_first;
  second_part := p_second;
  or_separator := false;

  v_m := substring(p_second from '^[ \t\n\r\f\v]*(?:OR|Or)[,.]?(?:[ \t\n\r\f\v]+|$)');
  if v_m is not null then
    second_part := substr(p_second, length(v_m) + 1);
    or_separator := true;
    return next;
    return;
  end if;

  v_m := substring(p_first from '(?:^|[ \t\n\r\f\v]+)(?:OR|Or)[,.]?[ \t\n\r\f\v]*$');
  if v_m is not null then
    first_part := left(p_first, length(p_first) - length(v_m));
    or_separator := true;
  end if;
  return next;
end;
$$;

-- ---------------------------------------------------------------- split

create or replace function public.checker_split_question(
  p_question_id uuid, p_body_before text, p_split_at int
)
returns table (first_id uuid, second_id uuid)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q public.audit_questions;
  v_first text;
  v_second text;
  v_or boolean := false;
  v_new_id uuid;
  v_group text;
  v_label text;
  v_changes jsonb;
begin
  v_q := public.checker_authorize_question(p_question_id);

  perform pg_advisory_xact_lock(hashtext(v_q.paper_id::text));

  -- Read again under the row lock, so the version used below is the one saved.
  select * into v_q from public.audit_questions where id = p_question_id for update;

  if p_body_before is distinct from v_q.body then
    raise exception 'stale question text, reload and retry' using errcode = '40001';
  end if;

  if exists (
    select 1 from public.audit_questions
    where split_from_id = p_question_id and live_bank_question_id is null
  ) then
    raise exception 'This question already has an unapplied split pending; resolve it before splitting again' using errcode = '40001';
  end if;

  -- length() counts characters (code points); the client converts its
  -- UTF-16 caret to the same unit (src/lib/checker-body.ts codePointOffset).
  if p_split_at is null or p_split_at <= 0 or p_split_at >= length(p_body_before) then
    raise exception 'Split point out of range';
  end if;

  v_first := left(p_body_before, p_split_at);
  v_second := substring(p_body_before from p_split_at + 1);

  -- An OR at the cut is the separator between two questions, not part of either.
  select s.first_part, s.second_part, s.or_separator
    into v_first, v_second, v_or
  from public.split_or_separator(v_first, v_second) s;

  -- A cut on whitespace must not leave a blank half. The queue no longer
  -- serves blank bodies, so a blank half would sit in 'kid' unseen.
  if btrim(v_first) = '' or btrim(v_second) = '' then
    raise exception 'Both parts of a split need some words in them' using errcode = '22023';
  end if;

  update public.audit_questions
  set ord = ord + 1
  where paper_id = v_q.paper_id and ord > v_q.ord;

  -- The first half's words (and its place in an OR pair) go through the
  -- version lock, so history keeps the whole question as it was.
  v_changes := jsonb_build_object('body', v_first);
  if v_or then
    v_group := coalesce(nullif(btrim(v_q.alternative_group), ''), nullif(btrim(v_q.display_number), ''),
                        nullif(btrim(v_q.number_path), ''), v_q.id::text);
    v_label := case when v_q.alternative_label in ('main', 'or') then v_q.alternative_label else 'main' end;
    v_changes := v_changes || jsonb_build_object('alternative_group', v_group, 'alternative_label', v_label);
  end if;
  perform public.apply_fix_locked(
    'audit_questions', p_question_id::text, v_q.version, v_changes, 'checker', 'checker',
    case when v_or then 'split at an OR between two questions' else 'checker split' end);

  update public.audit_questions
  set status = 'flagged', question_passed = false,
      -- the first half is one question now
      flag_reasons = array_remove(coalesce(flag_reasons, array[]::text[]), 'ocr_fused'),
      checked_by_user = auth.uid(), locked_by = null, locked_until = null
  where id = p_question_id;

  if v_or then
    insert into public.audit_questions (
      paper_id, ord, kind, parent_id, section_label, number_path, display_number,
      body, status, question_passed, review_bucket, flag_reasons, split_from_id,
      marks, chapter, chapter_from_paper, alternative_group, alternative_label
    )
    values (
      v_q.paper_id, v_q.ord + 1, 'question', v_q.parent_id, v_q.section_label, v_q.number_path, v_q.display_number,
      v_second, 'flagged', false, 'kid', array['split_from_' || v_q.id::text], p_question_id,
      v_q.marks, v_q.chapter, coalesce(v_q.chapter_from_paper, false), v_group, 'or'
    )
    returning id into v_new_id;
  else
    insert into public.audit_questions (
      paper_id, ord, kind, parent_id, section_label, number_path, display_number,
      body, status, question_passed, review_bucket, flag_reasons, split_from_id
    )
    values (
      v_q.paper_id, v_q.ord + 1, 'question', v_q.parent_id, v_q.section_label, null, null,
      v_second, 'flagged', false, 'kid', array['split_from_' || v_q.id::text], p_question_id
    )
    returning id into v_new_id;
  end if;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after)
  values (null, auth.uid(), v_q.paper_id, p_question_id, 'checker_split', 'body',
          to_jsonb(p_body_before),
          jsonb_build_object('first_id', p_question_id, 'second_id', v_new_id, 'split_at', p_split_at,
                             'or_separator', v_or, 'alternative_group', v_group));

  return query select p_question_id, v_new_id;
end;
$function$;

-- ---------------------------------------------------------------- a row that is only "OR"

create or replace function public.verifier_or_separator(p_question_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_q public.audit_questions;
  v_prev public.audit_questions;
  v_next public.audit_questions;
  v_group text;
  v_prev_group text;
  v_prev_label text;
  v_next_group text;
  v_next_label text;
  v_linked_prev boolean := false;
  v_linked_next boolean := false;
  v_reason constant text := 'This is just the OR between two questions';
begin
  v_q := public.checker_authorize_question(p_question_id);

  perform pg_advisory_xact_lock(hashtext(v_q.paper_id::text));
  select * into v_q from public.audit_questions where id = p_question_id for update;

  if v_q.body is null or v_q.body !~ '^[ \t\n\r\f\v]*(?:OR|Or)[,.]?[ \t\n\r\f\v]*$' then
    raise exception 'This row has more than the word OR in it, so it is not just the OR between two questions.'
      using errcode = '22023';
  end if;

  select * into v_prev
  from public.audit_questions p
  where p.paper_id = v_q.paper_id and p.kind = 'question' and p.set_aside_at is null
    and p.parent_id is not distinct from v_q.parent_id and p.ord < v_q.ord and p.id <> v_q.id
  order by p.ord desc, p.id desc
  limit 1
  for update;
  select * into v_next
  from public.audit_questions p
  where p.paper_id = v_q.paper_id and p.kind = 'question' and p.set_aside_at is null
    and p.parent_id is not distinct from v_q.parent_id and p.ord > v_q.ord and p.id <> v_q.id
  order by p.ord, p.id
  limit 1
  for update;
  if v_prev.id is null or v_next.id is null then
    raise exception 'There is no question on one side of this OR, so the two cannot be linked. Press Ask the HOD.'
      using errcode = '22023';
  end if;

  v_prev_group := nullif(btrim(v_prev.alternative_group), '');
  v_next_group := nullif(btrim(v_next.alternative_group), '');
  v_prev_label := v_prev.alternative_label;
  v_next_label := v_next.alternative_label;
  v_group := coalesce(v_prev_group, v_next_group, nullif(btrim(v_prev.display_number), ''),
                      nullif(btrim(v_prev.number_path), ''), v_prev.id::text);

  -- Link only the sides that are not linked yet.
  if v_prev_group is null then
    perform public.apply_fix_locked(
      'audit_questions', v_prev.id::text, v_prev.version,
      jsonb_build_object('alternative_group', v_group, 'alternative_label', 'main'),
      'checker', 'checker', 'linked as an alternative across an OR');
    v_linked_prev := true;
  end if;
  if v_next_group is null then
    perform public.apply_fix_locked(
      'audit_questions', v_next.id::text, v_next.version,
      jsonb_build_object('alternative_group', v_group, 'alternative_label', 'or'),
      'checker', 'checker', 'linked as an alternative across an OR');
    v_linked_next := true;
  end if;

  update public.audit_questions
  set set_aside_at = now(), set_aside_by = auth.uid(), set_aside_reason = v_reason,
      checked_by_user = auth.uid(), locked_by = null, locked_until = null
  where id = p_question_id;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, field, before, after, note)
  values (null, auth.uid(), v_q.paper_id, p_question_id, 'verifier_or_separator', null,
          jsonb_build_object('before_question', v_prev.id, 'before_group', v_prev_group, 'before_label', v_prev_label,
                             'after_question', v_next.id, 'after_group', v_next_group, 'after_label', v_next_label),
          jsonb_build_object('alternative_group', v_group, 'linked_before', v_linked_prev, 'linked_after', v_linked_next),
          v_reason);

  return jsonb_build_object('question_id', p_question_id, 'alternative_group', v_group,
                            'linked_before', v_linked_prev, 'linked_after', v_linked_next);
end;
$$;

-- ---------------------------------------------------------------- the link reaches the live library

do $$
declare
  src text;
begin
  src := pg_get_functiondef('public.live_paper_plan(uuid)'::regprocedure);
  src := replace(src,
    'b.instructions as b_ins, b.ord as b_ord',
    'b.instructions as b_ins, b.ord as b_ord, b.alternative_group as b_ag, b.alternative_label as b_al');
  src := replace(src,
    'select l.id, l.live_bank_question_id, ''update'', ''ord'',',
    'select l.id, l.live_bank_question_id, ''update'', ''alternative_group'', l.b_ag, l.alternative_group
    from live_ok l
   where nullif(btrim(coalesce(l.alternative_group, '''')), '''') is not null and l.alternative_group is distinct from l.b_ag
  union all
  select l.id, l.live_bank_question_id, ''update'', ''alternative_label'', l.b_al, l.alternative_label
    from live_ok l
   where nullif(btrim(coalesce(l.alternative_label, '''')), '''') is not null and l.alternative_label is distinct from l.b_al
  union all
  select l.id, l.live_bank_question_id, ''update'', ''ord'',');
  if position('b.alternative_group as b_ag' in src) = 0 or position('''alternative_label'', l.b_al' in src) = 0 then
    raise exception 'patch did not apply: live_paper_plan';
  end if;
  execute src;

  src := pg_get_functiondef('public._update_live_paper(uuid, text)'::regprocedure);
  src := replace(src,
    'elsif v_pl.field = ''marks'' then',
    'elsif v_pl.field = ''alternative_group'' then
      update public.bank_questions set alternative_group = v_pl.after_v where id = v_pl.live_id and paper_id = v_lp;
    elsif v_pl.field = ''alternative_label'' then
      update public.bank_questions set alternative_label = v_pl.after_v where id = v_pl.live_id and paper_id = v_lp;
    elsif v_pl.field = ''marks'' then');
  if position('v_pl.field = ''alternative_label''' in src) = 0 then
    raise exception 'patch did not apply: _update_live_paper';
  end if;
  execute src;
end $$;

-- ---------------------------------------------------------------- history words

insert into public.log_action_catalog (action, kind, meaning) values
  ('verifier_or_separator', 'checker', 'A verifier marked a row as just the OR between two questions and linked the questions around it')
on conflict (action) do nothing;

-- ---------------------------------------------------------------- verify

do $$
declare
  src text;
begin
  src := pg_get_functiondef('public.checker_split_question(uuid, text, integer)'::regprocedure);
  if position('split_or_separator' in src) = 0 or position('apply_fix_locked' in src) = 0
     or position('alternative_label' in src) = 0 then
    raise exception 'patch did not apply: checker_split_question';
  end if;
  src := pg_get_functiondef('public.verifier_or_separator(uuid)'::regprocedure);
  if position('This is just the OR between two questions' in src) = 0 then
    raise exception 'patch did not apply: verifier_or_separator';
  end if;
  src := pg_get_functiondef('public.live_paper_plan(uuid)'::regprocedure);
  if position('''alternative_group'', l.b_ag' in src) = 0 then
    raise exception 'patch did not apply: live_paper_plan';
  end if;
  src := pg_get_functiondef('public._update_live_paper(uuid, text)'::regprocedure);
  if position('v_pl.field = ''alternative_group''' in src) = 0 then
    raise exception 'patch did not apply: _update_live_paper';
  end if;

  -- the separator rule behaves on the cases that matter
  if (select s.second_part from public.split_or_separator('A?', E'\nOR\nB') s) is distinct from 'B' then
    raise exception 'patch did not apply: separator at the start of the second half';
  end if;
  if (select s.first_part from public.split_or_separator('A? OR,', ' B') s) is distinct from 'A?' then
    raise exception 'patch did not apply: separator at the end of the first half';
  end if;
  if (select s.or_separator from public.split_or_separator('A', 'ORANGE B') s) then
    raise exception 'patch did not apply: ORANGE is not a separator';
  end if;
end $$;

-- ---------------------------------------------------------------- grants

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.checker_split_question(uuid, text, integer)',
    'public.verifier_or_separator(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  -- Replaced in place: keep them closed to the browser roles.
  foreach f in array array[
    'public.live_paper_plan(uuid)',
    'public._update_live_paper(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;

  -- Internal helper: only the definer functions above call it.
  execute 'revoke all on function public.split_or_separator(text, text) from public, anon, authenticated';
end $$;
