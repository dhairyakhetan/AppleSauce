-- OPS LOG, not a migration. Do not move into supabase/migrations.
-- 2026-10-12, owner decisions: 'Yes, cut it everywhere' (JOB 1) and 'Yes, write the paths' (JOB 2).
-- Project uvtifolnsneitetzohtn. Run through the Supabase MCP execute_sql (postgres role, no auth.uid()).
--
-- JOB 1  Cut the scanner stamp  https://www.icseonline.com  (and at most the single space before it) from
--        audit_questions.body where the junk check (noise_text_hit) hits it, papers with source <> 'live_copy'.
--        Versioned path: apply_fix_locked (previous text stays in content_versions). One audit_review_log row each.
--        bank_questions and every live table are never written.
-- JOB 2  Write the existing live picture keys into audit_questions.figure.path for paper d51dec17-... (Q3, Q10, Q19),
--        after checking each key exists in storage.objects (bucket paper-figures). Metadata only.
--
-- Order actually run: (0) backups, (1) the list, (2) rehearsal with v_rehearse = true (always ends in a raised
-- exception, so it rolls back), (3) apply with v_rehearse = false, (4) verification.

------------------------------------------------------------------------------------------------------------------
-- (0) Backups. Created first, closed to every API role.
------------------------------------------------------------------------------------------------------------------
create table if not exists public.audit_watermark_cut_backup_20261012 as
  select now() as backed_up_at, q.* from public.audit_questions q
  where q.id in ('9c685550-76ee-42da-ac8a-c3be933843b6', '237eff17-1cfa-4f84-8ce6-68eeeac57485');
create table if not exists public.audit_figure_path_backup_20261012 as
  select now() as backed_up_at, q.* from public.audit_questions q
  where q.id in ('20a57eb8-cca7-42df-b1c9-e7192742e4fc', 'a85c9274-c8ac-494d-90c0-0b5c8661e130',
                 '71b38630-a7ac-4b7a-97b2-6d6f0c7e5dbf');
alter table public.audit_watermark_cut_backup_20261012 enable row level security;
alter table public.audit_figure_path_backup_20261012 enable row level security;
revoke all on table public.audit_watermark_cut_backup_20261012 from public, anon, authenticated;
revoke all on table public.audit_figure_path_backup_20261012 from public, anon, authenticated;

------------------------------------------------------------------------------------------------------------------
-- (1) The exact list: papers with source <> 'live_copy' whose body holds the string AND the junk check hits.
--     (A body that holds the string mid-text and is not hit, for example Q16(i) of the same paper, is left alone.)
------------------------------------------------------------------------------------------------------------------
-- select p.id as paper, q.display_number, q.id, substr(q.body, greatest(position('icseonline' in lower(q.body)) - 20, 1), 40) as snippet
--   from public.audit_questions q join public.audit_papers p on p.id = q.paper_id
--  where p.source is distinct from 'live_copy' and position('https://www.icseonline.com' in q.body) > 0
--    and public.noise_text_hit(q.body) is not null order by p.id, q.ord;

------------------------------------------------------------------------------------------------------------------
-- (2)/(3) Rehearsal and apply: one DO block = one transaction. v_rehearse = true ends in a raised exception that
--         carries the proof and rolls everything back.
------------------------------------------------------------------------------------------------------------------
do $job$
declare
  v_rehearse constant boolean := false;
  v_str constant text := 'https://www.icseonline.com';
  v_note constant text := 'owner decision 2026-10-12: watermark cut';
  v_fig_note constant text := 'owner decision 2026-10-12: figure path';
  v_len constant integer := length('https://www.icseonline.com');
  r record;
  v_pos integer;
  v_new text;
  v_back text;
  v_cut_len integer;
  v_ver integer;
  v_hist integer;
  v_proof jsonb := '[]'::jsonb;
  v_bank_before text;
  v_bank_after text;
  v_key text;
  v_exists boolean;
  v_newfig jsonb;
  v_n integer := 0;
  v_admin uuid;
  v_checks jsonb;
  v_prev jsonb;
