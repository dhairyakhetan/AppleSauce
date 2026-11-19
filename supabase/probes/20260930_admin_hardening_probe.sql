-- Rollback probe for supabase/migrations/20260930090000_admin_hardening.sql
--
-- Run it AFTER the migration is applied (running it before shows the gaps the
-- migration closes: the FAIL rows are the audit findings). It writes live rows
-- while impersonating an admin, so EVERYTHING sits inside BEGIN ... ROLLBACK
-- and nothing is kept. Run the whole file in one go in the SQL editor or with
-- psql; the last result set is the report. Any row with ok = false is a
-- failure. The final statement is ROLLBACK, always: if the run is interrupted
-- half way, issue ROLLBACK by hand before doing anything else.
--
-- An unexpected error inside a step aborts the run: the message IS the finding
-- (the failing step is the last one that printed nothing). Expected refusals
-- are caught and reported as rows.
--
-- Impersonation follows what PostgREST does: set request.jwt.claims (and the
-- older request.jwt.claim.sub) so auth.uid() resolves, then SET LOCAL ROLE.
-- Reads of bank_questions and the log tables are done as the postgres owner,
-- because the client roles cannot read them (that is the point).

begin;

create temp table probe_results (
  seq    serial primary key,
  area   text not null,
  name   text not null,
  ok     boolean not null,
  detail text
);

do $probe$
declare
  v_admin     uuid;
  v_nonadmin  uuid;
  v_q         text;
  v_p         text;
  v_ap        uuid;
  v_aq        uuid;
  v_b0        text;
  v_m0        numeric;
  v_rev       bigint;
  v_actor     uuid;
  v_state     text;
  v_txt       text;
  v_n         int;
  v_new       text;
  c           record;
  v_claim_admin text;
  v_claim_non   text;
