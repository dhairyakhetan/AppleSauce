-- 20261011190000: close the legacy one-queue checker RPCs (leak audit finding F4, 2026-10-11).
-- checker_next_question, checker_pass_question and checker_fix_question pre-date the per-paper verifier flow. The screens no
-- longer use them: VerifyScreen always passes question.version, so checker-save.ts routes to checker_pass_locked and
-- checker_fix_locked; nextQuestion has no production caller. No SQL function calls them (checker_queue_facets only mentions
-- checker_next_question in a comment). checker_fix_question rewrites audit_questions.body with no version check and no
-- content_versions history, and checker_next_question runs the unthrottled paper hand-out on every call.
-- service_role keeps EXECUTE (Supabase default) in case a script needs them.

revoke all on function public.checker_next_question() from public, anon, authenticated;
revoke all on function public.checker_pass_question(uuid) from public, anon, authenticated;
revoke all on function public.checker_fix_question(uuid, text, text, numeric) from public, anon, authenticated;
