-- The verify screen shows "What the computer changed": the cleaned words next
-- to the computer's first raw reading of the same question.
--
-- Owner, 11 Oct 2026: "I don't understand how to use the checker UI ... the
-- printed page needs to be highlighted, and what the computer typed needs to be
-- better." The pipeline now keeps the first raw reading of every question it
-- cleans in audit_questions.raw_ocr (db/001_audit_schema.sql in the pipeline
-- repo; the change log sits in source.edit_log, which the functions already
-- return inside `source`). Older rows have no raw_ocr, so the column is simply
-- null for them and the screen shows nothing extra.
--
-- What changes, and nothing else:
--   * audit_questions.raw_ocr text is added if it is not there yet (a no-op
--     where the pipeline already created it).
--   * verifier_next_in_paper(uuid, boolean) returns one more column, raw_ocr,
--     LAST. Every existing column keeps its name, type and position. A function
--     cannot gain an output column through create or replace, so it is dropped
--     and created again with the body of 20261008160000 unchanged apart from the
--     extra column, then its grants are put back (revoked from public, anon and
--     authenticated, granted to authenticated).
--   * verifier_undo_last(uuid) hands the question back as json; it is patched in
--     place (pg_get_functiondef + replace, as 20261008150000 does) so the
--     question it returns carries raw_ocr too. Its grants are untouched.
--   verifier_paper_questions is the list of a paper, not the question being
--   checked, so it is left alone.
--
-- raw_ocr is question text. It reaches a browser only through these SECURITY
-- DEFINER functions, which already check the caller is a paper checker holding
-- the paper. No table grant changes.
--
-- Not applied by whoever wrote it: rehearse (begin; migration; probe; raise)
-- and apply from the coordinator's side.

alter table public.audit_questions add column if not exists raw_ocr text;

drop function if exists public.verifier_next_in_paper(uuid, boolean);

create or replace function public.verifier_next_in_paper(p_paper_id uuid, p_include_skipped boolean default false)
returns table(id uuid, paper_id uuid, ord integer, display_number text, number_path text, body text,
              options jsonb, marks numeric, instructions text, flag_reasons text[], flag_detail text,
              source jsonb, subject text, school text, cls text, exam text, year text, version integer,
              page integer, page_path text, snippet_path text, raw_ocr text)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_claimed uuid;
  v_since timestamptz;
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select a.assigned_at into v_since
  from public.checker_assignments a
  where a.audit_paper_id = p_paper_id and a.user_id = v_uid
    and a.status in ('queued', 'assigned');
  if not found then
    raise exception 'This paper is not assigned to you' using errcode = '42501';
  end if;

  for attempt in 1..5 loop
    v_id := null;
    -- Questions this verifier skipped (while holding the paper) wait: they are
    -- served only on request, the earliest skipped first.
    select aq.id into v_id
    from public.audit_questions aq
    left join lateral (select max(s.skipped_at) as at from public.audit_question_skips s
                       where s.question_id = aq.id and s.user_id = v_uid
                         and s.skipped_at >= v_since) sk on true
    where aq.paper_id = p_paper_id
      and aq.review_bucket = 'kid' and aq.question_passed = false and aq.kind = 'question'
      and public.checker_question_servable(aq)
      and (aq.locked_until is null or aq.locked_until < now() or aq.locked_by = v_uid)
      and (coalesce(p_include_skipped, false) or sk.at is null)
    order by case when aq.locked_by = v_uid and aq.locked_until > now() and sk.at is null then 0 else 1 end,
             sk.at nulls first, aq.ord, aq.id
    limit 1;

    if v_id is null then
      perform public.verifier_close_finished(v_uid);
      return;
    end if;

    update public.audit_questions as aqu
    set locked_by = v_uid, locked_until = now() + interval '10 minutes', leased_at = now()
    where aqu.id = v_id
      and (aqu.locked_until is null or aqu.locked_until < now() or aqu.locked_by = v_uid)
    returning aqu.id into v_claimed;
    exit when v_claimed is not null;
  end loop;

  if v_claimed is null then
    return;
  end if;
  return query
    select aq.id, aq.paper_id, aq.ord, aq.display_number, aq.number_path,
           aq.body, aq.options, aq.marks, aq.instructions,
           aq.flag_reasons, aq.flag_detail, aq.source,
           ap.subject, ap.school, ap.class, ap.exam_type, ap.year, aq.version,
           case when (aq.source ->> 'page') ~ '^[0-9]{1,6}$' then (aq.source ->> 'page')::integer end,
           pg.object_path,
           coalesce(nullif(aq.source ->> 'snippet_object', ''), nullif(aq.source ->> 'whole_snippet_object', '')),
           aq.raw_ocr
    from public.audit_questions aq
    join public.audit_papers ap on ap.id = aq.paper_id
    left join public.audit_paper_pages pg
           on pg.audit_paper_id = aq.paper_id
          and (aq.source ->> 'page') ~ '^[0-9]{1,6}$'
          and pg.page = (aq.source ->> 'page')::integer
    where aq.id = v_claimed;
end;
$$;

-- ------------------------------------------------ the undo hands the row back

do $$
declare
  src text;
  patched text;
begin
  src := pg_get_functiondef('public.verifier_undo_last(uuid)'::regprocedure);
  if position('''raw_ocr'', aq.raw_ocr' in src) > 0 then
    return; -- already patched
  end if;
  patched := replace(
    src,
    '''flag_detail'', aq.flag_detail, ''source'', aq.source,',
    '''flag_detail'', aq.flag_detail, ''raw_ocr'', aq.raw_ocr, ''source'', aq.source,'
  );
  if patched = src then
    raise exception 'patch did not apply: verifier_undo_last (flag_detail line not found)';
  end if;
  execute patched;
end $$;

-- ---------------------------------------------------------------- verify

do $$
declare
  src text;
begin
  src := pg_get_functiondef('public.verifier_next_in_paper(uuid, boolean)'::regprocedure);
  if position('aq.raw_ocr' in src) = 0 or position('raw_ocr text' in src) = 0 then
    raise exception 'patch did not apply: verifier_next_in_paper';
  end if;
  if position('coalesce(p_include_skipped, false) or sk.at is null' in src) = 0 then
    raise exception 'patch did not apply: verifier_next_in_paper lost the skip rule';
  end if;
  src := pg_get_functiondef('public.verifier_undo_last(uuid)'::regprocedure);
  if position('''raw_ocr'', aq.raw_ocr' in src) = 0 then
    raise exception 'patch did not apply: verifier_undo_last';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'audit_questions' and column_name = 'raw_ocr') then
    raise exception 'audit_questions.raw_ocr is missing';
  end if;
end $$;

-- ---------------------------------------------------------------- grants

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.verifier_next_in_paper(uuid, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
