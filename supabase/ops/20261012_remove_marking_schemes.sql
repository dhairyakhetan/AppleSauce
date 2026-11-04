-- ============================================================================================
-- 20261012_remove_marking_schemes.sql   *** OPS SCRIPT, NOT A MIGRATION. Never replayed automatically. ***
--
-- Owner decision 2026-10-12 (Shikshaq Supabase project uvtifolnsneitetzohtn): the two swarm-r3 papers
--   512def35-c046-4076-b05a-46dfc5907d56   History, Class XI    "MARKING SCHEME, HISTORY - CODE 027"
--   dd68ddca-6914-4a92-8617-85f9452615dd   Economics, Class XII "Pre Board I Examination ... : Marking Scheme"
-- are answer keys filed as question papers. Answer: "Remove both papers completely".
-- Scope: EXACTLY these two audit_papers and everything keyed to them. Nothing else.
--
-- NOT touched: bank_papers/bank_questions (incl. bank paper 6f53b7, which dd68ddca points at through
--   live_bank_paper_id: 6f53b7 is a different, real ICSE 2019 Economics board paper), audit_batches (swarm-r3 stays),
--   paper_registry / paper_files (0 rows for these papers), admin_audit_log, _deleted_* / _backup_* snapshot tables.
--
-- Everything keyed to the papers is deleted by ON DELETE CASCADE from audit_papers / audit_questions:
--   audit_questions, audit_figures, audit_paper_pages, audit_review_log, audit_affordance_log, audit_question_skips,
--   checker_assignments.  No FK, so deleted by id first: content_checks, bank_question_revisions.
--   content_versions (no FK) is deleted by id AFTER the paper delete, because the delete triggers write tombstones
--   there that must go again (same as the non-Maths removal).
--
-- Mode: c_rehearse = true ends with RAISE EXCEPTION (nothing kept, the report is in the error text);
--       c_rehearse = false commits and returns the report as a result set.
-- One execute_sql call = one transaction. Backup: Shikshaq Papers\backups\marking_schemes_20261012.
-- ============================================================================================

begin isolation level repeatable read;
set local lock_timeout = '8s';
set local statement_timeout = '120s';
create temp table _rep(j jsonb) on commit drop;

create or replace function pg_temp.inv() returns jsonb language sql stable as $f$
with gone as (select unnest(array['512def35-c046-4076-b05a-46dfc5907d56','dd68ddca-6914-4a92-8617-85f9452615dd']::uuid[]) id),
kq as (select q.id from public.audit_questions q where q.paper_id not in (select id from gone)),
sw as (select id from public.audit_batches where label like 'swarm-%')
select jsonb_build_object(
 -- totals (expected to fall by exactly the keyed counts)
 't_audit_papers',  (select count(*) from public.audit_papers),
 't_audit_questions',(select count(*) from public.audit_questions),
 't_audit_figures', (select count(*) from public.audit_figures),
 't_audit_pages',   (select count(*) from public.audit_paper_pages),
 't_review_log',    (select count(*) from public.audit_review_log),
 't_affordance',    (select count(*) from public.audit_affordance_log),
 't_skips',         (select count(*) from public.audit_question_skips),
 't_assignments',   (select count(*) from public.checker_assignments),
 't_checks',        (select count(*) from public.content_checks),
 't_revisions',     (select count(*) from public.bank_question_revisions),
 't_versions',      (select count(*) from public.content_versions),
 -- everything else must be identical before and after
 'o_papers_md5',    (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.audit_papers where id not in (select id from gone)),
 'o_questions_md5', (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from kq),
 'o_questions_upd', (select md5(coalesce(string_agg(id::text||coalesce(updated_at::text,''), ',' order by id), '')) from public.audit_questions where id in (select id from kq)),
 'o_review_log',    (select count(*) from public.audit_review_log where paper_id is null or paper_id not in (select id from gone)),
 'o_versions',      (select count(*) from public.content_versions v where not ((v.table_name='audit_papers' and v.row_id in (select id::text from gone))
                       or (v.table_name='audit_questions' and v.row_id in (select q.id::text from public.audit_questions q where q.paper_id in (select id from gone))))),
 'swarm_papers',    (select count(*) from public.audit_papers where batch_id in (select id from sw)),
 'swarm_r3_papers', (select count(*) from public.audit_papers where batch_id in (select id from public.audit_batches where label = 'swarm-r3')),
 'audit_batches',   (select count(*) from public.audit_batches),
 'math_audit_papers',(select count(*) from public.audit_papers where coalesce(subject,'') ~* 'math'),
 'servable_others', (select count(*) from public.audit_questions q where q.id in (select id from kq) and public.checker_question_servable(q)),
 'bank_papers',     (select count(*) from public.bank_papers),
 'bank_questions',  (select count(*) from public.bank_questions),
 'bank_6f53b7_q',   (select count(*) from public.bank_questions where paper_id = '6f53b7'),
 'paper_files',     (select count(*) from public.paper_files),
 'paper_registry',  (select count(*) from public.paper_registry),
 'deleted_snap_tables', (select jsonb_build_object('aq',(select count(*) from public._deleted_audit_questions),
                                                   'rl',(select count(*) from public._deleted_audit_review_log),
                                                   'bq',(select count(*) from public._deleted_bank_questions)))
);
$f$;

