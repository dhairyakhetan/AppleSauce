-- Owner decision 2026-10-12: set aside the 12 History and Civics questions of
-- audit paper 'Preliminary Examination' (St. Mary's School Mazagaon, source new_ocr,
-- live) that sit in review_bucket 'admin' (not passed, not already set aside)
-- because the picture rule could not find their printed page.
--
-- Mirrors approval_set_question_state(id, 'set_aside', note) for a question on a
-- paper that is not approved (set_aside_at, set_aside_reason, question_passed=false)
-- and writes one audit_review_log row per question (action 'set_aside', null actor,
-- same note). It does not change question text, bank tables, review_bucket or source,
-- and it does not write content_checks.
--
-- Run once, in the Supabase SQL editor, project uvtifolnsneitetzohtn.
-- Rehearsed first inside a DO block that raised REHEARSAL_OK (rolled back): updated=12,
-- logged=12, set_aside 0 -> 12, questions 65 -> 65.
--
-- Not re-runnable as written: the backup CREATE TABLE fails if the table exists,
-- and the apply block refuses unless exactly 12 rows change.

-- 1. Backup of the 12 rows as they were.
create table public.audit_set_aside_backup_20261012 as
select q.*, now() as backed_up_at
from public.audit_questions q
where q.id in (
  '01b0d17b-802b-4720-bd0f-a0769e1ac0d8','0903fe11-80f6-4637-8a92-edb3fb2bf76d',
  '0ed23ff5-0dd3-4c6d-b235-f3ed085490ec','4c8ff40a-1d0e-4db1-bbd3-8e720a42aa81',
  '5fcac811-c2a5-4b6a-a14f-f84a8e3c7811','c55090c1-e9e8-486f-8282-4d63f3a54be9',
  'c9451bdb-d462-453c-9954-63efd56aab02','cb140688-eefd-4978-adb2-548385aacaa0',
  'df7c62fe-0d67-46ee-a8df-731282d2db6c','e0dc742f-365f-488e-a55f-e07076814a2d',
  'e19dbca3-4b89-42c7-9f90-4a38d7aee276','e477d784-0e62-4bdc-bbff-6ca002d9b83a');

revoke all on table public.audit_set_aside_backup_20261012 from public, anon, authenticated;

-- 2. Apply, all or nothing (a DO block is one transaction; any RAISE rolls it back).
do $apply$
declare
  v_paper uuid := 'b32fb079-5f2c-440b-aac5-bff7deac51ea';
  v_ids uuid[] := array[
    '01b0d17b-802b-4720-bd0f-a0769e1ac0d8','0903fe11-80f6-4637-8a92-edb3fb2bf76d',
    '0ed23ff5-0dd3-4c6d-b235-f3ed085490ec','4c8ff40a-1d0e-4db1-bbd3-8e720a42aa81',
    '5fcac811-c2a5-4b6a-a14f-f84a8e3c7811','c55090c1-e9e8-486f-8282-4d63f3a54be9',
    'c9451bdb-d462-453c-9954-63efd56aab02','cb140688-eefd-4978-adb2-548385aacaa0',
    'df7c62fe-0d67-46ee-a8df-731282d2db6c','e0dc742f-365f-488e-a55f-e07076814a2d',
    'e19dbca3-4b89-42c7-9f90-4a38d7aee276','e477d784-0e62-4bdc-bbff-6ca002d9b83a']::uuid[];
  v_note text := 'owner decision 2026-10-12: printed page not found, set aside';
  v_n int;
  v_log int;
  v_sa_before int;
  v_sa_after int;
begin
  select count(*) into v_sa_before
    from public.audit_questions where paper_id = v_paper and set_aside_at is not null;

  update public.audit_questions q
     set question_passed = false, set_aside_at = now(), set_aside_by = null, set_aside_reason = v_note
   where q.id = any(v_ids) and q.paper_id = v_paper and q.kind = 'question'
     and q.review_bucket = 'admin' and q.question_passed is not true and q.set_aside_at is null;
  get diagnostics v_n = row_count;
  if v_n <> 12 then raise exception 'APPLY_ABORT rowcount % expected 12', v_n; end if;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  select null, null, q.paper_id, q.id, 'set_aside', v_note
  from public.audit_questions q where q.id = any(v_ids);
  get diagnostics v_log = row_count;
  if v_log <> 12 then raise exception 'APPLY_ABORT log rows % expected 12', v_log; end if;

  select count(*) into v_sa_after
    from public.audit_questions where paper_id = v_paper and set_aside_at is not null;
  if v_sa_after - v_sa_before <> 12 then
    raise exception 'APPLY_ABORT set_aside delta % expected 12', v_sa_after - v_sa_before;
  end if;
end
$apply$;

-- 3. Verification (read only).
select
  (select count(*) from public.audit_questions q
    where q.id in (
      '01b0d17b-802b-4720-bd0f-a0769e1ac0d8','0903fe11-80f6-4637-8a92-edb3fb2bf76d',
      '0ed23ff5-0dd3-4c6d-b235-f3ed085490ec','4c8ff40a-1d0e-4db1-bbd3-8e720a42aa81',
      '5fcac811-c2a5-4b6a-a14f-f84a8e3c7811','c55090c1-e9e8-486f-8282-4d63f3a54be9',
      'c9451bdb-d462-453c-9954-63efd56aab02','cb140688-eefd-4978-adb2-548385aacaa0',
      'df7c62fe-0d67-46ee-a8df-731282d2db6c','e0dc742f-365f-488e-a55f-e07076814a2d',
      'e19dbca3-4b89-42c7-9f90-4a38d7aee276','e477d784-0e62-4bdc-bbff-6ca002d9b83a')
      and q.set_aside_at is not null) as ids_set_aside,
  (select count(*) from public.audit_questions q
    where q.paper_id = 'b32fb079-5f2c-440b-aac5-bff7deac51ea' and q.kind = 'question'
      and q.review_bucket = 'admin'
      and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open') as admin_open_needs_you,
  (select count(*) from public.audit_questions q
    where q.paper_id = 'b32fb079-5f2c-440b-aac5-bff7deac51ea' and q.kind = 'question'
      and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'set_aside') as left_out_for_checks,
  (select count(*) from public.audit_review_log l
    where l.action = 'set_aside' and l.note = 'owner decision 2026-10-12: printed page not found, set aside') as log_rows,
  (select count(*) from public.audit_set_aside_backup_20261012) as backup_rows;
