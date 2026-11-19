-- OPS FILE, NOT A MIGRATION. Run once, by hand, after reading it.
--
-- Students first (owner decision 2026-10-12, answer "Yes, all to students"):
-- every question must be checked by a PERSON before it counts as checked, and
-- the admin pile goes to the student checkers first.
--
-- Audit tables only. Never bank_questions or any other live table, and never a
-- question's text (body, options, instructions are not touched).
--
--   1. BACK UP the affected rows (audit_questions rows, and the paper rows) into
--      audit_students_first_backup_20261012 and audit_students_first_backup_papers_20261012.
--      Both are closed to anon and authenticated: they hold question text.
--   2. MOVE (papers with source <> 'live_copy' only):
--        a. every question that is question_passed = true but has no person verdict
--           (approval_person_verdict(): checked_by_user, or a person's pass or fix in
--           the review log) goes back to question_passed = false, review_bucket = 'kid';
--        b. every open question in review_bucket 'admin' moves to 'kid'
--           (flag_reasons are kept).
--      Questions set aside are left alone. One audit_review_log row per moved
--      question: action 'moved_to_students', note 'owner decision 2026-10-12:
--      students first', no actor (the system).
--   3. The 'retro' paper waiting in Ready (approval_state = 'awaiting',
--      approval_kind = 'retro') goes back to approval_state NULL, so it leaves
--      Ready. It is already live; nothing on the public site changes.
--
-- The servable rule still holds a question back until its pictures exist, so
-- moving a question to students never publishes anything.
--
-- REVERSE (as postgres, in one transaction), if ever needed:
--   update public.audit_questions q
--      set question_passed = b.question_passed, review_bucket = b.review_bucket, status = b.status
--     from public.audit_students_first_backup_20261012 b where b.id = q.id;
--   update public.audit_papers p
--      set approval_state = b.approval_state
--     from public.audit_students_first_backup_papers_20261012 b where b.id = p.id;
--
-- Run it as ONE transaction. Any error aborts the whole thing.

begin;

create temp table sf_ids on commit drop as
select q.id
  from public.audit_questions q
  join public.audit_papers ap on ap.id = q.paper_id and ap.source <> 'live_copy'
 where q.kind = 'question'
   and q.set_aside_at is null
   and (
        (q.question_passed and not public.approval_person_verdict(q.id, q.checked_by_user))
     or (not q.question_passed and q.review_bucket = 'admin')
   );

create table public.audit_students_first_backup_20261012 as
select q.*, now() as backed_up_at
  from public.audit_questions q
 where q.id in (select id from sf_ids);

create table public.audit_students_first_backup_papers_20261012 as
select ap.id, ap.approval_state, ap.approval_kind, ap.queued_at, ap.paper_passed, ap.status, now() as backed_up_at
  from public.audit_papers ap
 where ap.id in (select paper_id from public.audit_questions where id in (select id from sf_ids))
    or (ap.source <> 'live_copy' and ap.approval_state = 'awaiting' and ap.approval_kind = 'retro');

-- Backups hold question text: closed to every API role, readable by postgres only.
alter table public.audit_students_first_backup_20261012 enable row level security;
alter table public.audit_students_first_backup_papers_20261012 enable row level security;
revoke all on table public.audit_students_first_backup_20261012 from public, anon, authenticated;
revoke all on table public.audit_students_first_backup_papers_20261012 from public, anon, authenticated;

insert into public.log_action_catalog (action, kind, meaning) values
  ('moved_to_students', 'system', 'The question was sent back to the student checkers (students first, owner decision 2026-10-12)')
on conflict (action) do nothing;

insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, before, after, note)
select null, null, q.paper_id, q.id, 'moved_to_students',
       jsonb_build_object('question_passed', q.question_passed, 'review_bucket', q.review_bucket, 'status', q.status),
       jsonb_build_object('question_passed', false, 'review_bucket', 'kid'),
       'owner decision 2026-10-12: students first'
  from public.audit_questions q
 where q.id in (select id from sf_ids);

update public.audit_questions q
   set question_passed = false,
       review_bucket = 'kid',
       status = case when q.status = 'passed' then 'flagged' else q.status end
 where q.id in (select id from sf_ids);

update public.audit_papers ap
   set approval_state = null
 where ap.source <> 'live_copy' and ap.approval_state = 'awaiting' and ap.approval_kind = 'retro';

commit;
