-- Rollback probe for 20260930230000_maths_question_level_hold.sql.
-- Run AFTER the migration is applied, as postgres (SQL editor / MCP). Nothing
-- persists: it ends in ROLLBACK. Any failed check raises an exception, so a
-- clean run that prints the PASS notices is the evidence.
--
-- It flips needs_review=false for ONE real needs_review Maths paper (the one
-- with the most held questions, at least 6 questions), as the data script
-- would, and impersonates the roles the repo's convention uses
-- (role + request.jwt.claims, see 20260929130000).
begin;

do $probe$
declare
  hold text[] := public.question_hold_flags();
  v_paper text;
  v_eng   text;
  v_user  uuid;
  v_total int; v_shown int; v_held int;
  v_anon_n int; v_anon_held int;
  v_anon_expected text[]; v_anon_got text[];
  v_auth_n int; v_auth_held int;
  v_held_id text;
  v_acl text;
begin
  -- privilege matrix (postgres context). PUBLIC is checked through the ACL text.
  if not has_function_privilege('anon', 'public.bank_paper_questions(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.bank_paper_questions(text)', 'EXECUTE') then
    raise exception 'FAIL: bank_paper_questions must stay executable by anon and authenticated';
  end if;
  select coalesce(p.proacl::text, '{=X/}') into v_acl
    from pg_proc p where p.oid = 'public.bank_paper_questions(text)'::regprocedure;
  if v_acl ~ '(^\{|,)=X/' then
    raise exception 'FAIL: PUBLIC holds EXECUTE on bank_paper_questions (acl %)', v_acl;
  end if;
  if has_function_privilege('anon', 'public.question_hold_flags()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.question_hold_flags()', 'EXECUTE') then
    raise exception 'FAIL: question_hold_flags must be closed to anon and authenticated';
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = 'public.bank_paper_questions(text)'::regprocedure) then
    raise exception 'FAIL: bank_paper_questions is no longer SECURITY DEFINER';
  end if;
  raise notice 'PASS grants: anon and authenticated execute bank_paper_questions, PUBLIC does not, hold fn closed';

  if not (hold @> array['figure_missing','snippet_unaligned','possible_duplicate','page_furniture','short_body','unbalanced_math_delim','ocr_junk']
          and array_length(hold, 1) = 7) then
    raise exception 'FAIL: hold flag list drifted from the owner rule: %', hold;
  end if;

  -- a real Maths needs_review paper with held questions
  select p.id into v_paper
  from public.bank_papers p
  join public.bank_questions q on q.paper_id = p.id
  join public.audit_questions a on a.live_bank_question_id = q.id and a.kind = 'question'
  where p.subject = 'Mathematics' and p.is_published
  group by p.id
  having count(*) >= 6
     and count(*) filter (where coalesce(a.status, '') <> 'passed' and a.flag_reasons && hold) >= 1
     -- at least 3 visible, so the two-question preview is really exercised
     and count(*) filter (where coalesce(a.status, '') = 'passed' or not (a.flag_reasons && hold)) >= 3
  order by count(*) filter (where coalesce(a.status, '') <> 'passed' and a.flag_reasons && hold) desc, p.id
  limit 1;
  if v_paper is null then raise exception 'FAIL: no published Maths paper with held questions to probe'; end if;

  select id into v_eng from public.bank_papers
   where subject = 'English' and is_published and needs_review order by id limit 1;
  select id into v_user from auth.users order by created_at limit 1;

  -- the flip the data script performs, for this one paper (rolled back below)
  update public.bank_papers set needs_review = false where id = v_paper;

  -- ground truth from the tables, computed independently of the function
  create temp table probe_truth on commit drop as
    select q.id, q.ord,
           (coalesce(d.status, '') <> 'passed'
            and coalesce(d.flag_reasons, '{}'::text[]) && hold) as is_held
    from public.bank_questions q
    left join lateral (
      select a.status, a.flag_reasons from public.audit_questions a
      where a.live_bank_question_id = q.id and a.kind = 'question'
      order by a.updated_at desc limit 1) d on true
    where q.paper_id = v_paper;
  select count(*), count(*) filter (where is_held) into v_total, v_held from probe_truth;
  v_shown := v_total - v_held;
  select id into v_held_id from probe_truth where is_held order by ord limit 1;
  select array_agg(id order by ord) into v_anon_expected
    from (select id, ord from probe_truth where not is_held order by ord limit 2) s;

  -- signed out
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*), array_agg(id) into v_anon_n, v_anon_got from public.bank_paper_questions(v_paper);
  select count(*) into v_anon_held from public.bank_paper_questions(v_paper) r where r.id = v_held_id;
  perform set_config('role', 'postgres', true);
  if v_anon_n <> 2 then raise exception 'FAIL: signed-out got % questions, expected exactly 2', v_anon_n; end if;
  if v_anon_held <> 0 then raise exception 'FAIL: signed-out received a held question'; end if;
  if v_anon_got is distinct from v_anon_expected then
    raise exception 'FAIL: signed-out preview % is not the first two visible questions %', v_anon_got, v_anon_expected;
  end if;
  raise notice 'PASS signed-out: exactly 2, the first two visible in paper order, no held question';

  -- signed in
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_user)::text, true);
  select count(*) into v_auth_n from public.bank_paper_questions(v_paper);
  select count(*) into v_auth_held from public.bank_paper_questions(v_paper) r where r.id = v_held_id;
  perform set_config('role', 'postgres', true);
  if v_auth_n <> v_shown then raise exception 'FAIL: signed-in got %, expected % non-held of %', v_auth_n, v_shown, v_total; end if;
  if v_auth_held <> 0 then raise exception 'FAIL: signed-in received a held question'; end if;
  raise notice 'PASS signed-in: % of % questions, held id % absent', v_auth_n, v_total, v_held_id;

  -- a passed desk copy always shows, even carrying a hold flag (rolled back)
  update public.audit_questions set status = 'passed'
   where live_bank_question_id = v_held_id and kind = 'question';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_user)::text, true);
  select count(*) into v_auth_held from public.bank_paper_questions(v_paper) r where r.id = v_held_id;
  perform set_config('role', 'postgres', true);
  if v_auth_held <> 1 then raise exception 'FAIL: a passed question with a hold flag must show'; end if;
  raise notice 'PASS passed status overrides the hold flag';

  -- an English needs_review paper stays fully held for both roles
  if v_eng is not null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    select count(*) into v_anon_n from public.bank_paper_questions(v_eng);
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_user)::text, true);
    select count(*) into v_auth_n from public.bank_paper_questions(v_eng);
    perform set_config('role', 'postgres', true);
    if v_anon_n <> 0 or v_auth_n <> 0 then
      raise exception 'FAIL: English needs_review paper % returned % / % rows', v_eng, v_anon_n, v_auth_n;
    end if;
    raise notice 'PASS English needs_review paper % returns 0 rows to anon and authenticated', v_eng;
  end if;

  raise notice 'probe paper %: total %, held %, shown %', v_paper, v_total, v_held, v_shown;
end
$probe$;

rollback;
