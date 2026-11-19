-- A question must never be "passed" and "set aside" at the same time.
--
-- Ten different database functions can mark a question passed, and only the
-- admin one (approval_set_question_state) clears the set-aside marks in the
-- same step. The checker paths did not, so a set-aside question could be
-- passed and end up in both states. Live data was clean (0 such rows on
-- 2026-11-08), so this is a guard for the future, not a repair.
--
-- One rule on the table covers every path, present and future. It fires only
-- when a row would END UP passed and set aside, so:
--   * admin pass (clears set-aside in the same update)   -> allowed
--   * admin set aside (un-passes in the same update)     -> allowed
--   * checker passes a set-aside question                -> refused
--   * set aside a question that is still passed          -> refused
-- Error code 22023 is one the checker screen treats as final (no retry loop).

create or replace function public.trg_no_pass_while_set_aside()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.question_passed is true and new.set_aside_at is not null then
    raise exception 'A question cannot be both passed and set aside. Reopen it first.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists audit_questions_no_pass_while_set_aside on public.audit_questions;
create trigger audit_questions_no_pass_while_set_aside
  before update of question_passed, set_aside_at on public.audit_questions
  for each row
  when (new.question_passed is true and new.set_aside_at is not null)
  execute function public.trg_no_pass_while_set_aside();
