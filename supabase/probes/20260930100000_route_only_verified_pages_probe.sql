-- Rollback probe for 20260930100000_route_only_verified_pages.sql.
-- Run AFTER applying the migration, in the SQL editor / execute_sql.
-- Everything is inside a transaction that ends in ROLLBACK, so nothing sticks
-- whatever it finds. Any failed check raises an exception (read its text).

begin;

do $probe$
declare
  v_def text;
  v_count integer;
  v_expected integer;
  v_after integer;
  v_qid uuid;
  v_pid uuid;
begin
  -- 1. The routing function carries the new conditions and stays hardened.
  select pg_get_functiondef('public.route_maths_admin_to_checkers(boolean,text[])'::regprocedure) into v_def;
  if v_def not like '%page_verified%' then raise exception 'PROBE: routing function does not test page_verified'; end if;
  if v_def not like '%pdf_mismatch%' then raise exception 'PROBE: routing function does not test pdf_mismatch'; end if;
  if v_def not like '%SECURITY DEFINER%' then raise exception 'PROBE: routing function is not SECURITY DEFINER'; end if;
  if v_def not like '%search_path%pg_temp%' then raise exception 'PROBE: routing function has no pinned search_path'; end if;

  -- 2. Privileges, by role name (has_function_privilege, never proacl strings).
  if has_function_privilege('anon', 'public.route_maths_admin_to_checkers(boolean,text[])', 'EXECUTE') then
    raise exception 'PROBE: anon can execute the routing function'; end if;
  if has_function_privilege('authenticated', 'public.route_maths_admin_to_checkers(boolean,text[])', 'EXECUTE') then
    raise exception 'PROBE: authenticated can execute the routing function'; end if;
  if has_table_privilege('anon', 'public.audit_paper_pages', 'SELECT')
     or has_table_privilege('authenticated', 'public.audit_paper_pages', 'SELECT') then
    raise exception 'PROBE: audit_paper_pages is readable by anon or authenticated'; end if;

  -- 3. Nothing unverified is eligible: the dry run equals an independent count.
  select eligible_questions into v_count from public.route_maths_admin_to_checkers(false);
  select count(*) into v_expected
  from public.audit_questions aq
  join public.audit_papers ap on ap.id = aq.paper_id
  where aq.kind = 'question' and aq.review_bucket = 'admin' and aq.question_passed = false
    and coalesce(aq.status, '') <> 'red' and btrim(coalesce(aq.body, '')) <> ''
    and ap.source in ('live_copy', 'new_ocr') and ap.subject ilike 'Math%'
    and coalesce(aq.source ->> 'pipeline', '') <> 'english_w14'
    and not (coalesce(aq.flag_reasons, array[]::text[])
             && array['possible_duplicate', 'ocr_dropout', 'script_unsupported', 'board_class_mismatch'])
    and (aq.source ->> 'page_verified') = 'true'
    and not ('pdf_mismatch' = any (coalesce(ap.flag_reasons, array[]::text[])))
    and (aq.source ->> 'page') ~ '^[0-9]{1,3}$'
    and exists (select 1 from public.audit_paper_pages pg
                where pg.audit_paper_id = aq.paper_id
                  and pg.page = case when (aq.source ->> 'page') ~ '^[0-9]{1,3}$' then (aq.source ->> 'page')::integer end);
  if v_count <> v_expected then
    raise exception 'PROBE: routing dry run counts %, independent count is %', v_count, v_expected;
  end if;

  -- 4. Flip one eligible row to unverified inside this transaction: it must drop out.
  select aq.id, aq.paper_id into v_qid, v_pid
  from public.audit_questions aq
  join public.audit_papers ap on ap.id = aq.paper_id
  where aq.review_bucket = 'admin' and aq.kind = 'question' and aq.question_passed = false
    and (aq.source ->> 'page_verified') = 'true'
    and not ('pdf_mismatch' = any (coalesce(ap.flag_reasons, array[]::text[])))
  limit 1;
  if v_qid is null then
    raise notice 'PROBE: no verified admin row exists yet (run locate_pages.py --apply first); step 4 skipped';
  else
    update public.audit_questions
    set source = jsonb_set(source, '{page_verified}', 'false'::jsonb)
    where id = v_qid;
    select eligible_questions into v_after from public.route_maths_admin_to_checkers(false);
    if v_after > v_count then raise exception 'PROBE: unverifying a row raised the count (% -> %)', v_count, v_after; end if;
    raise notice 'PROBE: unverifying one row moved the count % -> %', v_count, v_after;

    -- 5. A pdf_mismatch flag on the paper removes every one of its questions.
    update public.audit_questions
    set source = jsonb_set(source, '{page_verified}', 'true'::jsonb)
    where id = v_qid;
    update public.audit_papers
    set flag_reasons = array_append(coalesce(flag_reasons, array[]::text[]), 'pdf_mismatch')
    where id = v_pid;
    select eligible_questions into v_after from public.route_maths_admin_to_checkers(false);
    if v_after > v_count then raise exception 'PROBE: flagging a paper pdf_mismatch raised the count'; end if;
    raise notice 'PROBE: flagging the paper pdf_mismatch moved the count % -> %', v_count, v_after;
  end if;

  raise notice 'PROBE OK: eligible now % ; independent count % ; rolling back', v_count, v_expected;
end
$probe$;

rollback;