begin
  -- the live tables as they are before, so we can prove they were not touched
  select md5(string_agg(bq.id || '|' || coalesce(bq.body, '') || '|' || coalesce(bq.figure, '') || '|' || bq.version::text, E'\n' order by bq.id))
    into v_bank_before
    from public.bank_questions bq where bq.paper_id = 'b392ed';

  ---------------------------------------------------------------- JOB 1
  for r in
    select q.id, q.paper_id, q.display_number, q.body, q.version
      from public.audit_questions q join public.audit_papers p on p.id = q.paper_id
     where p.source is distinct from 'live_copy'
       and position(v_str in q.body) > 0
       and public.noise_text_hit(q.body) is not null
     order by q.paper_id, q.ord
  loop
    if (length(r.body) - length(replace(r.body, v_str, ''))) <> v_len then
      raise exception 'JOB1 stop: question % holds the string more than once', r.id;
    end if;
    v_pos := position(v_str in r.body);
    if v_pos > 1 and substr(r.body, v_pos - 1, 1) = ' ' then
      v_new := left(r.body, v_pos - 2) || substr(r.body, v_pos + v_len);              -- the string and the one space before it
      v_back := left(v_new, v_pos - 2) || ' ' || v_str || substr(v_new, v_pos - 1);
    elsif substr(r.body, v_pos + v_len, 1) = ' ' then
      v_new := left(r.body, v_pos - 1) || substr(r.body, v_pos + v_len + 1);          -- the string and the one space after it
      v_back := left(v_new, v_pos - 1) || v_str || ' ' || substr(v_new, v_pos);
    else
      v_new := left(r.body, v_pos - 1) || substr(r.body, v_pos + v_len);              -- the string alone
      v_back := left(v_new, v_pos - 1) || v_str || substr(v_new, v_pos);
    end if;
    v_cut_len := length(r.body) - length(v_new);
    if v_cut_len not between v_len and v_len + 1 then
      raise exception 'JOB1 stop: question % would lose % characters', r.id, v_cut_len;
    end if;
    -- byte-identical remainder: putting the cut text back at the cut place must give the old body exactly
    if v_back is distinct from r.body then
      raise exception 'JOB1 stop: remainder of % is not byte-identical', r.id;
    end if;
    if public.noise_text_hit(v_new) is not null then
      raise exception 'JOB1 stop: the junk check still hits % after the cut', r.id;
    end if;

    v_ver := public.apply_fix_locked('audit_questions', r.id::text, r.version, jsonb_build_object('body', v_new),
                                     v_note, 'owner_decision_20261012', 'watermark cut: the scanner URL stamp only');
    if v_ver is distinct from r.version + 1 then
      raise exception 'JOB1 stop: % did not get a new version (got %)', r.id, v_ver;
    end if;
    select count(*) into v_hist from public.content_versions cv
     where cv.table_name = 'audit_questions' and cv.row_id = r.id::text and cv.version = r.version
       and cv.snapshot ->> 'body' = r.body;
    if v_hist <> 1 then
      raise exception 'JOB1 stop: the previous text of % is not in version history', r.id;
    end if;
    insert into public.audit_review_log (paper_id, question_id, action, field, before, after, note)
    values (r.paper_id, r.id, 'admin_edit', 'body', jsonb_build_object('body', r.body),
            jsonb_build_object('body', v_new, 'version', v_ver), v_note);

    v_n := v_n + 1;
    v_proof := v_proof || jsonb_build_array(jsonb_build_object(
      'q', r.display_number, 'paper', r.paper_id, 'version', r.version || '>' || v_ver,
      'chars_cut', v_cut_len, 'md5_before', md5(r.body), 'md5_after', md5(v_new),
      'md5_remainder_check', md5(replace(replace(r.body, ' ' || v_str, ''), v_str, '')) = md5(v_new),
      'junk_after', public.noise_text_hit(v_new)));
  end loop;

  ---------------------------------------------------------------- JOB 2
  for r in
    select q.id, q.display_number, q.version, q.figure, q.live_bank_question_id, bq.figure as bank_figure, q.paper_id
      from public.audit_questions q join public.bank_questions bq on bq.id = q.live_bank_question_id
     where q.paper_id = 'd51dec17-e3a6-4af6-af95-e6cbb7dc60f9' and q.figure is not null
       and (q.figure ->> 'path') is null
       and q.id in ('20a57eb8-cca7-42df-b1c9-e7192742e4fc', 'a85c9274-c8ac-494d-90c0-0b5c8661e130',
                    '71b38630-a7ac-4b7a-97b2-6d6f0c7e5dbf')
     order by q.ord
  loop
    v_key := r.bank_figure;
    select exists (select 1 from storage.objects o where o.bucket_id = 'paper-figures' and o.name = v_key) into v_exists;
    if v_key is null or not v_exists then
      raise exception 'JOB2 stop: storage key % for Q% does not exist in paper-figures', v_key, r.display_number;
    end if;
    v_newfig := r.figure || jsonb_build_object('path', v_key);
    v_ver := public.apply_fix_locked('audit_questions', r.id::text, r.version, jsonb_build_object('figure', v_newfig),
                                     v_fig_note, 'owner_decision_20261012', 'figure path: existing live key, metadata only');
    insert into public.audit_review_log (paper_id, question_id, action, field, before, after, note)
    values (r.paper_id, r.id, 'admin_edit', 'figure', jsonb_build_object('figure', r.figure),
            jsonb_build_object('figure', v_newfig, 'version', v_ver), v_fig_note);
    v_proof := v_proof || jsonb_build_array(jsonb_build_object('q', r.display_number, 'figure_path', v_key, 'in_storage', v_exists,
                                                               'other_figure_fields_kept', (v_newfig - 'path') = r.figure));
  end loop;

  ---------------------------------------------------------------- live tables untouched
  select md5(string_agg(bq.id || '|' || coalesce(bq.body, '') || '|' || coalesce(bq.figure, '') || '|' || bq.version::text, E'\n' order by bq.id))
    into v_bank_after
    from public.bank_questions bq where bq.paper_id = 'b392ed';
  if v_bank_before is distinct from v_bank_after then
    raise exception 'STOP: bank_questions of b392ed changed';
  end if;

  ---------------------------------------------------------------- the checks, as an admin (claims are transaction-local)
  select a.id into v_admin from public.admins a limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_checks := public.hod_paper_checks('d51dec17-e3a6-4af6-af95-e6cbb7dc60f9');
  v_prev := public.hod_paper_preview('d51dec17-e3a6-4af6-af95-e6cbb7dc60f9');
  v_proof := v_proof || jsonb_build_array(jsonb_build_object(
    'checks', (select jsonb_agg(jsonb_build_object('key', c ->> 'key', 'ok', c -> 'ok')) from jsonb_array_elements(v_checks) c),
    'noise_hits_left', (select count(*) from public.paper_noise_hits('d51dec17-e3a6-4af6-af95-e6cbb7dc60f9')),
    'preview_picture_staged_false', (select count(*) from regexp_matches(v_prev::text, '"picture_staged": false', 'g')),
    'bank_unchanged', true, 'questions_cut', v_n));

  if v_rehearse then
    raise exception 'REHEARSAL_ROLLBACK %', v_proof::text;
  end if;