do $$
declare
  c_rehearse constant boolean := false;     -- true = RAISE at the end (rolls back); false = commit  (APPLIED as false)
  v_ap constant uuid[] := array['512def35-c046-4076-b05a-46dfc5907d56','dd68ddca-6914-4a92-8617-85f9452615dd']::uuid[];
  v_aq uuid[]; pre jsonb; post jsonb; r jsonb := '{}'::jsonb; n bigint; left_over bigint; k jsonb; swarm_r3 uuid;
begin
  select id into swarm_r3 from public.audit_batches where label = 'swarm-r3';
  -- guards: exactly these two papers, swarm-r3, not Maths, not published, not linked to a different paper
  select count(*) into n from public.audit_papers where id = any(v_ap);
  if n <> 2 then raise exception 'GUARD: expected 2 papers, found %', n; end if;
  select count(*) into n from public.audit_papers
   where id = any(v_ap) and (coalesce(subject,'') ~* 'math' or batch_id is distinct from swarm_r3
        or title !~* 'marking scheme' or status <> 'pending' or approved_at is not null);
  if n <> 0 then raise exception 'GUARD: a paper is Maths / not swarm-r3 / not a marking scheme / not pending (%)', n; end if;

  v_aq := array(select q.id from public.audit_questions q where q.paper_id = any(v_ap));
  select count(*) into n from public.audit_questions k
   where k.paper_id <> all(v_ap) and (k.parent_id = any(v_aq) or k.split_from_id = any(v_aq));
  if n <> 0 then raise exception 'GUARD: kept audit question points at a deleted one (%)', n; end if;
  select count(*) into n from public.audit_figures f
   where f.paper_id <> all(v_ap) and f.replaced_by in (select id from public.audit_figures where paper_id = any(v_ap));
  if n <> 0 then raise exception 'GUARD: kept figure replaced_by a deleted figure (%)', n; end if;
  -- no human verdicts anywhere in the delete set (only AI / pipeline rows)
  select count(*) into n from public.audit_review_log where paper_id = any(v_ap) and (reviewer_id is not null or actor_user_id is not null);
  r := r || jsonb_build_object('human_actor_review_rows', n);

  pre := pg_temp.inv();
  k := jsonb_build_object(
    'audit_papers', cardinality(v_ap), 'audit_questions', cardinality(v_aq),
    'audit_figures',  (select count(*) from public.audit_figures where paper_id = any(v_ap) or question_id = any(v_aq)),
    'audit_pages',    (select count(*) from public.audit_paper_pages where audit_paper_id = any(v_ap)),
    'review_log',     (select count(*) from public.audit_review_log where paper_id = any(v_ap) or question_id = any(v_aq)),
    'affordance',     (select count(*) from public.audit_affordance_log where paper_id = any(v_ap) or question_id = any(v_aq)),
    'skips',          (select count(*) from public.audit_question_skips where question_id = any(v_aq)),
    'assignments',    (select count(*) from public.checker_assignments where audit_paper_id = any(v_ap)),
    'checks',         (select count(*) from public.content_checks where table_name='audit_questions' and row_id = any(v_aq::text[])),
    'revisions',      (select count(*) from public.bank_question_revisions where audit_paper_id = any(v_ap) or audit_question_id = any(v_aq)),
    'versions',       (select count(*) from public.content_versions where (table_name='audit_papers' and row_id = any(v_ap::text[]))
                         or (table_name='audit_questions' and row_id = any(v_aq::text[]))),
    'paper_files_linked', (select count(*) from public.paper_files where audit_paper_id = any(v_ap)),
    'registry_linked',    (select count(*) from public.paper_registry where audit_paper_id = any(v_ap)),
    'servable_in_set',    (select count(*) from public.audit_questions q where q.paper_id = any(v_ap) and public.checker_question_servable(q)));
  r := r || jsonb_build_object('to_delete', k);

  delete from public.content_checks where table_name='audit_questions' and row_id = any(v_aq::text[]);
  delete from public.bank_question_revisions where audit_paper_id = any(v_ap) or audit_question_id = any(v_aq);
  delete from public.audit_papers where id = any(v_ap);                    -- cascades to every FK child
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'audit_papers deleted % expected 2', n; end if;
  delete from public.content_versions where (table_name='audit_papers' and row_id = any(v_ap::text[]))
                                          or (table_name='audit_questions' and row_id = any(v_aq::text[]));
  get diagnostics n = row_count;
  r := r || jsonb_build_object('versions_deleted_incl_tombstones', n);

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
  if left_over <> 0 then raise exception 'LEFTOVER rows after delete: %', left_over; end if;

  post := pg_temp.inv();
  -- the 'others' must be identical
  if (pre - array['t_audit_papers','t_audit_questions','t_audit_figures','t_audit_pages','t_review_log','t_affordance','t_skips','t_assignments','t_checks','t_revisions','t_versions','swarm_papers','swarm_r3_papers','deleted_snap_tables'])
     is distinct from
     (post - array['t_audit_papers','t_audit_questions','t_audit_figures','t_audit_pages','t_review_log','t_affordance','t_skips','t_assignments','t_checks','t_revisions','t_versions','swarm_papers','swarm_r3_papers','deleted_snap_tables']) then
    raise exception 'INVARIANT CHANGED (others). before % after %', pre::text, post::text;
  end if;
  -- the totals must fall by exactly the keyed counts
  if (pre->>'t_audit_papers')::int - (post->>'t_audit_papers')::int <> (k->>'audit_papers')::int
  or (pre->>'t_audit_questions')::int - (post->>'t_audit_questions')::int <> (k->>'audit_questions')::int
  or (pre->>'t_audit_figures')::int - (post->>'t_audit_figures')::int <> (k->>'audit_figures')::int
  or (pre->>'t_audit_pages')::int - (post->>'t_audit_pages')::int <> (k->>'audit_pages')::int
  or (pre->>'t_review_log')::int - (post->>'t_review_log')::int <> (k->>'review_log')::int
  or (pre->>'t_affordance')::int - (post->>'t_affordance')::int <> (k->>'affordance')::int
  or (pre->>'t_skips')::int - (post->>'t_skips')::int <> (k->>'skips')::int
  or (pre->>'t_assignments')::int - (post->>'t_assignments')::int <> (k->>'assignments')::int
  or (pre->>'t_checks')::int - (post->>'t_checks')::int <> (k->>'checks')::int
  or (pre->>'t_revisions')::int - (post->>'t_revisions')::int <> (k->>'revisions')::int
  or (pre->>'t_versions')::int - (post->>'t_versions')::int <> (k->>'versions')::int
  or (pre->>'swarm_papers')::int - (post->>'swarm_papers')::int <> 2
  or (pre->>'swarm_r3_papers')::int - (post->>'swarm_r3_papers')::int <> 2 then
    raise exception 'TOTALS did not fall by exactly the keyed counts. before % after %', pre::text, post::text;
  end if;
  r := r || jsonb_build_object('before', pre, 'after', post);
  insert into _rep values (r);
  if c_rehearse then raise exception 'REHEARSAL_REPORT %', r::text; end if;
