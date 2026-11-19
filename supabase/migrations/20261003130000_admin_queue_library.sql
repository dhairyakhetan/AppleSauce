-- 20261003130000_admin_queue_library.sql
--
-- Backs the admin rework (PLAN_ROUND27 stage 2): the Admin queue page, the
-- Library's extra views and "why hidden", and one cheap call for the nav
-- badges. NOT applied by the frontend branch; it needs the owner's yes, like
-- every migration. Four of the five new functions are read-only; admin_set_question_state is the existing writer with a widened guard.
--
--   admin_queue_papers()            one light row per paper that has questions
--                                   waiting for an admin (counts only)
--   admin_queue_questions(uuid)     that paper's waiting questions, in the
--                                   shape admin_paper_review rows use, plus the
--                                   page number and the stored picture paths
--   admin_library_extras()          per bank paper: why it is hidden, how many
--                                   questions wait with students and with an
--                                   admin, whether it waits in Ready to go live
--   admin_nav_counts()              the four nav badge numbers in one call
--   admin_approval_history(int)     papers already approved or rejected
--   admin_set_question_state(...)   re-created: also works when a paper has no
--                                   approval state (outside the approval flow)
--
-- "Waiting for an admin" means: a question row whose review_bucket is 'admin',
-- that is neither passed nor set aside (approval_question_state = 'open').
-- Set-aside questions are decided, so they are not in the queue; if the
-- owner's 657 was counted including set-aside rows the page will show a few
-- fewer, and says so by showing the number it actually lists.
--
-- Security, like every admin_* function here: SECURITY DEFINER, search_path
-- public + pg_temp, is_admin() checked first (42501 otherwise), revoked from
-- PUBLIC, anon AND authenticated by name, then granted back to authenticated.
-- No question text reaches anyone but an admin; the picture paths are paths,
-- the pictures themselves still need the audit-figures storage policy.
--
-- Read cost: admin_queue_papers and admin_nav_counts are single aggregates;
-- admin_queue_questions is one paper at a time (a few dozen rows), which is
-- why the page opens a paper on demand instead of fetching all 657 bodies.
-- If audit_questions has no index covering (review_bucket) where it is open,
-- the aggregate scans the table; the suggested index is at the bottom,
-- commented out, for the owner to decide.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. admin_queue_papers

create or replace function public.admin_queue_papers()
returns table(audit_paper_id uuid, title text, school text, waiting integer, is_live boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select ap.id,
           coalesce(nullif(btrim(ap.title), ''),
                    concat_ws(' ', coalesce(ap.publish_meta ->> 'board', ap.board),
                              'Class ' || coalesce(ap.publish_meta ->> 'cls', ap.class),
                              coalesce(ap.publish_meta ->> 'subject', ap.subject),
                              nullif(coalesce(ap.publish_meta ->> 'year', ap.year), 'year-unknown'))),
           coalesce(ap.publish_meta ->> 'school', ap.school),
           w.n::integer,
           coalesce(bp.is_published, false)
      from (
        select q.paper_id as pid, count(*) as n
          from public.audit_questions q
         where q.review_bucket = 'admin'
           and q.kind = 'question'
           and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open'
         group by q.paper_id
      ) w
      join public.audit_papers ap on ap.id = w.pid
      left join public.bank_papers bp on bp.id = ap.live_bank_paper_id
     order by w.n desc, ap.id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. admin_queue_questions

create or replace function public.admin_queue_questions(p_audit_paper_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id,
           'ord', q.ord,
           'kind', q.kind,
           'parent_id', q.parent_id,
           'number_path', q.number_path,
           'display_number', q.display_number,
           'instructions', q.instructions,
           'body', q.body,
           'options', q.options,
           'marks', q.marks,
           'figure_path', q.figure ->> 'path',
           'state', 'open',
           'version', q.version,
           'flag_reasons', to_jsonb(q.flag_reasons),
           'review_bucket', q.review_bucket,
           'live_bank_question_id', q.live_bank_question_id,
           'page', case when (q.source ->> 'page') ~ '^[0-9]{1,6}$' then (q.source ->> 'page')::integer end,
           'page_path', pg.object_path,
           'snippet_path', nullif(q.source ->> 'snippet_object', '')
         ) order by q.ord, q.id), '[]'::jsonb)
    into v
  from public.audit_questions q
  left join public.audit_paper_pages pg
         on pg.audit_paper_id = q.paper_id
        and (q.source ->> 'page') ~ '^[0-9]{1,6}$'
        and pg.page = (q.source ->> 'page')::integer
  where q.paper_id = p_audit_paper_id
    and q.review_bucket = 'admin'
    and q.kind = 'question'
    and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open';

  return v;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. admin_library_extras

