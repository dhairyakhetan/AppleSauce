-- ============================================================================================
-- 20261012_remove_nonmaths.sql   *** OPS SCRIPT, NOT A MIGRATION. Never replayed automatically. ***
--
-- Owner-authorised 2026-10-12 (Shikshaq Supabase project uvtifolnsneitetzohtn):
--   "Delete after backup"; scope "Old stuff only: delete the live non-Maths library papers and the
--   old pre-swarm non-Maths audit copies and checker history. KEEP every swarm-loaded paper".
--   Maths (bank + audit, incl. live_copy and the frozen open questions) is NOT touched.
--
-- DELETE SET
--   bank  : bank_papers whose subject has no 'math' (case-insensitive), EXCEPT the 6 listed in
--           keep6 below (each is the live paper that a KEPT swarm audit paper points at through
--           audit_papers.live_bank_paper_id; deleting them would orphan that swarm paper's link).
--   audit : audit_papers whose subject has no 'math' (NULL subject counts as non-Maths) and whose
--           batch is NOT an audit_batches.label like 'swarm-%' (batch_id NULL counts as not swarm).
--   everything keyed to them: audit_questions, audit_figures, audit_paper_pages, audit_review_log,
--   audit_affordance_log, audit_question_skips, checker_assignments (all ON DELETE CASCADE from
--   audit_papers / audit_questions); bank_questions, question_reports (cascade from bank_papers);
--   content_checks, content_versions, bank_question_revisions, read_events (kind 'paper') (no FK,
--   deleted by id). paper_files keeps its row (FK ON DELETE SET NULL, by design).
--   NOT touched: paper_registry (derived mirror, "never deleted", reconciled by the daily REGISTRY
--   step refresh+sync), admin_audit_log, _deleted_* / _backup_* snapshot tables, audit_batches
--   (a separate step removes only empty non-swarm ones), the 2 audit_review_log rows with NULL
--   paper_id and NULL question_id (unattributable).
--
-- HOW IT RUNS
--   One execute_sql call = one transaction = one chunk. begin isolation level repeatable read so the
--   before/after invariants are an exact comparison inside one snapshot. Every chunk:
--     guards -> pre-counts -> deletes (children without FK first, then the paper row, which cascades)
--     -> leftover check (must be 0) -> delete the content_versions rows (including the delete
--     tombstones that the content_version_log_del triggers just wrote) -> invariants after == before.
--   Any failed check RAISES and rolls the chunk back.
--   Mode REHEARSE (c_rehearse = true) ends with RAISE EXCEPTION, so nothing is kept; the report is in
--   the error text. Mode APPLY (c_rehearse = false) commits and returns the report as the result set.
--   Phase A: c_na = 50, c_nb = 0 (audit side), repeat until it reports "empty".
--   Phase B: c_na = 0,  c_nb = 50 (bank side), repeat until it reports "empty".
--
-- RESTORE: see Shikshaq Papers\pipeline\swarm\logs\remove_nonmaths_20261012.md (insert the JSONL rows
-- back in manifest.json order with the service role).
-- ============================================================================================

-- ---------- the chunk script (params at the top of the DO block) ----------
begin isolation level repeatable read;
set local lock_timeout = '8s';
set local statement_timeout = '170s';
create temp table _rep(j jsonb) on commit drop;

create or replace function pg_temp.inv() returns jsonb language sql stable as $f$
with sw as (select id from public.audit_batches where label like 'swarm-%'),
kp as (select a.id from public.audit_papers a where coalesce(a.subject,'') ~* 'math' or a.batch_id in (select id from sw)),
kq as (select q.id from public.audit_questions q where q.paper_id in (select id from kp)),
bk as (select b.id from public.bank_papers b where coalesce(b.subject,'') ~* 'math'
        or b.id in ('6f53b7','aca95f','b41afa','090047','afefde','12daae'))
select jsonb_build_object(
 'bank_kept_papers',   (select count(*) from bk),
 'bank_math_papers',   (select count(*) from public.bank_papers where coalesce(subject,'') ~* 'math'),
 'bank_kept_q',        (select count(*) from public.bank_questions where paper_id in (select id from bk)),
 'bank_kept_ck',       (select md5(coalesce(string_agg(paper_id||':'||c, ',' order by paper_id), ''))
                          from (select paper_id, count(*) c from public.bank_questions where paper_id in (select id from bk) group by 1) s),
 'bank_kept_versions', (select count(*) from public.content_versions v where (v.table_name='bank_papers' and v.row_id in (select id from bk))
                          or (v.table_name='bank_questions' and v.row_id in (select id from public.bank_questions where paper_id in (select id from bk)))),
 'bank_kept_revisions',(select count(*) from public.bank_question_revisions v where (v.table_name='bank_papers' and v.row_id in (select id from bk))
                          or (v.table_name='bank_questions' and v.row_id in (select id from public.bank_questions where paper_id in (select id from bk)))),
 'bank_kept_reports',  (select count(*) from public.question_reports where paper_id in (select id from bk)),
 'audit_kept_papers',  (select count(*) from kp),
 'audit_math_papers',  (select count(*) from public.audit_papers where coalesce(subject,'') ~* 'math'),
 'swarm_papers',       (select count(*) from public.audit_papers where batch_id in (select id from sw)),
 'audit_kept_q',       (select count(*) from kq),
 'audit_kept_ck',      (select md5(coalesce(string_agg(paper_id||':'||c, ',' order by paper_id), ''))
                          from (select paper_id, count(*) c from public.audit_questions where paper_id in (select id from kp) group by 1) s),
 'audit_kept_figures', (select count(*) from public.audit_figures where paper_id in (select id from kp)),
 'audit_kept_pages',   (select count(*) from public.audit_paper_pages where audit_paper_id in (select id from kp)),
 'audit_kept_review_log', (select count(*) from public.audit_review_log where paper_id in (select id from kp)),
 'audit_kept_affordance', (select count(*) from public.audit_affordance_log where paper_id in (select id from kp)),
 'audit_kept_skips',   (select count(*) from public.audit_question_skips where question_id in (select id from kq)),
 'audit_kept_assignments', (select count(*) from public.checker_assignments where audit_paper_id in (select id from kp)),
 'audit_kept_checks',  (select count(*) from public.content_checks where table_name='audit_questions' and row_id in (select id::text from kq)),
 'audit_kept_versions',(select count(*) from public.content_versions where (table_name='audit_papers' and row_id in (select id::text from kp))
                          or (table_name='audit_questions' and row_id in (select id::text from kq))),
 'servable_kept',      (select count(*) from public.audit_questions q where q.paper_id in (select id from kp) and public.checker_question_servable(q)),
 'paper_files_total',  (select count(*) from public.paper_files),
 'paper_registry_total',(select count(*) from public.paper_registry)
);
$f$;

do $$
declare
  c_na constant int := 50;             -- audit papers this chunk
  c_nb constant int := 0;              -- bank papers this chunk
  c_rehearse constant boolean := true; -- true = RAISE at the end (rolls back); false = commit
  c_T constant timestamptz := '2026-10-12T00:00:00Z';  -- set to (start of the delta dump minus 2 min) when applying
  keep6 constant text[] := array['6f53b7','aca95f','b41afa','090047','afefde','12daae'];
  t0 timestamptz := clock_timestamp();
  swarm uuid[] := array(select id from public.audit_batches where label like 'swarm-%');
  v_ap uuid[] := '{}'; v_aq uuid[] := '{}'; v_bp text[] := '{}'; v_bq text[] := '{}';
  pre jsonb; post jsonb; r jsonb := '{}'::jsonb; n bigint; left_over bigint;
begin
  if coalesce(cardinality(swarm),0) = 0 then raise exception 'GUARD: no swarm batches found'; end if;
  pre := pg_temp.inv();

  ---------------------------------------------------------------- audit side
  if c_na > 0 then
    v_ap := array(select a.id from public.audit_papers a
                   where coalesce(a.subject,'') !~* 'math' and (a.batch_id is null or not (a.batch_id = any(swarm)))
                   order by a.id limit c_na);
    if cardinality(v_ap) = 0 then
      r := r || jsonb_build_object('audit', 'empty');
    else
      v_aq := array(select q.id from public.audit_questions q where q.paper_id = any(v_ap));
      select count(*) into n from public.audit_papers where id = any(v_ap) and (coalesce(subject,'') ~* 'math' or batch_id = any(swarm));
      if n <> 0 then raise exception 'GUARD: Maths or swarm paper in the audit delete set (%)', n; end if;
      select count(*) into n from public.audit_questions k
       where k.paper_id <> all(v_ap) and (k.parent_id = any(v_aq) or k.split_from_id = any(v_aq));
      if n <> 0 then raise exception 'GUARD: kept audit question points at a deleted one (%)', n; end if;
      select count(*) into n from public.audit_figures f
       where f.paper_id <> all(v_ap) and f.replaced_by in (select id from public.audit_figures where paper_id = any(v_ap));
      if n <> 0 then raise exception 'GUARD: kept figure replaced_by a deleted figure (%)', n; end if;

      r := r || jsonb_build_object('audit', jsonb_build_object(
        'papers', cardinality(v_ap), 'questions', cardinality(v_aq),
        'figures',      (select count(*) from public.audit_figures where paper_id = any(v_ap) or question_id = any(v_aq)),
        'pages',        (select count(*) from public.audit_paper_pages where audit_paper_id = any(v_ap)),
        'review_log',   (select count(*) from public.audit_review_log where paper_id = any(v_ap) or question_id = any(v_aq)),
        'affordance',   (select count(*) from public.audit_affordance_log where paper_id = any(v_ap) or question_id = any(v_aq)),
        'skips',        (select count(*) from public.audit_question_skips where question_id = any(v_aq)),
        'assignments',  (select count(*) from public.checker_assignments where audit_paper_id = any(v_ap)),
        'content_checks',(select count(*) from public.content_checks where table_name='audit_questions' and row_id = any(v_aq::text[])),
        'revisions',    (select count(*) from public.bank_question_revisions where audit_paper_id = any(v_ap) or audit_question_id = any(v_aq)),
        'versions_before',(select count(*) from public.content_versions where (table_name='audit_papers' and row_id = any(v_ap::text[]))
                             or (table_name='audit_questions' and row_id = any(v_aq::text[]))),
        'paper_files_unlinked', (select count(*) from public.paper_files where audit_paper_id = any(v_ap))));

      -- rows written after the delta dump was taken (c_T) are captured here, inside the same snapshot, before they go
      r := jsonb_set(r, '{audit,deleted_ids}', to_jsonb(v_ap));
      r := jsonb_set(r, '{audit,late}', jsonb_build_object(
        'audit_papers',   (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.audit_papers x where x.id = any(v_ap) and (x.updated_at >= c_T or x.created_at >= c_T)),
        'audit_questions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.audit_questions x where x.paper_id = any(v_ap) and (x.updated_at >= c_T or x.created_at >= c_T or x.set_aside_at >= c_T or x.ai_decided_at >= c_T)),
        'audit_review_log',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.audit_review_log x where (x.paper_id = any(v_ap) or x.question_id = any(v_aq)) and (x."at" >= c_T or x.undone_at >= c_T)),
        'content_checks', (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.content_checks x where x.table_name='audit_questions' and x.row_id = any(v_aq::text[]) and (x.created_at >= c_T or x.undone_at >= c_T)),
        'content_versions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.content_versions x where ((x.table_name='audit_papers' and x.row_id = any(v_ap::text[])) or (x.table_name='audit_questions' and x.row_id = any(v_aq::text[]))) and x.created_at >= c_T),
        'audit_paper_pages',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.audit_paper_pages x where x.audit_paper_id = any(v_ap) and x.created_at >= c_T),
        'audit_figures',  (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.audit_figures x where (x.paper_id = any(v_ap) or x.question_id = any(v_aq)) and x.created_at >= c_T),
        'audit_affordance_log',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.audit_affordance_log x where (x.paper_id = any(v_ap) or x.question_id = any(v_aq)) and x.detected_at >= c_T),
        'audit_question_skips',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.audit_question_skips x where x.question_id = any(v_aq) and x.skipped_at >= c_T),
        'checker_assignments',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.checker_assignments x where x.audit_paper_id = any(v_ap) and (x.assigned_at >= c_T or x.started_at >= c_T or x.closed_at >= c_T)),
        'bank_question_revisions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.bank_question_revisions x where (x.audit_paper_id = any(v_ap) or x.audit_question_id = any(v_aq)) and x.created_at >= c_T)));

      delete from public.content_checks where table_name='audit_questions' and row_id = any(v_aq::text[]);
      get diagnostics n = row_count;
      r := jsonb_set(r, '{audit,deleted_content_checks}', to_jsonb(n));
      delete from public.bank_question_revisions where audit_paper_id = any(v_ap) or audit_question_id = any(v_aq);
      get diagnostics n = row_count;
      r := jsonb_set(r, '{audit,deleted_revisions}', to_jsonb(n));
      delete from public.audit_papers where id = any(v_ap);           -- cascades to every FK child
      get diagnostics n = row_count;
      if n <> cardinality(v_ap) then raise exception 'audit_papers deleted % expected %', n, cardinality(v_ap); end if;
      delete from public.content_versions where (table_name='audit_papers' and row_id = any(v_ap::text[]))
                                              or (table_name='audit_questions' and row_id = any(v_aq::text[]));
      get diagnostics n = row_count;
      r := jsonb_set(r, '{audit,deleted_content_versions_incl_tombstones}', to_jsonb(n));

      select (select count(*) from public.audit_papers where id = any(v_ap))
           + (select count(*) from public.audit_questions where paper_id = any(v_ap) or id = any(v_aq))
           + (select count(*) from public.audit_figures where paper_id = any(v_ap) or question_id = any(v_aq))
           + (select count(*) from public.audit_paper_pages where audit_paper_id = any(v_ap))
           + (select count(*) from public.audit_review_log where paper_id = any(v_ap) or question_id = any(v_aq))
           + (select count(*) from public.audit_affordance_log where paper_id = any(v_ap) or question_id = any(v_aq))
           + (select count(*) from public.audit_question_skips where question_id = any(v_aq))
           + (select count(*) from public.checker_assignments where audit_paper_id = any(v_ap))
           + (select count(*) from public.content_checks where table_name='audit_questions' and row_id = any(v_aq::text[]))
           + (select count(*) from public.bank_question_revisions where audit_paper_id = any(v_ap) or audit_question_id = any(v_aq))
           + (select count(*) from public.content_versions where (table_name='audit_papers' and row_id = any(v_ap::text[]))
                or (table_name='audit_questions' and row_id = any(v_aq::text[])))
           + (select count(*) from public.paper_files where audit_paper_id = any(v_ap))
        into left_over;
      if left_over <> 0 then raise exception 'LEFTOVER audit rows after delete: %', left_over; end if;
    end if;
  end if;

  ---------------------------------------------------------------- bank side
  if c_nb > 0 then
    v_bp := array(select b.id from public.bank_papers b
                   where coalesce(b.subject,'') !~* 'math' and b.id <> all(keep6) order by b.id limit c_nb);
    if cardinality(v_bp) = 0 then
      r := r || jsonb_build_object('bank', 'empty');
    else
      v_bq := array(select q.id from public.bank_questions q where q.paper_id = any(v_bp));
      select count(*) into n from public.bank_papers where id = any(v_bp) and (coalesce(subject,'') ~* 'math' or id = any(keep6));
      if n <> 0 then raise exception 'GUARD: Maths or keep6 paper in the bank delete set (%)', n; end if;
      -- a kept audit paper / question must not point at what we are about to delete
      select count(*) into n from public.audit_papers a
       where a.live_bank_paper_id = any(v_bp) and (coalesce(a.subject,'') ~* 'math' or a.batch_id = any(swarm));
      if n <> 0 then raise exception 'GUARD: kept audit paper points at a bank paper in the delete set (%)', n; end if;
      select count(*) into n from public.audit_questions q join public.audit_papers a on a.id = q.paper_id
       where q.live_bank_question_id = any(v_bq) and (coalesce(a.subject,'') ~* 'math' or a.batch_id = any(swarm));
      if n <> 0 then raise exception 'GUARD: kept audit question points at a bank question in the delete set (%)', n; end if;
      select count(*) into n from public.bank_questions k where k.paper_id <> all(v_bp) and k.parent_question_id = any(v_bq);
      if n <> 0 then raise exception 'GUARD: kept bank question has a deleted parent (%)', n; end if;

      r := r || jsonb_build_object('bank', jsonb_build_object(
        'papers', cardinality(v_bp), 'questions', cardinality(v_bq),
        'question_reports', (select count(*) from public.question_reports where paper_id = any(v_bp) or question_id = any(v_bq)),
        'revisions',   (select count(*) from public.bank_question_revisions
                          where (table_name='bank_papers' and row_id = any(v_bp)) or (table_name='bank_questions' and row_id = any(v_bq))),
        'versions_before',(select count(*) from public.content_versions
                          where (table_name='bank_papers' and row_id = any(v_bp)) or (table_name='bank_questions' and row_id = any(v_bq))),
        'read_events', (select count(*) from public.read_events where kind='paper' and target_id = any(v_bp)),
        'paper_files_unlinked', (select count(*) from public.paper_files where bank_paper_id = any(v_bp))));

      r := jsonb_set(r, '{bank,deleted_ids}', to_jsonb(v_bp));
      r := jsonb_set(r, '{bank,late}', jsonb_build_object(
        'bank_question_revisions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.bank_question_revisions x where ((x.table_name='bank_papers' and x.row_id = any(v_bp)) or (x.table_name='bank_questions' and x.row_id = any(v_bq))) and x.created_at >= c_T),
        'content_versions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.content_versions x where ((x.table_name='bank_papers' and x.row_id = any(v_bp)) or (x.table_name='bank_questions' and x.row_id = any(v_bq))) and x.created_at >= c_T),
        'read_events',    (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.read_events x where x.kind='paper' and x.target_id = any(v_bp) and x.created_at >= c_T),
        'question_reports',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.question_reports x where (x.paper_id = any(v_bp) or x.question_id = any(v_bq)) and x.created_at >= c_T)));

      delete from public.bank_question_revisions
       where (table_name='bank_papers' and row_id = any(v_bp)) or (table_name='bank_questions' and row_id = any(v_bq));
      get diagnostics n = row_count;
      r := jsonb_set(r, '{bank,deleted_revisions}', to_jsonb(n));
      delete from public.read_events where kind='paper' and target_id = any(v_bp);
      get diagnostics n = row_count;
      r := jsonb_set(r, '{bank,deleted_read_events}', to_jsonb(n));
      delete from public.bank_papers where id = any(v_bp);              -- cascades bank_questions, question_reports
      get diagnostics n = row_count;
      if n <> cardinality(v_bp) then raise exception 'bank_papers deleted % expected %', n, cardinality(v_bp); end if;
      delete from public.content_versions
       where (table_name='bank_papers' and row_id = any(v_bp)) or (table_name='bank_questions' and row_id = any(v_bq));
      get diagnostics n = row_count;
      r := jsonb_set(r, '{bank,deleted_content_versions_incl_tombstones}', to_jsonb(n));

      select (select count(*) from public.bank_papers where id = any(v_bp))
           + (select count(*) from public.bank_questions where paper_id = any(v_bp) or id = any(v_bq))
           + (select count(*) from public.question_reports where paper_id = any(v_bp) or question_id = any(v_bq))
           + (select count(*) from public.bank_question_revisions
                where (table_name='bank_papers' and row_id = any(v_bp)) or (table_name='bank_questions' and row_id = any(v_bq)))
           + (select count(*) from public.content_versions
                where (table_name='bank_papers' and row_id = any(v_bp)) or (table_name='bank_questions' and row_id = any(v_bq)))
           + (select count(*) from public.read_events where kind='paper' and target_id = any(v_bp))
           + (select count(*) from public.paper_files where bank_paper_id = any(v_bp))
        into left_over;
      if left_over <> 0 then raise exception 'LEFTOVER bank rows after delete: %', left_over; end if;
    end if;
  end if;

  ---------------------------------------------------------------- invariants
  post := pg_temp.inv();
  if post is distinct from pre then
    raise exception 'INVARIANT CHANGED. before % after %', pre::text, post::text;
  end if;
  r := r || jsonb_build_object('invariants_unchanged', pre, 'ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int);
  insert into _rep values (r);
  if c_rehearse then raise exception 'REHEARSAL_REPORT %', r::text; end if;
end $$;

select j from _rep;
commit;

-- ============================================================================================
-- RUN LOG (2026-10-12, executed through execute_sql by Claude on the owner's authorisation)
--   rehearsals (rolled back): 50 audit + 50 bank papers, twice (before and after adding the late-row capture).
--   applied chunks, each its own transaction with the guards/invariants above:
--     call 1       c_na=50  c_nb=50   (50 + 50)
--     calls 2-5    c_na=50  c_nb=50   (200 + 200)
--     calls 6-12   c_na=80  c_nb=80   (bank finished: 884; audit at 890)
--     calls 13-14  c_na=150 c_nb=0 and c_na=250 c_nb=0 ... until the audit set was empty (1,702 papers)
--   c_T was '2026-10-12T00:19:51Z' (delta dump started 00:21:51Z); every chunk's "late" capture came back empty.
--   The delta dump (backups\nonmaths_20261012\delta_20261012_055151) found 0 new/changed rows in the delete set.
--
-- Step: remove the old batches that became empty (only ids that exist in the backup's audit_batches.jsonl, so a batch
-- created by the pipeline after the backup is never touched; pilot-20 was already empty before and is left alone):
--   delete from public.audit_batches b
--    where b.id = any(<the 29 non-swarm batch ids of audit_batches.jsonl>) and b.label not like 'swarm-%'
--      and not exists (select 1 from public.audit_papers p where p.batch_id = b.id);       -- 26 rows
-- ============================================================================================