end;
$job$;

------------------------------------------------------------------------------------------------------------------
-- (4) Verification after apply (read only). Run as separate statements.
------------------------------------------------------------------------------------------------------------------
-- junk check over every non-frozen paper: any hit of the string left where noise_text_hit fires?
-- select count(*) from public.audit_questions q join public.audit_papers p on p.id = q.paper_id
--  where p.source is distinct from 'live_copy' and position('https://www.icseonline.com' in q.body) > 0
--    and public.noise_text_hit(q.body) is not null;                                   -- expect 0
-- remainder identical to the backup:
-- select q.display_number, md5(replace(b.body, ' https://www.icseonline.com', '')) = md5(q.body) as same
--   from public.audit_watermark_cut_backup_20261012 b join public.audit_questions q on q.id = b.id;   -- expect true, true

------------------------------------------------------------------------------------------------------------------
-- 2026-10-12 addendum: watermark cut in Q16(i) of paper d51dec17-... (Applied Mathematics XI Specimen 2026).
-- Owner approved. Question 12d35e3d-16c0-4e7f-ba48-ebb3fad0e815, version 1 to 2. The stamp sat mid-text and the
-- junk check does not flag it, so the list in (1) above does not cover it. Same procedure as Q2 and Q11.
-- Result: 27 characters cut (the URL and the one space before it). Backup md5 08ff94c4..., new md5 09312f10...
-- Remainder proof and live bank md5 are recorded in the verification query below.
------------------------------------------------------------------------------------------------------------------
-- (a) SELECT the 40-character snippet (only the stamp area was printed).
-- select q.id, q.display_number, q.version, length(q.body) as blen,
--        substr(q.body, greatest(position('https://www.icseonline.com' in q.body) - 20, 1), 40) as snippet
--   from public.audit_questions q where q.paper_id = 'd51dec17-e3a6-4af6-af95-e6cbb7dc60f9' and position('icseonline' in lower(q.body)) > 0;
--
-- (b) Backup (insert only if not already present; table closed to anon and authenticated).
-- insert into public.audit_watermark_cut_backup_20261012
--   select now() as backed_up_at, q.* from public.audit_questions q
--    where q.id = '12d35e3d-16c0-4e7f-ba48-ebb3fad0e815'
--      and not exists (select 1 from public.audit_watermark_cut_backup_20261012 b where b.id = q.id);
--
-- (c) Rehearsal: raises REHEARSAL_ROLLBACK with the proof, so nothing is written.
-- do $rehearse$
-- declare
--   v_str constant text := 'https://www.icseonline.com';
--   v_len constant integer := length('https://www.icseonline.com');
--   b text; v_pos integer; v_new text; v_cut integer; v_hits integer;
-- begin
--   select q.body into b from public.audit_questions q where q.id = '12d35e3d-16c0-4e7f-ba48-ebb3fad0e815';
--   v_hits := (length(b) - length(replace(b, v_str, ''))) / v_len;
--   v_pos := position(v_str in b);
--   if v_hits <> 1 or v_pos < 2 or substr(b, v_pos - 1, 1) <> ' ' then
--     raise exception 'REHEARSAL STOP: unexpected shape hits=% pos=%', v_hits, v_pos;
--   end if;
--   v_new := left(b, v_pos - 2) || substr(b, v_pos + v_len);
--   v_cut := length(b) - length(v_new);
--   raise exception 'REHEARSAL_ROLLBACK chars_cut=% md5_old=% md5_new=% md5_remainder_check=% junk_after=% old_len=% new_len=%',
--     v_cut, md5(b), md5(v_new), md5(replace(replace(b, ' ' || v_str, ''), v_str, '')) = md5(v_new),
--     (select public.noise_text_hit(v_new) is not null), length(b), length(v_new);
-- end;
-- $rehearse$;
--
-- (d) Apply through apply_fix_locked in one transaction, with one audit_review_log row.
-- do $apply$
-- declare
--   v_id constant uuid := '12d35e3d-16c0-4e7f-ba48-ebb3fad0e815';
--   v_str constant text := 'https://www.icseonline.com';
--   v_len constant integer := length('https://www.icseonline.com');
--   v_note constant text := 'owner decision 2026-10-12: watermark cut';
--   r record; v_pos integer; v_new text; v_ver integer; v_hist integer;
--   v_bank_before text; v_bank_after text;
-- begin
--   select md5(string_agg(bq.id || '|' || coalesce(bq.body, '') || '|' || coalesce(bq.figure, '') || '|' || bq.version::text, E'\n' order by bq.id))
--     into v_bank_before from public.bank_questions bq where bq.paper_id = 'b392ed';
--   select q.id, q.paper_id, q.display_number, q.body, q.version into r from public.audit_questions q where q.id = v_id;
--   if (length(r.body) - length(replace(r.body, v_str, ''))) <> v_len then raise exception 'APPLY STOP: string count is not one'; end if;
--   v_pos := position(v_str in r.body);
--   if v_pos < 2 or substr(r.body, v_pos - 1, 1) <> ' ' then raise exception 'APPLY STOP: unexpected shape'; end if;
--   v_new := left(r.body, v_pos - 2) || substr(r.body, v_pos + v_len);
--   if md5(replace(replace(r.body, ' ' || v_str, ''), v_str, '')) <> md5(v_new) then raise exception 'APPLY STOP: remainder not identical'; end if;
--   v_ver := public.apply_fix_locked('audit_questions', v_id::text, r.version, jsonb_build_object('body', v_new),
--                                    v_note, 'owner_decision_20261012', 'watermark cut: the scanner URL stamp only');
--   if v_ver is distinct from r.version + 1 then raise exception 'APPLY STOP: no new version (got %)', v_ver; end if;
--   select count(*) into v_hist from public.content_versions cv
--    where cv.table_name = 'audit_questions' and cv.row_id = v_id::text and cv.version = r.version and cv.snapshot ->> 'body' = r.body;
--   if v_hist <> 1 then raise exception 'APPLY STOP: previous text not in version history'; end if;
--   insert into public.audit_review_log (paper_id, question_id, action, field, before, after, note)
--   values (r.paper_id, r.id, 'admin_edit', 'body', jsonb_build_object('body', r.body),
--           jsonb_build_object('body', v_new, 'version', v_ver), v_note);
--   select md5(string_agg(bq.id || '|' || coalesce(bq.body, '') || '|' || coalesce(bq.figure, '') || '|' || bq.version::text, E'\n' order by bq.id))
--     into v_bank_after from public.bank_questions bq where bq.paper_id = 'b392ed';
--   if v_bank_before is distinct from v_bank_after then raise exception 'APPLY STOP: bank_questions changed'; end if;
-- end;
-- $apply$;
--
-- (e) Verification (read only).
-- select q.version, length(q.body) as blen, md5(q.body) as new_md5,
--        md5(replace(replace(b.body, ' https://www.icseonline.com', ''), 'https://www.icseonline.com', '')) = md5(q.body) as remainder_matches_backup,
--        (select count(*) from public.audit_questions x join public.audit_papers p on p.id = x.paper_id
--          where p.source is distinct from 'live_copy' and position('https://www.icseonline.com' in x.body) > 0) as stamp_left_nonfrozen,
--        (select count(*) from public.audit_review_log l where l.question_id = q.id and l.note = 'owner decision 2026-10-12: watermark cut') as log_rows,
--        (select md5(string_agg(bq.id || '|' || coalesce(bq.body, '') || '|' || coalesce(bq.figure, '') || '|' || bq.version::text, E'\n' order by bq.id))
--           from public.bank_questions bq where bq.paper_id = 'b392ed') as bank_md5_now
--   from public.audit_questions q join public.audit_watermark_cut_backup_20261012 b on b.id = q.id
--  where q.id = '12d35e3d-16c0-4e7f-ba48-ebb3fad0e815';
-- Observed: version 2, blen 773, new md5 09312f102ec14fb814e988197361af23, remainder_matches_backup true,
-- stamp_left_nonfrozen 0, log_rows 1.