begin
  -- ---- fixtures, read as the owner --------------------------------------
  select id into v_admin from public.admins limit 1;
  select u.id into v_nonadmin from auth.users u
    where not exists (select 1 from public.admins a where a.id = u.id) limit 1;
  select bq.id, bq.paper_id into v_q, v_p
    from public.bank_questions bq where bq.body is not null and bq.marks is not null limit 1;
  select ap.id into v_ap
    from public.audit_papers ap
    where ap.source = 'live_copy' and ap.live_bank_paper_id is not null
      and exists (select 1 from public.audit_questions q where q.paper_id = ap.id and q.kind = 'question')
    order by (select count(*) from public.audit_questions q where q.paper_id = ap.id) asc limit 1;
  select q.id into v_aq from public.audit_questions q where q.paper_id = v_ap and q.kind = 'question' limit 1;

  if v_admin is null or v_q is null or v_ap is null then
    insert into probe_results (area, name, ok, detail)
    values ('fixtures', 'found an admin, a question and an audit paper', false,
            format('admin=%s question=%s audit_paper=%s', v_admin, v_q, v_ap));
    return;
  end if;
  v_claim_admin := json_build_object('sub', v_admin::text, 'role', 'authenticated')::text;
  v_claim_non   := json_build_object('sub', coalesce(v_nonadmin::text, gen_random_uuid()::text), 'role', 'authenticated')::text;

  -- ---- 1. data-driven cases: who runs which statement, expected outcome --
  -- expect = 'ok' or the SQLSTATE. 22023 is validation, 42501 is refusal.
  for c in
    select * from (values
      ('validation', 'reject blank body (spaces)',     'admin', format('select public.admin_edit_bank_question(%L, ''body'', %L)', v_q, '   '), '22023'),
      ('validation', 'reject blank body (newline)',    'admin', format('select public.admin_edit_bank_question(%L, ''body'', %L)', v_q, E'\n\t'), '22023'),
      ('validation', 'reject null body',               'admin', format('select public.admin_edit_bank_question(%L, ''body'', null)', v_q), '22023'),
      ('validation', 'reject marks 101',               'admin', format('select public.admin_edit_bank_question(%L, ''marks'', ''101'')', v_q), '22023'),
      ('validation', 'reject marks -1',                'admin', format('select public.admin_edit_bank_question(%L, ''marks'', ''-1'')', v_q), '22023'),
      ('validation', 'reject marks abc',               'admin', format('select public.admin_edit_bank_question(%L, ''marks'', ''abc'')', v_q), '22023'),
      ('validation', 'reject marks NaN',               'admin', format('select public.admin_edit_bank_question(%L, ''marks'', ''NaN'')', v_q), '22023'),
      ('validation', 'reject unknown qtype',           'admin', format('select public.admin_edit_bank_question(%L, ''qtype'', ''bogus'')', v_q), '22023'),
      ('validation', 'reject null field name',         'admin', format('select public.admin_edit_bank_question(%L, null, ''x'')', v_q), '22023'),
      ('validation', 'reject non-listed field (id)',   'admin', format('select public.admin_edit_bank_question(%L, ''id'', ''x'')', v_q), '22023'),
      ('validation', 'reject page 0',                  'admin', format('select public.admin_edit_bank_question(%L, ''page'', ''0'')', v_q), '22023'),
      ('validation', 'reject page x',                  'admin', format('select public.admin_edit_bank_question(%L, ''page'', ''x'')', v_q), '22023'),
      ('validation', 'reject figure with ..',          'admin', format('select public.admin_edit_bank_question(%L, ''figure'', ''../x.png'')', v_q), '22023'),
      ('validation', 'reject figure with space',       'admin', format('select public.admin_edit_bank_question(%L, ''figure'', ''a b.png'')', v_q), '22023'),
      ('validation', 'set_figure rejects a path',      'admin', format('select public.admin_set_bank_question_figure(%L, ''/etc/passwd'')', v_q), '22023'),
      ('validation', 'reject chapter_from_paper maybe','admin', format('select public.admin_edit_bank_question(%L, ''chapter_from_paper'', ''maybe'')', v_q), '22023'),
      ('validation', 'paper: reject blank cls',        'admin', format('select public.admin_edit_bank_paper(%L, ''cls'', '''')', v_p), '22023'),
      ('validation', 'paper: reject blank school',     'admin', format('select public.admin_edit_bank_paper(%L, ''school'', ''  '')', v_p), '22023'),
      ('validation', 'paper: reject time 0',           'admin', format('select public.admin_edit_bank_paper(%L, ''allowed_time_minutes'', ''0'')', v_p), '22023'),
      ('validation', 'paper: reject time abc',         'admin', format('select public.admin_edit_bank_paper(%L, ''allowed_time_minutes'', ''abc'')', v_p), '22023'),
      ('validation', 'paper: reject time 9999',        'admin', format('select public.admin_edit_bank_paper(%L, ''allowed_time_minutes'', ''9999'')', v_p), '22023'),
      ('validation', 'paper: reject needs_review maybe','admin', format('select public.admin_edit_bank_paper(%L, ''needs_review'', ''maybe'')', v_p), '22023'),
      ('validation', 'paper: reject marks 5000',       'admin', format('select public.admin_edit_bank_paper(%L, ''marks'', ''5000'')', v_p), '22023'),
      ('validation', 'paper: reject non-listed field', 'admin', format('select public.admin_edit_bank_paper(%L, ''id'', ''x'')', v_p), '22023'),
      ('validation', 'add: reject blank body',         'admin', format('select public.admin_add_bank_question(%L, 0, ''   '', 1, ''1'')', v_p), '22023'),
      ('validation', 'add: reject marks 500',          'admin', format('select public.admin_add_bank_question(%L, 0, ''text'', 500, ''1'')', v_p), '22023'),
      ('validation', 'add: reject position -5',        'admin', format('select public.admin_add_bank_question(%L, -5, ''text'', 1, ''1'')', v_p), '22023'),
      ('validation', 'add: reject unknown paper',      'admin', 'select public.admin_add_bank_question(''no-such-paper'', 0, ''text'', 1, ''1'')', '22023'),
      -- accepted edits of every non-text column type (the live function failed these with 42804)
      ('accept', 'question page 3 (integer)',          'admin', format('select public.admin_edit_bank_question(%L, ''page'', ''3'')', v_q), 'ok'),
      ('accept', 'question marks 2.5 (numeric)',       'admin', format('select public.admin_edit_bank_question(%L, ''marks'', ''2.5'')', v_q), 'ok'),
      ('accept', 'question suggested time 4 (numeric)','admin', format('select public.admin_edit_bank_question(%L, ''suggested_time_minutes'', ''4'')', v_q), 'ok'),
      ('accept', 'question chapter_from_paper (bool)', 'admin', format('select public.admin_edit_bank_question(%L, ''chapter_from_paper'', ''true'')', v_q), 'ok'),
      ('accept', 'question marks cleared (null)',      'admin', format('select public.admin_edit_bank_question(%L, ''marks'', null)', v_q), 'ok'),
      ('accept', 'paper time 90 (integer)',            'admin', format('select public.admin_edit_bank_paper(%L, ''allowed_time_minutes'', ''90'')', v_p), 'ok'),
      ('accept', 'paper marks 80 (numeric)',           'admin', format('select public.admin_edit_bank_paper(%L, ''marks'', ''80'')', v_p), 'ok'),
      ('accept', 'paper needs_review unchanged (bool)','admin', format('select public.admin_edit_bank_paper(%L, ''needs_review'', %L)', v_p, (select needs_review::text from public.bank_papers where id = v_p)), 'ok'),
      ('accept', 'paper exam text',                    'admin', format('select public.admin_edit_bank_paper(%L, ''exam'', (select exam from public.bank_papers where id = %L))', v_p, v_p), 'ok'),
      -- not an admin: every touched function refuses with 42501
      ('refusal', 'non-admin cannot edit a question',   'nonadmin', format('select public.admin_edit_bank_question(%L, ''marks'', ''1'')', v_q), '42501'),
      ('refusal', 'non-admin cannot edit a paper',      'nonadmin', format('select public.admin_edit_bank_paper(%L, ''cls'', ''X'')', v_p), '42501'),
      ('refusal', 'non-admin cannot add a question',    'nonadmin', format('select public.admin_add_bank_question(%L, 0, ''t'', 1, ''1'')', v_p), '42501'),
      ('refusal', 'non-admin cannot set a figure',      'nonadmin', format('select public.admin_set_bank_question_figure(%L, ''a.png'')', v_q), '42501'),
      ('refusal', 'non-admin cannot rescue-publish',    'nonadmin', format('select public.admin_english_rescue_publish_paper(%L)', v_ap), '42501'),
      ('refusal', 'non-admin cannot reapply',           'nonadmin', format('select public.admin_reapply_paper_to_live(%L)', v_ap), '42501'),
      ('refusal', 'non-admin cannot read history',      'nonadmin', format('select * from public.admin_question_history(%L)', v_aq), '42501'),
      ('refusal', 'anon cannot call admin_edit_bank_question', 'anon', format('select public.admin_edit_bank_question(%L, ''marks'', ''1'')', v_q), '42501'),
      ('refusal', 'anon cannot call admin_question_history',   'anon', format('select * from public.admin_question_history(%L)', v_aq), '42501'),
      -- direct table writes are closed for everyone, admins included
      ('tables', 'admin direct UPDATE bank_questions refused', 'admin',    format('update public.bank_questions set marks = 1 where id = %L', v_q), '42501'),
      ('tables', 'admin direct UPDATE bank_papers refused',    'admin',    format('update public.bank_papers set marks = 1 where id = %L', v_p), '42501'),
      ('tables', 'admin direct INSERT bank_papers refused',    'admin',    'insert into public.bank_papers (id) values (''probe-x'')', '42501'),
      ('tables', 'admin direct DELETE bank_papers refused',    'admin',    format('delete from public.bank_papers where id = %L', v_p), '42501'),
      ('tables', 'admin direct DELETE bank_questions refused', 'admin',    format('delete from public.bank_questions where id = %L', v_q), '42501'),
      ('tables', 'admin direct TRUNCATE bank_papers refused',  'admin',    'truncate public.bank_papers', '42501'),
      ('tables', 'non-admin direct UPDATE bank_papers refused','nonadmin', format('update public.bank_papers set marks = 1 where id = %L', v_p), '42501'),
      ('tables', 'anon direct UPDATE bank_papers refused',     'anon',     format('update public.bank_papers set marks = 1 where id = %L', v_p), '42501'),
      ('tables', 'anon direct INSERT bank_questions refused',  'anon',     'insert into public.bank_questions (id) values (''probe-x'')', '42501'),
      -- reads that must keep working / keep being closed
      ('tables', 'anon can still read bank_papers',            'anon',     'select count(*) from public.bank_papers', 'ok'),
      ('tables', 'signed-in can still read bank_papers',       'nonadmin', 'select count(*) from public.bank_papers', 'ok'),
      ('tables', 'signed-in direct SELECT bank_questions stays refused', 'nonadmin', 'select count(*) from public.bank_questions', '42501'),
      ('tables', 'admin direct SELECT bank_questions stays refused',     'admin',    'select count(*) from public.bank_questions', '42501'),
      ('tables', 'catalog unreadable by admin session',        'admin',    'select count(*) from public.log_action_catalog', '42501'),
      ('tables', 'catalog unreadable by anon',                 'anon',     'select count(*) from public.log_action_catalog', '42501')
    ) as t(area, name, who, stmt, expect)
  loop
    perform set_config('request.jwt.claims',
      case c.who when 'anon' then '' when 'admin' then v_claim_admin else v_claim_non end, true);
    perform set_config('request.jwt.claim.sub',
      case c.who when 'anon' then '' when 'admin' then v_admin::text else coalesce(v_nonadmin::text, '') end, true);
    if c.who = 'anon' then set local role anon; else set local role authenticated; end if;
    begin
      execute c.stmt;
      v_state := 'ok';
    exception when others then
      -- an unexpected refusal of an accepted edit shows its message
      v_state := case when c.expect = 'ok' then sqlstate || ' ' || sqlerrm else sqlstate end;
    end;
    reset role;
    insert into probe_results (area, name, ok, detail)
    values (c.area, c.name, v_state = c.expect, format('expected %s, got %s', c.expect, v_state));
  end loop;

  -- admin can still see hidden papers through the replacement SELECT policy
  perform set_config('request.jwt.claims', v_claim_admin, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  select count(*) into v_n from public.bank_papers where not is_published;
  reset role;
  insert into probe_results (area, name, ok, detail)
  values ('tables', 'admin still reads hidden papers',
          v_n = (select count(*) from public.bank_papers where not is_published) and v_n > 0,
          format('admin session sees %s hidden papers', v_n));

  -- ---- 2. admin edit writes a revision with actor_user_id ----------------
  select marks into v_m0 from public.bank_questions where id = v_q;
  perform set_config('request.jwt.claims', v_claim_admin, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  perform public.admin_edit_bank_question(v_q, 'marks', '7');
  reset role;
  select r.id, r.actor_user_id into v_rev, v_actor
    from public.bank_question_revisions r
    where r.row_id = v_q and r.action = 'admin_edit' and r.field = 'marks'
    order by r.id desc limit 1;
  insert into probe_results (area, name, ok, detail)
  values ('audit', 'admin edit writes a revision with actor_user_id = the admin',
          v_actor = v_admin, format('revision %s actor_user_id=%s', v_rev, v_actor));
  insert into probe_results (area, name, ok, detail)
  values ('audit', 'admin edit changed the live value',
          (select marks from public.bank_questions where id = v_q) = 7, null);

  -- undo round trip on marks
  set local role authenticated;
  perform public.admin_undo_revision(v_rev);
  reset role;
  insert into probe_results (area, name, ok, detail)
  values ('roundtrip', 'undo restores marks',
          (select marks from public.bank_questions where id = v_q) is not distinct from v_m0,
          format('before %s', v_m0));
  insert into probe_results (area, name, ok, detail)
  values ('roundtrip', 'undo logs an admin_undo revision by the admin',
          exists (select 1 from public.bank_question_revisions r
                  where r.row_id = v_q and r.action = 'admin_undo' and r.actor_user_id = v_admin), null);

  -- body: stored byte-exact (validation never trims), and undone byte-exact
  select body into v_b0 from public.bank_questions where id = v_q;
  v_txt := E'  probe body with edges \n';
  set local role authenticated;
  perform public.admin_edit_bank_question(v_q, 'body', v_txt);
  reset role;
  insert into probe_results (area, name, ok, detail)
  values ('roundtrip', 'body is stored exactly as sent (no trim)',
          (select body from public.bank_questions where id = v_q) = v_txt, null);
  select r.id into v_rev from public.bank_question_revisions r
    where r.row_id = v_q and r.action = 'admin_edit' and r.field = 'body' order by r.id desc limit 1;
  set local role authenticated;
  perform public.admin_undo_revision(v_rev);
  reset role;
  insert into probe_results (area, name, ok, detail)
  values ('roundtrip', 'undo restores the body byte-exact',
          (select body from public.bank_questions where id = v_q) = v_b0, null);

  -- paper edit + undo
  select marks into v_m0 from public.bank_papers where id = v_p;
  set local role authenticated;
  perform public.admin_edit_bank_paper(v_p, 'marks', '100');
  reset role;
  select r.id, r.actor_user_id into v_rev, v_actor from public.bank_question_revisions r
    where r.row_id = v_p and r.table_name = 'bank_papers' and r.field = 'marks' and r.action = 'admin_edit'
    order by r.id desc limit 1;
  insert into probe_results (area, name, ok, detail)
  values ('audit', 'paper edit writes a revision with actor_user_id', v_actor = v_admin, null);
  set local role authenticated;
  perform public.admin_undo_revision(v_rev);
  reset role;
  insert into probe_results (area, name, ok, detail)
  values ('roundtrip', 'undo restores paper marks',
          (select marks from public.bank_papers where id = v_p) is not distinct from v_m0, null);

  -- add question
  select max(ord) into v_n from public.bank_questions where paper_id = v_p;   -- as the owner
  set local role authenticated;
  select public.admin_add_bank_question(v_p, v_n, E' probe add \n', 2, 'P1') into v_new;
  reset role;
  insert into probe_results (area, name, ok, detail)
  values ('audit', 'add writes an admin_add revision by the admin, body untouched',
          exists (select 1 from public.bank_question_revisions r
                  where r.row_id = v_new and r.action = 'admin_add' and r.actor_user_id = v_admin)
          and (select body from public.bank_questions where id = v_new) = E' probe add \n', v_new);

  -- ---- 3. english rescue and reapply leave log rows ----------------------
  set local role authenticated;
  perform public.admin_english_rescue_publish_paper(v_ap);
  reset role;
  insert into probe_results (area, name, ok, detail)
  values ('audit', 'english rescue leaves a paper-level log row by the admin',
          exists (select 1 from public.audit_review_log l
                  where l.paper_id = v_ap and l.question_id is null
                    and l.action = 'admin_english_rescue_publish' and l.actor_user_id = v_admin), null);

  set local role authenticated;
  perform public.admin_reapply_paper_to_live(v_ap);
  reset role;
  insert into probe_results (area, name, ok, detail)
  values ('audit', 'reapply leaves a paper-level log row by the admin',
          exists (select 1 from public.audit_review_log l
                  where l.paper_id = v_ap and l.question_id is null
                    and l.action = 'admin_reapply_paper_to_live' and l.actor_user_id = v_admin), null);
end
$probe$;

-- ---- 4. history shows paper-level rows and labels every event ------------
do $probe$
declare
  v_admin uuid;
  v_aq uuid;
  v_ap uuid;
  v_paper_rows int;
  v_unlabelled int;
  v_total int;
  v_missing text;
begin
  select id into v_admin from public.admins limit 1;
  select q.id, q.paper_id into v_aq, v_ap
  from public.audit_questions q
  join public.audit_review_log l on l.paper_id = q.paper_id and l.action = 'admin_reapply_paper_to_live'
  where q.kind = 'question' limit 1;
  if v_aq is null then
    insert into probe_results (area, name, ok, detail)
    values ('history', 'paper-level rows appear in a question history', false, 'no reapply log row found to test with');
  else
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    set local role authenticated;
    select count(*) filter (where h.scope = 'paper' and h.action = 'admin_reapply_paper_to_live'),
           count(*) filter (where h.event_kind is null),
           count(*)
      into v_paper_rows, v_unlabelled, v_total
      from public.admin_question_history(v_aq) h;
    reset role;
    insert into probe_results (area, name, ok, detail)
    values ('history', 'paper-level admin rows appear, scope = paper', v_paper_rows >= 1, format('%s rows', v_paper_rows));
    insert into probe_results (area, name, ok, detail)
    values ('history', 'every event has an event_kind', v_unlabelled = 0, format('%s of %s unlabelled', v_unlabelled, v_total));
  end if;

  -- catalog covers every action in use (informational: the pipeline may add
  -- names later, and an action missing from the catalog is allowed)
  select string_agg(a.action, ', ') into v_missing
  from (select distinct action from public.audit_review_log
        union select distinct action from public.bank_question_revisions) a
  where not exists (select 1 from public.log_action_catalog c where c.action = a.action);
  insert into probe_results (area, name, ok, detail)
  values ('catalog', 'INFO: every action in use is in log_action_catalog', v_missing is null, coalesce('missing: ' || v_missing, 'complete'));
end
$probe$;

-- ---- 5. privilege matrix, as the owner ------------------------------------
insert into probe_results (area, name, ok, detail)
select 'grants', format('%s: anon=%s authenticated=%s', p.proname, has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE')),
       not has_function_privilege('anon', p.oid, 'EXECUTE')
         and has_function_privilege('authenticated', p.oid, 'EXECUTE')
         and p.prosecdef
         and coalesce(p.proconfig::text, '') like '%search_path=public%'
         and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0),
       'expect anon=false authenticated=true, SECURITY DEFINER, pinned search_path, nothing to PUBLIC'
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('admin_edit_bank_question', 'admin_edit_bank_paper', 'admin_add_bank_question',
                    'admin_set_bank_question_figure', 'admin_english_rescue_publish_paper',
                    'admin_reapply_paper_to_live', 'admin_question_history', 'admin_undo_revision');

insert into probe_results (area, name, ok, detail)
select 'grants', 'log_action_catalog has RLS on and no client privilege',
       c.relrowsecurity
         and not has_table_privilege('anon', c.oid, 'SELECT')
         and not has_table_privilege('authenticated', c.oid, 'SELECT')
         and not has_table_privilege('authenticated', c.oid, 'INSERT')
         and not has_table_privilege('anon', c.oid, 'INSERT'),
       null
from pg_class c where c.oid = 'public.log_action_catalog'::regclass;

insert into probe_results (area, name, ok, detail)
select 'grants', 'no write privilege on bank_papers / bank_questions for anon or authenticated',
       not exists (
         select 1 from (values ('public.bank_papers'), ('public.bank_questions')) t(tbl)
         cross join (values ('anon'), ('authenticated')) r(role)
         cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
         where has_table_privilege(r.role, t.tbl, p.priv)),
       null;

insert into probe_results (area, name, ok, detail)
select 'grants', 'ALL write policies are gone',
       not exists (select 1 from pg_policies
                   where tablename in ('bank_papers', 'bank_questions') and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')),
       coalesce((select string_agg(policyname, ', ') from pg_policies
                 where tablename in ('bank_papers', 'bank_questions') and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')), 'none');

select seq, area, name, ok, detail from probe_results order by seq;
select count(*) filter (where not ok) as failures, count(*) as checks from probe_results;

rollback;