create or replace function public.admin_library_extras()
returns table(paper_id text, hidden_reason text, hidden_at timestamptz, hidden_by text,
              with_students integer, with_admin integer, ready boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    with hidden as (
      select distinct on (r.row_id)
             r.row_id as pid, r.reason, r.created_at, r.actor, r.actor_user_id
        from public.bank_question_revisions r
       where r.table_name = 'bank_papers' and r.action = 'admin_hide'
       order by r.row_id, r.created_at desc, r.id desc
    ),
    -- Names are resolved once per distinct person, not once per hidden paper
    -- (473 papers by a handful of people: measured 1.15 s the other way).
    names as (
      select a.uid, public.history_person_name(a.uid) as person
        from (select distinct h.actor_user_id as uid from hidden h where h.actor_user_id is not null) a
    ),
    waiting as (
      select ap.live_bank_paper_id as pid,
             count(*) filter (where q.review_bucket = 'kid') as students,
             count(*) filter (where q.review_bucket = 'admin') as admins
        from public.audit_papers ap
        join public.audit_questions q on q.paper_id = ap.id
       where ap.live_bank_paper_id is not null
         and q.kind = 'question'
         and q.review_bucket in ('kid', 'admin')
         and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open'
       group by ap.live_bank_paper_id
    ),
    awaiting as (
      select ap.live_bank_paper_id as pid,
             bool_or(not exists (
               select 1 from public.audit_questions q2
                where q2.paper_id = ap.id and q2.kind = 'question'
                  and public.approval_question_state(q2.kind, q2.question_passed, q2.set_aside_at) = 'open')) as is_ready
        from public.audit_papers ap
       where ap.approval_state = 'awaiting' and ap.live_bank_paper_id is not null
       group by ap.live_bank_paper_id
    )
    select bp.id,
           case when bp.is_published then null else h.reason end,
           case when bp.is_published then null else h.created_at end,
           case when bp.is_published then null
                when h.actor_user_id is not null then nm.person
                when h.actor like 'ai:%' or h.actor like 'system:%' then 'The pipeline'
                when h.pid is not null then 'An admin' end,
           coalesce(w.students, 0)::integer,
           coalesce(w.admins, 0)::integer,
           coalesce(a.is_ready, false)
      from public.bank_papers bp
      left join hidden h on h.pid = bp.id
      left join names nm on nm.uid = h.actor_user_id
      left join waiting w on w.pid = bp.id
      left join awaiting a on a.pid = bp.id
     where (not bp.is_published) or w.pid is not null or a.pid is not null;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. admin_nav_counts

create or replace function public.admin_nav_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'applications', (select count(*) from public.teacher_applications where status = 'pending'),
    'reviews', (select count(*) from public.teacher_comments where approved = false)
             + (select count(*) from public.teacher_recommendations where status = 'pending'),
    'ready', (select count(*) from public.audit_papers where approval_state = 'awaiting'),
    'admin_queue', (select count(*) from public.audit_questions q
                     where q.review_bucket = 'admin' and q.kind = 'question'
                       and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open'));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. admin_approval_history: papers already decided in Ready to go live

create or replace function public.admin_approval_history(p_limit integer default 200)
returns table(audit_paper_id uuid, title text, kind text, state text, by_name text,
              at timestamptz, note text, live_bank_paper_id text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select ap.id,
           coalesce(nullif(btrim(ap.title), ''),
                    concat_ws(' ', coalesce(ap.publish_meta ->> 'school', ap.school),
                              coalesce(ap.publish_meta ->> 'subject', ap.subject),
                              coalesce(ap.publish_meta ->> 'cls', ap.class),
                              nullif(coalesce(ap.publish_meta ->> 'year', ap.year), 'year-unknown'))),
           ap.approval_kind,
           ap.approval_state,
           case when ap.approval_state = 'approved' and ap.approved_by is not null then public.history_person_name(ap.approved_by)
                when ap.approval_state = 'rejected' and ap.rejected_by is not null then public.history_person_name(ap.rejected_by) end,
           coalesce(ap.approved_at, ap.rejected_at),
           ap.approval_note,
           ap.live_bank_paper_id
      from public.audit_papers ap
     where ap.approval_state in ('approved', 'rejected')
     order by coalesce(ap.approved_at, ap.rejected_at) desc nulls last, ap.id
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. admin_set_question_state: also allowed for a paper outside the approval flow
--
-- Copied from 20261003100000_admin_paper_approval.sql with ONE change, the
-- guard. approval_state IS NULL (an old live paper with admin-bucket
-- questions, never queued) now allows pass, set_aside and reopen, logged as
-- before. Such a paper is not 'approved', so v_late stays false and a pass
-- inserts nothing into bank_questions: the existing live_copy chokepoint
-- handles live sync. A set_aside sets set_aside_at, which the existing hold
-- rule in bank_paper_questions turns into a placeholder on the live paper.
-- 'approved' papers still only accept a pass, 'rejected' still refuses.

create or replace function public.admin_set_question_state(p_question_id uuid, p_state text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_q public.audit_questions;
  v_state_before text;
  v_approval text;
  v_bank text;
  v_late boolean := false;
  v_new_id text;
  v_top text;
  v_n integer := 0;
  v_is_stem boolean;
  v_marks numeric;
  v_parent_live text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_state not in ('pass', 'set_aside', 'reopen') then
    raise exception 'state must be pass, set_aside or reopen' using errcode = '22023';
  end if;
  select * into v_q from public.audit_questions where id = p_question_id for update;
  if v_q.id is null then
    raise exception 'Question not found' using errcode = 'P0002';
  end if;
  if v_q.kind <> 'question' then
    raise exception 'Only questions can be passed or set aside' using errcode = '22023';
  end if;
  select ap.approval_state, ap.live_bank_paper_id into v_approval, v_bank
  from public.audit_papers ap where ap.id = v_q.paper_id for update;
  if v_approval = 'approved' and p_state = 'pass' then
    v_late := true;
  elsif v_approval is not null and v_approval is distinct from 'awaiting' then
    raise exception 'Questions can be set aside or reopened only while the paper waits for approval; after approval a question can only be passed'
      using errcode = '55000';
  end if;
  if v_late and v_q.live_bank_question_id is null and v_q.live_placeholder_ord is not null
     and (v_q.figure ->> 'path') is null
     and exists (select 1 from public.audit_figures f where f.question_id = v_q.id and f.status = 'active') then
    raise exception 'This question has a picture that is not staged for the site yet' using errcode = '55000';
  end if;
  if p_state = 'set_aside' and nullif(btrim(p_note), '') is null then
    raise exception 'Say why the question is set aside' using errcode = '22023';
  end if;

  v_state_before := public.approval_question_state(v_q.kind, v_q.question_passed, v_q.set_aside_at);

  if p_state = 'pass' then
    update public.audit_questions
       set status = 'passed', question_passed = true, checked_by_user = v_uid,
           set_aside_at = null, set_aside_by = null, set_aside_reason = null
     where id = p_question_id;
  elsif p_state = 'set_aside' then
    update public.audit_questions
       set question_passed = false, status = case when status = 'passed' then 'flagged' else status end,
           set_aside_at = now(), set_aside_by = v_uid, set_aside_reason = p_note
     where id = p_question_id;
  else
    update public.audit_questions
       set question_passed = false, status = case when status = 'passed' then 'flagged' else status end,
           set_aside_at = null, set_aside_by = null, set_aside_reason = null
     where id = p_question_id;
  end if;

  if p_state in ('pass', 'set_aside') then
    insert into public.content_checks (table_name, row_id, version_seen, checker_kind, actor_user_id, verdict, notes)
    values ('audit_questions', p_question_id::text, v_q.version, 'admin', v_uid,
            case when p_state = 'pass' then 'pass' else 'flag' end, p_note);
  end if;

  -- Late pass on an approved new paper: the question goes live in its
  -- placeholder's slot. Same column list and rules as admin_approve_paper
  -- (body byte-exact, no answer_key, a stem keeps marks only when none of
  -- its parts carries marks).
  if v_late and v_bank is not null and v_q.live_bank_question_id is null and v_q.live_placeholder_ord is not null then
    perform pg_advisory_xact_lock(hashtext(v_bank));
    v_top := coalesce(substring(coalesce(v_q.number_path, v_q.display_number, '') from '[[:alnum:]]+'), '0');
    loop
      v_new_id := 'MQ-' || v_bank || '-' || v_top || '-' || v_n::text;
      exit when not exists (select 1 from public.bank_questions where id = v_new_id);
      v_n := v_n + 1;
    end loop;
    v_is_stem := exists (select 1 from public.audit_questions c where c.parent_id = v_q.id);
    v_marks := case when v_is_stem and exists (select 1 from public.audit_questions c
                                                where c.parent_id = v_q.id and c.marks is not null)
                    then null else v_q.marks end;
    select p.live_bank_question_id into v_parent_live from public.audit_questions p where p.id = v_q.parent_id;

    perform set_config('shikshaq.actor', coalesce(v_uid::text, 'admin'), true);
    perform set_config('shikshaq.source', 'admin', true);
    perform set_config('shikshaq.reason', 'passed after approval', true);

    insert into public.bank_questions
      (id, paper_id, ord, number, body, marks, chapter, qtype, page, figure, options, display_number,
       instructions, suggested_time_minutes, chapter_from_paper, alternative_group, alternative_label,
       section_label, syllabus_ref, parent_question_id)
    values
      (v_new_id, v_bank, v_q.live_placeholder_ord, v_q.display_number, v_q.body, v_marks, v_q.chapter, v_q.qtype,
       case when (v_q.source ->> 'page') ~ '^[0-9]{1,6}$' then (v_q.source ->> 'page')::integer end,
       v_q.figure ->> 'path',
       public.approval_flatten_options(v_q.options),
       v_q.display_number, v_q.instructions, v_q.suggested_time_minutes, coalesce(v_q.chapter_from_paper, false),
       v_q.alternative_group, v_q.alternative_label, v_q.section_label, v_q.syllabus_ref, v_parent_live);

    update public.audit_questions
       set live_bank_question_id = v_new_id, live_placeholder_ord = null
     where id = p_question_id;

    -- Parts already live under this stem now nest under it.
    if v_is_stem then
      update public.bank_questions bq
         set parent_question_id = v_new_id
       where bq.id in (select c.live_bank_question_id from public.audit_questions c
                        where c.parent_id = v_q.id and c.live_bank_question_id is not null);
    end if;

    update public.bank_papers
       set question_count = coalesce(question_count, 0) + case when v_is_stem then 0 else 1 end,
           marks = coalesce(marks, 0) + coalesce(v_marks, 0)
     where id = v_bank;

    perform set_config('shikshaq.actor', '', true);
    perform set_config('shikshaq.source', '', true);
    perform set_config('shikshaq.reason', '', true);
  end if;

  insert into public.audit_review_log (actor_user_id, paper_id, question_id, action, before, after, note)
  values (v_uid, v_q.paper_id, p_question_id,
          case p_state when 'pass' then 'admin_pass' when 'set_aside' then 'admin_set_aside' else 'admin_reopen' end,
          jsonb_build_object('state', v_state_before),
          jsonb_build_object('state', case p_state when 'pass' then 'passed' when 'set_aside' then 'set_aside' else 'open' end)
            || case when v_new_id is not null
                    then jsonb_build_object('went_live', true, 'live_bank_question_id', v_new_id,
                                            'slot', v_q.live_placeholder_ord)
                    else '{}'::jsonb end,
          p_note);

  return case p_state when 'pass' then 'passed' when 'set_aside' then 'set_aside' else 'open' end;
end;
$function$;

-- ---------------------------------------------------------------------------
-- grants: closed to all three roles by name, then opened to authenticated.
-- A non-admin authenticated caller still gets 42501 from is_admin() first.

revoke all on function public.admin_queue_papers() from public, anon, authenticated;
revoke all on function public.admin_queue_questions(uuid) from public, anon, authenticated;
revoke all on function public.admin_library_extras() from public, anon, authenticated;
revoke all on function public.admin_nav_counts() from public, anon, authenticated;
grant execute on function public.admin_queue_papers() to authenticated;
grant execute on function public.admin_queue_questions(uuid) to authenticated;
grant execute on function public.admin_library_extras() to authenticated;
grant execute on function public.admin_nav_counts() to authenticated;

revoke all on function public.admin_approval_history(integer) from public, anon, authenticated;
grant execute on function public.admin_approval_history(integer) to authenticated;

revoke all on function public.admin_set_question_state(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_question_state(uuid, text, text) to authenticated;

-- Suggested, NOT created here (the owner decides after reading a plan on live):
--   create index concurrently if not exists audit_questions_admin_open_idx
--     on public.audit_questions (paper_id)
--     where review_bucket = 'admin' and kind = 'question' and not coalesce(question_passed, false);
