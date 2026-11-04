-- 20261019110000: checker_question_ai_sure -- how sure the computer was about the question a verifier has open.
--
-- Owner, 19 Oct 2026: "show the student on the checker view in a small pill as to how much ai was confident was abt it".
-- Owner chose to show the PERCENT, knowing it may nudge checkers.
--
-- Where the number lives: audit_questions.ai_confidence_score (numeric, 0 to 1). The AI check writes it (20261007120000):
-- the lower of the two Haiku scores when both passed the question, else Sonnet's score. content_checks.confidence holds the
-- same per-check values; it adds no coverage. Measured on 19 Oct 2026: only 80 of the 5,802 not-yet-passed kid-bucket
-- questions have a score (about 1.4%), so the screen shows the pill only when there is one and never invents a number.
--
-- What this adds, and nothing else: ONE new read-only function and no change to any existing one.
--   checker_question_ai_sure(p_question_id uuid) returns integer
--   * a whole percent, 0 to 100 (round(score * 100)), or null when the question has no score;
--   * the same gate as checker_question_context: checker_authorize_question(), so the caller must be a paper checker
--     (or an HOD for an escalated question) AND hold the lease of exactly that question; anything else raises 42501 with
--     the same refusals. A verifier can therefore read the number only for the question on their screen;
--   * STABLE, so Postgres itself refuses any write inside it;
--   * returns the percent only. Not the label (high / medium / low / issue), not the decision, not the model, not
--     the other check rows, not who decided or when.
--
-- Why not a new column on verifier_next_in_paper: that function is on the hot path of every question, is called by
-- verifier_verdict_and_next and carries a RETURNS TABLE shape the speed plan depends on. A second tiny read, made
-- while the card is on screen, leaves all of that alone.
--
-- Grants follow CLAUDE.md: revoke from public, anon AND authenticated by name, then grant to authenticated only.

create or replace function public.checker_question_ai_sure(p_question_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_q public.audit_questions;
begin
  v_q := public.checker_authorize_question(p_question_id);
  if v_q.ai_confidence_score is null then
    return null;
  end if;
  return least(greatest(round(v_q.ai_confidence_score * 100)::integer, 0), 100);
end;
$function$;

revoke all on function public.checker_question_ai_sure(uuid) from public, anon, authenticated;
grant execute on function public.checker_question_ai_sure(uuid) to authenticated;
