-- 20261005100000_pipeline_update_live_paper.sql
--
-- Owner instruction 2026-10-05: "Press Update live paper (55)", i.e. run the
-- live-paper update for every live paper whose questions are all checked.
-- The owner is not in public.admins and no admin is impersonated, so the body
-- of admin_update_live_paper moves into an internal function that takes the
-- actor as text. Behaviour is unchanged.
--
--   _update_live_paper(uuid, text)      internal, no grants to any API role
--   admin_update_live_paper(uuid)       same signature, grants and is_admin()
--                                       check; passes auth.uid() as the actor
--   pipeline_update_live_paper(uuid)    service_role ONLY; actor is the fixed
--                                       text 'pipeline (owner instruction 2026-10-05)'
--
-- Every revision row carries the actor text. actor_user_id is set only when
-- the actor is a user id (the admin path); the pipeline path leaves it null,
-- so no person's id is ever recorded for it. The open-question refusal stays.

set local lock_timeout = '5s';

create or replace function public._update_live_paper(p_audit_paper_id uuid, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := case when p_actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_actor::uuid end;
  v_p public.audit_papers;
  v_open integer;
  v_unstaged integer;
  v_lp text;
  v_reorder boolean;
  v_pl record;
  v_q public.audit_questions;
  v_new_id text;
  v_top text;
  v_n integer;
  v_seq integer := 0;
  v_next_ord integer;
  v_parent_live text;
  v_marks numeric;
  v_is_stem boolean;
  v_updated integer;
  v_added integer := 0;
  v_hidden integer := 0;
  v_reordered integer := 0;
  v_fields integer := 0;
  v_row public.bank_questions;
  v_count integer;
  v_sum numeric;
  v_bp public.bank_papers;
  v_actor text := coalesce(p_actor, 'admin');
begin
  select * into v_p from public.audit_papers where id = p_audit_paper_id for update;
  if v_p.id is null then
    raise exception 'Paper not found' using errcode = 'P0002';
  end if;
  if v_p.live_bank_paper_id is null then
    raise exception 'This paper is not live yet' using errcode = '55000';
  end if;
  v_lp := v_p.live_bank_paper_id;
  perform pg_advisory_xact_lock(hashtext(v_lp));

  select count(*) into v_open
  from public.audit_questions q
  where q.paper_id = p_audit_paper_id
    and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open';
  if v_open > 0 then
    raise exception '% question(s) on this paper are still open. Pass or set aside each one first.', v_open
      using errcode = '55000';
  end if;

  create temporary table if not exists live_update_plan (
    audit_question_id uuid, live_id text, action text, field text, before_v text, after_v text
  ) on commit drop;
  delete from pg_temp.live_update_plan;
  insert into pg_temp.live_update_plan select * from public.live_paper_plan(p_audit_paper_id);

  if not exists (select 1 from pg_temp.live_update_plan) then
    return jsonb_build_object('updated', 0, 'added', 0, 'hidden', 0, 'nothing_to_do', true);
  end if;

  select count(*) into v_unstaged
  from pg_temp.live_update_plan pl
  join public.audit_questions q on q.id = pl.audit_question_id
  where pl.action = 'add'
    and (q.figure ->> 'path') is null
    and exists (select 1 from public.audit_figures f where f.question_id = q.id and f.status = 'active');
  if v_unstaged > 0 then
    raise exception '% new question(s) have a picture that is not staged for the site yet', v_unstaged
      using errcode = '55000';
  end if;

  v_reorder := exists (select 1 from pg_temp.live_update_plan where field = 'ord')
               or exists (select 1 from pg_temp.live_update_plan where action = 'add')
                  and not exists (
                    select 1 from public.bank_questions b
                    where b.paper_id = v_lp
                      and not exists (select 1 from public.audit_questions a
                                      where a.paper_id = p_audit_paper_id and a.live_bank_question_id = b.id));
  select coalesce(max(ord), -1) + 1 into v_next_ord from public.bank_questions where paper_id = v_lp;

  perform set_config('shikshaq.actor', v_actor, true);
  perform set_config('shikshaq.source', 'admin', true);
  perform set_config('shikshaq.reason', 'updated live paper', true);

  for v_pl in
    select pl.* from pg_temp.live_update_plan pl
    where pl.action = 'update' and pl.field <> 'ord'
    order by pl.audit_question_id, pl.field
  loop
    if v_pl.field = 'body' then
      update public.bank_questions set body = v_pl.after_v where id = v_pl.live_id and paper_id = v_lp;
    elsif v_pl.field = 'display_number' then
      update public.bank_questions set display_number = v_pl.after_v where id = v_pl.live_id and paper_id = v_lp;
    elsif v_pl.field = 'number' then
      update public.bank_questions set number = v_pl.after_v where id = v_pl.live_id and paper_id = v_lp;
    elsif v_pl.field = 'instructions' then
      update public.bank_questions set instructions = v_pl.after_v where id = v_pl.live_id and paper_id = v_lp;
    elsif v_pl.field = 'marks' then
      update public.bank_questions set marks = v_pl.after_v::numeric where id = v_pl.live_id and paper_id = v_lp;
    end if;
    insert into public.bank_question_revisions
      (table_name, row_id, action, field, before, after, actor, actor_user_id, source, reason, audit_paper_id, audit_question_id)
    values ('bank_questions', v_pl.live_id, 'admin_edit', v_pl.field, to_jsonb(v_pl.before_v), to_jsonb(v_pl.after_v),
            v_actor, v_uid, 'admin', 'update live paper', p_audit_paper_id, v_pl.audit_question_id);
    v_fields := v_fields + 1;
  end loop;

  for v_q in
    select q.* from public.audit_questions q
    join pg_temp.live_update_plan pl on pl.audit_question_id = q.id and pl.action = 'add'
    order by q.ord, q.id
  loop
    v_top := coalesce(substring(coalesce(v_q.number_path, v_q.display_number, '') from '[[:alnum:]]+'), '0');
    v_n := 0;
    loop
      v_new_id := 'MQ-' || v_lp || '-' || v_top || '-' || v_n::text;
      exit when not exists (select 1 from public.bank_questions where id = v_new_id);
      v_n := v_n + 1;
    end loop;
    v_is_stem := exists (select 1 from public.audit_questions c where c.parent_id = v_q.id);
    v_marks := case when v_is_stem and exists (select 1 from public.audit_questions c
                                                where c.parent_id = v_q.id and c.marks is not null)
                    then null else v_q.marks end;
    select p.live_bank_question_id into v_parent_live from public.audit_questions p where p.id = v_q.parent_id;
    v_seq := v_seq + 1;

    insert into public.bank_questions
      (id, paper_id, ord, number, body, marks, chapter, qtype, page, figure, options, display_number,
       instructions, suggested_time_minutes, chapter_from_paper, alternative_group, alternative_label,
       section_label, syllabus_ref, parent_question_id)
    values
      (v_new_id, v_lp, case when v_reorder then 1000000 + v_seq else v_next_ord + v_seq - 1 end,
       v_q.display_number, v_q.body, v_marks, v_q.chapter, v_q.qtype,
       case when (v_q.source ->> 'page') ~ '^[0-9]{1,6}$' then (v_q.source ->> 'page')::integer end,
       v_q.figure ->> 'path',
       public.approval_flatten_options(v_q.options),
       v_q.display_number, v_q.instructions, v_q.suggested_time_minutes, coalesce(v_q.chapter_from_paper, false),
       v_q.alternative_group, v_q.alternative_label, v_q.section_label, v_q.syllabus_ref, v_parent_live);

    update public.audit_questions
       set live_bank_question_id = v_new_id, live_placeholder_ord = null
     where id = v_q.id;

    if v_is_stem then
      update public.bank_questions bq
         set parent_question_id = v_new_id
       where bq.paper_id = v_lp
         and bq.id in (select c.live_bank_question_id from public.audit_questions c
                        where c.parent_id = v_q.id and c.live_bank_question_id is not null);
    end if;
    v_added := v_added + 1;
  end loop;

  if v_reorder then
    create temporary table if not exists live_update_ord (
      live_id text primary key, audit_question_id uuid, old_ord integer, new_ord integer
    ) on commit drop;
    delete from pg_temp.live_update_ord;
    insert into pg_temp.live_update_ord
    select q.live_bank_question_id, q.id, b.ord, r.target_ord
    from public.live_paper_rank(p_audit_paper_id) r
    join public.audit_questions q on q.id = r.audit_id
    join public.bank_questions b on b.id = q.live_bank_question_id and b.paper_id = v_lp
    where b.ord is distinct from r.target_ord;

    update public.bank_questions b set ord = -1 - o.new_ord
      from pg_temp.live_update_ord o where b.id = o.live_id and b.paper_id = v_lp;
    update public.bank_questions b set ord = o.new_ord
      from pg_temp.live_update_ord o where b.id = o.live_id and b.paper_id = v_lp;

    update public.audit_questions q set live_placeholder_ord = r.target_ord
      from public.live_paper_rank(p_audit_paper_id) r
     where q.id = r.audit_id and q.live_placeholder_ord is not null
       and q.live_placeholder_ord is distinct from r.target_ord;

    insert into public.bank_question_revisions
      (table_name, row_id, action, field, before, after, actor, actor_user_id, source, reason, audit_paper_id, audit_question_id)
    select 'bank_questions', o.live_id, 'admin_edit', 'ord', to_jsonb(o.old_ord::text), to_jsonb(o.new_ord::text),
           v_actor, v_uid, 'admin', 'update live paper', p_audit_paper_id, o.audit_question_id
    from pg_temp.live_update_ord o
    where o.old_ord < 1000000;
    get diagnostics v_reordered = row_count;
  end if;

  for v_pl in
    select q.id as qid, q.live_bank_question_id as lid
    from public.audit_questions q
    join pg_temp.live_update_plan pl on pl.audit_question_id = q.id and pl.action = 'add'
  loop
    select * into v_row from public.bank_questions where id = v_pl.lid;
    insert into public.bank_question_revisions
      (table_name, row_id, action, field, before, after, actor, actor_user_id, source, reason, audit_paper_id, audit_question_id)
    values ('bank_questions', v_pl.lid, 'admin_add', null, null, to_jsonb(v_row) - 'answer_key',
            v_actor, v_uid, 'admin', 'update live paper', p_audit_paper_id, v_pl.qid);
  end loop;

  for v_pl in
    select pl.* from pg_temp.live_update_plan pl where pl.action = 'hide'
  loop
    update public.audit_questions
       set question_passed = false, status = 'flagged'
     where id = v_pl.audit_question_id;
    insert into public.bank_question_revisions
      (table_name, row_id, action, field, before, after, actor, actor_user_id, source, reason, audit_paper_id, audit_question_id)
    values ('bank_questions', v_pl.live_id, 'admin_hide', 'held', to_jsonb(false), to_jsonb(true),
            v_actor, v_uid, 'admin', 'update live paper: set aside in review', p_audit_paper_id, v_pl.audit_question_id);
    v_hidden := v_hidden + 1;
  end loop;

  select count(*) filter (where not exists (select 1 from public.bank_questions k where k.parent_question_id = b.id)),
         coalesce(sum(b.marks) filter (where not exists (select 1 from public.bank_questions k where k.parent_question_id = b.id)), 0)
    into v_count, v_sum
  from public.audit_questions q
  join public.bank_questions b on b.id = q.live_bank_question_id and b.paper_id = v_lp
  where q.paper_id = p_audit_paper_id and q.kind = 'question' and q.set_aside_at is null and q.question_passed;

  select * into v_bp from public.bank_papers where id = v_lp;
  if v_bp.question_count is distinct from v_count then
    update public.bank_papers set question_count = v_count where id = v_lp;
    insert into public.bank_question_revisions
      (table_name, row_id, action, field, before, after, actor, actor_user_id, source, reason, audit_paper_id)
    values ('bank_papers', v_lp, 'admin_edit', 'question_count', to_jsonb(v_bp.question_count::text), to_jsonb(v_count::text),
            v_actor, v_uid, 'admin', 'update live paper', p_audit_paper_id);
  end if;
  if v_bp.marks is distinct from v_sum then
    update public.bank_papers set marks = v_sum where id = v_lp;
    insert into public.bank_question_revisions
      (table_name, row_id, action, field, before, after, actor, actor_user_id, source, reason, audit_paper_id)
    values ('bank_papers', v_lp, 'admin_edit', 'marks', to_jsonb(v_bp.marks::text), to_jsonb(v_sum::text),
            v_actor, v_uid, 'admin', 'update live paper', p_audit_paper_id);
  end if;

  perform set_config('shikshaq.actor', '', true);
  perform set_config('shikshaq.source', '', true);
  perform set_config('shikshaq.reason', '', true);

  select count(distinct audit_question_id) into v_updated from pg_temp.live_update_plan where action = 'update';

  insert into public.audit_review_log (actor_user_id, paper_id, question_id, action, before, after, note)
  values (v_uid, p_audit_paper_id, null, 'admin_update_live',
          jsonb_build_object('live_bank_paper_id', v_lp, 'question_count', v_bp.question_count, 'marks', v_bp.marks),
          jsonb_build_object('live_bank_paper_id', v_lp, 'questions_updated', v_updated, 'fields_written', v_fields,
                             'questions_added', v_added, 'questions_hidden', v_hidden,
                             'rows_reordered', v_reordered, 'question_count', v_count, 'marks', v_sum),
          'Update live paper (actor: ' || v_actor || ')');

  return jsonb_build_object('updated', v_updated, 'added', v_added, 'hidden', v_hidden,
                            'reordered', v_reordered, 'live_bank_paper_id', v_lp);
end;
$function$;

create or replace function public.admin_update_live_paper(p_audit_paper_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return public._update_live_paper(p_audit_paper_id, coalesce(auth.uid()::text, 'admin'));
end;
$function$;

create or replace function public.pipeline_update_live_paper(p_audit_paper_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  return public._update_live_paper(p_audit_paper_id, 'pipeline (owner instruction 2026-10-05)');
end;
$function$;

revoke all on function public._update_live_paper(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.pipeline_update_live_paper(uuid) from public, anon, authenticated;
revoke all on function public.admin_update_live_paper(uuid) from public, anon, authenticated;
grant execute on function public.admin_update_live_paper(uuid) to authenticated;
grant execute on function public.pipeline_update_live_paper(uuid) to service_role;