end $$;

select j from _rep;
commit;

-- ============================================================================================
-- RUN LOG (2026-10-12, executed through execute_sql by Claude; coordinator GO after the rehearsal)
--   backup (before):  Shikshaq Papersackups\marking_schemes_20261012 (14 tables, sha256 + fresh count(*) match, --verify OK)
--   rehearsal x2 (rolled back; the first failed only on my own swarm_papers check, fixed), then APPLIED once, one transaction.
--   deleted: audit_papers 2, audit_questions 69, audit_paper_pages 3, audit_review_log 307, content_versions 73
--            (144 incl. delete tombstones, all removed again); figures/affordance/skips/assignments/checks/revisions/paper_files/registry 0.
--   after:   audit_papers 703 -> 701, audit_questions 25,566 -> 25,497, swarm papers 76 -> 74 (swarm-r3 39 -> 37),
--            servable 2,030 -> 2,008 (all 22 servable questions were in these two papers), Maths 627 and bank 627/21,174 unchanged,
--            bank paper 6f53b7 still has its 13 questions; dangling live links 0, orphan questions 0.
--   storage: 62 objects, 14,630,416 bytes archived (md5 + size checked) to Shikshaq Papersrchive\marking-schemes-removed-20261012
--            then removed from audit-figures with swarm\harnessrchive_removed_papers_storage.py --archive-root ... --apply.
-- ============================================================================================
