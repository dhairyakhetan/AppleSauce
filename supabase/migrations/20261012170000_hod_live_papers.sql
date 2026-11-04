-- HOD desk, step 8: the "Live papers" tab (replaces the Admin Library).
--
-- hod_live_papers()   every paper on the site (bank_papers), live or hidden,
--                     with who hid it and why, the audit paper behind it, and
--                     how many of its questions still wait for students / the HOD.
-- hod_hide_paper()    take a live paper off the site (needs a reason).
-- hod_restore_paper() put a hidden paper back.
--
-- Hide and restore write the same row to bank_question_revisions as
-- admin_hide_bank_paper / admin_restore_bank_paper, so History and the admin
-- undo keep working. The counters are worked out here from audit_* state, not
-- from the sticky bank_papers.needs_review flag.
--
-- Maths live copies stay listed (they ARE live papers) but their waiting
-- counts are 0: the copies are frozen on the new desk.

create or replace function public.hod_live_papers()
returns table (
  paper_id text,
  title text,
  subject text,
  cls text,
  school text,
  board text,
  year text,
  exam text,
  marks numeric,
  question_count integer,
  allowed_time_minutes integer,
  is_published boolean,
  hidden_reason text,
  hidden_at timestamptz,
  hidden_by text,
  audit_paper_id uuid,
  from_pipeline boolean,
  waiting_students integer,
  waiting_you integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;

  return query
    with hidden as (
      select distinct on (r.row_id)
             r.row_id as pid, r.reason, r.created_at, r.actor, r.actor_user_id
        from public.bank_question_revisions r
       where r.table_name = 'bank_papers' and r.action = 'admin_hide'
       order by r.row_id, r.created_at desc, r.id desc
    ),
    names as (
      select a.uid, public.history_person_name(a.uid) as person
        from (select distinct h.actor_user_id as uid from hidden h where h.actor_user_id is not null) a
    ),
    pipe as (
      select distinct on (ap.live_bank_paper_id) ap.live_bank_paper_id as pid, ap.id as apid
        from public.audit_papers ap
       where ap.live_bank_paper_id is not null and ap.source <> 'live_copy'
       order by ap.live_bank_paper_id, ap.created_at desc
    ),
    waiting as (
      select q.paper_id as apid,
             count(*) filter (where q.review_bucket = 'kid') as students,
             count(*) filter (where q.review_bucket in ('escalated', 'admin')) as you
        from public.audit_questions q
       where q.kind = 'question'
         and q.review_bucket in ('kid', 'escalated', 'admin')
         and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open'
         and q.paper_id in (select p.apid from pipe p)
       group by q.paper_id
    )
    select bp.id,
           concat_ws(' ', bp.school, bp.subject, bp.cls, bp.exam, nullif(bp.year, 'year-unknown')),
           bp.subject,
           bp.cls,
           bp.school,
           bp.board,
           bp.year,
           bp.exam,
           bp.marks,
           bp.question_count,
           bp.allowed_time_minutes,
           bp.is_published,
           case when bp.is_published then null else h.reason end,
           case when bp.is_published then null else h.created_at end,
           case when bp.is_published then null
                when h.actor_user_id is not null then nm.person
                when h.actor like 'ai:%' or h.actor like 'system:%' then 'The pipeline'
                when h.pid is not null then 'An admin' end,
           pp.apid,
           pp.apid is not null,
           coalesce(w.students, 0)::integer,
           coalesce(w.you, 0)::integer
      from public.bank_papers bp
      left join hidden h on h.pid = bp.id
      left join names nm on nm.uid = h.actor_user_id
      left join pipe pp on pp.pid = bp.id
      left join waiting w on w.apid = pp.apid
     order by bp.is_published desc, bp.id;
end;
$$;

create or replace function public.hod_hide_paper(p_paper_id text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_live boolean;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Say why the paper is being hidden.' using errcode = '22023';
  end if;
  select bp.is_published into v_live from public.bank_papers bp where bp.id = p_paper_id for update;
  if not found then
    raise exception 'That paper could not be found.' using errcode = 'P0002';
  end if;
  if not coalesce(v_live, false) then
    raise exception 'This paper is already hidden.' using errcode = '55000';
  end if;
  update public.bank_papers set is_published = false where id = p_paper_id;
  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source, reason)
  values ('bank_papers', p_paper_id, 'admin_hide', 'is_published', to_jsonb(true), to_jsonb(false),
          auth.uid()::text, auth.uid(), 'admin', v_reason);
end;
$$;

create or replace function public.hod_restore_paper(p_paper_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_live boolean;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;
  select bp.is_published into v_live from public.bank_papers bp where bp.id = p_paper_id for update;
  if not found then
    raise exception 'That paper could not be found.' using errcode = 'P0002';
  end if;
  if coalesce(v_live, false) then
    raise exception 'This paper is already live.' using errcode = '55000';
  end if;
  update public.bank_papers set is_published = true where id = p_paper_id;
  insert into public.bank_question_revisions (table_name, row_id, action, field, before, after, actor, actor_user_id, source)
  values ('bank_papers', p_paper_id, 'admin_restore', 'is_published', to_jsonb(false), to_jsonb(true),
          auth.uid()::text, auth.uid(), 'admin');
end;
$$;

revoke all on function public.hod_live_papers() from public, anon, authenticated;
grant execute on function public.hod_live_papers() to authenticated;
revoke all on function public.hod_hide_paper(text, text) from public, anon, authenticated;
grant execute on function public.hod_hide_paper(text, text) to authenticated;
revoke all on function public.hod_restore_paper(text) from public, anon, authenticated;
grant execute on function public.hod_restore_paper(text) to authenticated;
