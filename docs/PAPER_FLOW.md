# Paper flow, for the website developer (copy to the website repo as `docs/PAPER_FLOW.md`)

Written 11 Nov 2026 from the code in this repo and the live database (SELECT only). Longer, plain-English version with every pipeline stage: `Shikshaq Papers\workflow\FLOW_OF_A_PAPER.md`.
Tags: KNOWN = checked in code or live data on 11 Nov; OPEN = unresolved or waiting for the owner; UNVERIFIED = not checked.

## 1. The shape in one paragraph

A pipeline outside this repo loads a paper into `audit_papers` / `audit_questions` (bucket `none`, held back). Routing moves its questions to bucket `kid`; a student checker holding the whole paper settles them on `/checker`; a question a student cannot settle becomes bucket `escalated` and waits for the HOD on `/hod` (Needs you). When no question is open, a script sets `audit_papers.approval_state = 'awaiting'` and the paper shows under Ready to go live. An HOD or admin presses Publish; `hod_approve_paper` runs four checks and `approval_publish_paper` writes `bank_papers` / `bank_questions`. The public reads them through `bank_paper_questions`. The site never publishes by itself.

## 2. Routes and components (KNOWN, `src/App.tsx`)

| Route | Component | Who | Notes |
|---|---|---|---|
| `/checker` | `pages/Checker.tsx` (list `?paper=<id>`, verify `&verify=1`, reopen `&reopen=<qid>`) | active row in `paper_checkers` | split view: `components/checker/VerifyScreen.tsx` |
| `/checker/practice`, `/checker/help` | `CheckerPractice`, `CheckerHelp` | anyone | practice must never import Supabase |
| `/hod` | `pages/Hod.tsx`, tabs in `lib/hod-tabs.ts` | `is_hod()` (HOD or admin) | tabs: needs-you, ready, uploads, live, assignments, verifiers, history, ai-trust, teacher-reviewers; `canSwitchTrust` admin only |
| `/hod/pipeline` | `HodPipeline` -> `PipelineRoute` | HOD | route overview, refresh every 20 s |
| `/admin` | `pages/admin/index.tsx` | admin | tabs People, Teachers, Logs, System; System holds the same pipeline page |
| `/admin/library/:paperId` | `paper-edit.tsx` | admin | calls `admin_verify_paper` (passes every question; no four checks): OPEN, medium |
| `/admin/paper-approvals/:id` | redirect to `/hod?tab=ready&paper=<id>` | | `legacy-routes.tsx:62-80` |
| 22 old `/admin/*` paths | `LegacyAdminRedirect` | | e.g. needs-you, queue, admin-queue -> HOD Needs you |
| `/past-papers/:id` | `PaperRoute`: UUID -> `PaperReader` (old `papers` table), else `BankPaper` | public | published ids are 6 hex |
| `/submit-a-paper` | `SubmitPaper` | public | bucket `paper-submissions`, table `paper_submissions` |

## 3. Question and paper states and where the UI reads them (KNOWN)

Database words (live check constraints): `audit_questions.review_bucket` in `none kid escalated admin data renderer`; `status` in `pending flagged passed red` (never `red` in practice); `question_passed` true/false is the real flag; "set aside" is `set_aside_at` + `set_aside_reason`, not a status; `audit_papers.approval_state` in null, `awaiting`, `approved`, `rejected`; `audit_papers.status` in `pending in_review passed red` (live only `pending` and `passed`, and `passed` is not lowered on reopen: 33 papers today; do not use paper `status` in UI); `checker_assignments.status` in `queued assigned done returned`.

| UI word | File | Comes from |
|---|---|---|
| To verify / Done / With the HOD / Set aside / Not for verifiers | `lib/verifier-papers.ts:152-158`, `Checker.tsx` | CASE in `verifier_paper_questions`: `set_aside_at` -> set_aside; passed -> done; `escalated` -> with_hod; `kid` and servable -> to_verify; else not_for_verifiers |
| "N of M done", "N with the HOD", "N skipped" | `lib/checker-progress.ts` | `verifier_my_papers` columns `done`, `with_hod`, `skipped` |
| Sent up by a student / The computer could not settle it | `NeedsYouTab.tsx:92` | bucket `escalated` / `admin` |
| Passed / Still open / left out | `lib/hod-publish.ts` `PreviewState` | `approval_question_state(kind, question_passed, set_aside_at)` |
| Route trail: Read, Checking by students, Needs you, Ready, Live | `components/hod/RouteTrail.tsx` | `hod_paper_trail`: approved -> live, awaiting -> ready, else needs_you / checking / read |
| Pipeline piles: Not yet sorted / Waiting for data fixes / Waiting for a layout fix | `lib/pipeline-route.ts` `PILE_KEYS` | buckets `none` / `data` / `renderer`; only totals, never lists |
| Live / Hidden | `LiveTab.tsx` | `bank_papers.is_published` |
| Coming soon | `BankPaper.tsx` | `bank_papers.needs_review` |
| Registry labels (Not started ... Live) | `lib/paper-registry.ts:45-100` | `paper_registry` |

No UI shows: `ai_confidence*`, `ai_decision`, `checked_by`, `flag_reasons` raw, paper `status`, `live_placeholder_ord`, locks, the hand-out cron. "ai_verdict" is NOT a column; it is the text of an `audit_review_log.action` (trigger on `audit_questions.source` change).

## 4. Checker RPCs (KNOWN, `lib/checker-api.ts`)

`is_paper_checker`; `verifier_my_papers` (also triggers a throttled hand-out); `verifier_paper_questions`; `verifier_next_in_paper(p_include_skipped)` (10 minute lease); `verifier_peek_next_in_paper` (no lease, prefetch); **`verifier_verdict_and_next(p_action in pass|fix|skip|ask_help, ...)`** (the one verdict path, returns the next question); `verifier_pass_and_next` (wrapped, not called); `verifier_reopen_question`; `verifier_undo_last`; `checker_split_question`; `verifier_or_separator`; `checker_question_context`; `checker_question_ai_sure`; `verifier_question_diagrams`; `paper_page_pictures`; `checker_my_stats`; `verifier_my_profile`, `verifier_set_my_profile`, `verifier_request_subjects`, `verifier_subjects_with_papers`. Storage: private `audit-figures` signed URLs, 600 s.

Buttons: Looks right (Enter/P) = pass, or fix if the text was edited; Fix it (F) opens the editor, printed-typo checkbox sets `p_printed_typo`; Ask the HOD (H) = `ask_help` with a reason (bucket becomes `escalated`); Skip (K) = `skip` (kept on the paper; "Go through skipped ones now" re-reads with `p_include_skipped`); Split (S) and "This is just the OR" run directly, not queued; Undo last = flush outbox then `verifier_undo_last` (own answer, 30 minutes, nobody else touched it, refused once the paper is awaiting/approved, split cannot be undone).

Refusal wording (`lib/checker-errors.ts`): lease lost -> "This question was open too long, or someone else took it..."; paper no longer yours -> "This paper is no longer assigned to you..."; hold -> "This paper was put on hold by your HOD..."; 40001 -> "Someone else changed this question..."; blank body -> "This question has no words..."; bare 42501 -> "Your account cannot check papers right now...".

Outbox (`lib/checker-outbox.ts`): verdict saved to localStorage first (`shikshaq.checker.outbox.v1:<scope>:<user>`), retry 1, 2, 4 s then every 8 s, 90 s per send, 30 s per request; a bare 42501 "Not authorized" is retried on purpose; a definite refusal is dropped and shown once. On stale/"not assigned" it reads `verifier_paper_questions` to see whether the verdict already landed.

Picture logic: crop first (`planCheckerPicture`; a crop with `align_score` under 0.9 is never planned); "See the whole page" only for a verified, stored page; `PaperPageFlip` fallback only when a handed-out question's crop and page both fail; `QuestionDiagrams` beside the words. Server rule that decides whether a question is handed out at all: `checker_question_servable` -> `checker_has_picture` (crop 0.9+, parent crop, or `page_verified = true` with the page stored).

**Server gap (OPEN, needs the owner):** `checker_pass_locked` / `checker_authorize_question` / `checker_settle_current` ignore `set_aside_at`, so a checker could pass a set-aside question. `supabase/migrations/20261108100000_no_pass_while_set_aside.sql` (trigger, error 22023, which `checker-errors.ts` treats as final) is on `main` but NOT applied live. Live data: 0 rows both passed and set aside.

Hand-out (live, KNOWN): pg_cron job every 2 minutes + a 5 minute throttle from `verifier_my_papers` + the HOD "Auto assign all" button; `verifier_paper_cap() = 10`. Not in older docs.

## 5. HOD RPCs (KNOWN, `lib/hod-api.ts`, `lib/hod-publish.ts`)

All `hod_*` are SECURITY DEFINER, check `is_hod()` (42501), refuse live Maths copies (55000), closed to `anon`.

- Needs you: `hod_needs_you_papers`, `hod_needs_you_questions` (buckets `escalated` and `admin` ONLY; `none`, `data`, `renderer` are on no list: OPEN), `hod_paper_trail`. Pass / Set aside / Reopen = `hod_set_question_state(p_state pass|set_aside|reopen, p_note)` (refuses a question still with students, 55000; set aside needs a note, 22023) -> `approval_set_question_state`. Fix = `hod_edit_question` then `hod_set_question_state(pass)`: two calls, the second can fail after the first saved (accepted, audit B11). Send back = `hod_send_back` (only from `escalated`).
- Ready: `hod_ready_papers`, `hod_unqueued_papers_count`. Publish flow (`PublishFlow.tsx`, 4 steps): `hod_paper_preview`, `hod_update_publish_meta` (one field at a time, plus `time_not_printed` / `instructions_not_printed`), **`hod_approve_paper(p_audit_paper_id, p_note, p_confirm_left_out)`**.
- The four checks are computed on the server (`approval_paper_checks`, 11 Nov body): questions checked (>= 1 passed, 0 open, 0 "checked by the AI only", set-aside questions counted as left out), pictures present (no passed question with an active `audit_figures` row but no `figure.path`), header complete (school, class, subject, board, year, exam, marks, time, general instructions; the last two may be marked not printed), no scanner junk (`paper_noise_hits`). The client only reads the `checks` array; a missing or non-ok check renders as failed. Errors: 55000 "This paper is not waiting to go live" / "cannot go live yet ..."; P0001 with `detail = left_out:N` when set-aside questions are unconfirmed; 42501 not an HOD. `hod_approve_paper` refuses unless `approval_state` is exactly `awaiting` (the client treats null as waiting: OPEN, low).
- Publish anyway: `hod_publish_anyway` (new function, `20261114200000_publish_override.sql`, NOT applied live until the owner pastes it) runs the same checks, then the shared `approval_publish_paper`, which skips only its "questions still open" and "picture not on the site" stops while a transaction-local `shikshaq.publish_override` is on. Needs a reason of 10+ characters; writes an `audit_review_log` row `hod_publish_override` (reason, checks skipped) that History shows; `hod_override_marks` feeds the marker in Live papers. Still refused: nothing passed, no school/class/subject/board, live Maths copy, unconfirmed left-out questions.
- Late pass: on an approved paper only `pass` is allowed; it inserts the `bank_questions` row into the question's `live_placeholder_ord` slot and logs `admin_pass` with `went_live`. A student pass never does this.
- Assignments: `hod_assignments`, `hod_unassigned_papers`, **`hod_held_back_papers`** (the "Not ready to give out" list), `hod_team`, `hod_verifier_profiles`, `hod_assign_paper`, `hod_unassign`, `distribute_unassigned_papers`, `explain_assignment`. Hand-assigning skips the 10 paper cap and own-school rule on purpose (owner 6 Nov).
- Live papers: `hod_live_papers`, `hod_hide_paper` (reason), `hod_restore_paper`, `hod_edit_live_paper`. Uploads: `hod_student_uploads`, `hod_review_upload`. History: `hod_action_history`. AI trust: `ai_trust_overall`, `ai_trust_meter`, `admin_set_ai_trust` (admin only). Reviewers: `hod_list_teacher_reviewers`, `hod_add_teacher_reviewer`, `hod_remove_teacher_reviewer`.
- Error mapping gap: the HOD code (`hod-publish.ts errorWords`) maps 42501 and 40001 only; 55000, 22023, P0001, P0002 show the server's own message. Only the admin screens (`admin-approval-shape.ts writeErrorWords`) map them.

## 6. Pipeline route page (KNOWN)

`admin_pipeline_route` (admin) / `hod_pipeline_stats`, `hod_registry`, `hod_registry_summary` (HOD). Stops: PDFs saved on the main computer; Read by the AI; Pictures waiting (the queue, upload only on the owner's word); Checking by students (open questions, active checkers, papers handed out, "X of 100 checks"); Needs you; Ready to go live ("Can go live now", "Questions left out"); Live ("Made on this route", "From the earlier library", "Hidden"). Side stops are the piles `data`, `renderer`, `none`; "Left out" = frozen live copies. A number that did not load shows "?", never 0. OPEN: decision 28 (12 Oct) says the HOD page was "pending leak audit" for two RPCs; the page and functions exist live and the audit result is not recorded.

## 7. The public paper page (KNOWN)

`BankPaper` -> `loadPaper` (`lib/question-bank.ts`): `bank_papers` where `is_published` and `question_count > 0`, then `bank_paper_visible_counts`; `needs_review` -> "Coming soon", no question call (client stricter than the RPC, which serves Maths regardless). Questions: `bank_paper_questions(p_paper_id, p_with_placeholders = true)`; anon SELECT on `bank_questions` is revoked; `answer_key` is not in the return columns. Free preview: 2 questions (`FREE_PREVIEW_QUESTIONS`; the gate is real SQL, signed-out callers get the first two visible plus placeholders before the last free one; signed-in calls write `read_events`). Held cards (`HeldQuestionCard`): "This question is not shown right now. It may appear here later." A row is held when its linked audit row is not passed and `set_aside_at` is set or `flag_reasons` overlaps `question_hold_flags()`; set-aside questions that never got a live row come back as `held-<paper>-<ord>` from `live_placeholder_ord`. Sitemap (`prebuild`) and prerender (`postbuild`, anon key, asserts no question text in `dist/`) freeze at build time: a newly published paper needs a redeploy.

## 8. Live numbers (11 Nov, will drift)

`bank_papers` 627 (617 shown, 6 shown "coming soon", 4 hidden); `audit_papers` 620 `live_copy` + 612 `new_ocr`; 0 `new_ocr` papers approved, 73 awaiting (20 with open questions); 11 active checkers, 3 HOD rows; 84 assignments `assigned`; 905 questions visible to checkers on 51 papers, 19,946 open questions in bucket `none`; storage about 757 of 900 MB (`audit-figures` 621 MB).

## 9. Code oddities to clean up (KNOWN)

Dead or unrouted: `pages/admin/paper-approval.tsx` and `lib/admin-approval.ts` functions; `lib/admin-queue.ts` (only its dummy fake and hints use it); wrappers in `checker-api.ts` with no caller (`checker_next_question` and `checker_pass_question` and `checker_fix_question` are revoked live; also `checker_pass_locked`/`fix_locked` wrappers, `checker_ask_for_help`, `checker_skip_question`, `checker_return_paper`, `checker_my_assignment`, preferences, facets, leaderboard, `adminPaperQueue`, `adminCheckerLog`, `adminHideBankPaper` and others); `hod_escalations` normaliser never called; `lib/paper-review-filter.ts` filters unused; `checker-log-api.ts` header still says the RPCs are "being added". Dummy mode (`src/dummy/*`) copies most server rules but its check wording and the "checked by AI only" rule differ from the server. Tab labels differ from `CLAUDE.md` ("Uploads", "Reviewers"). `CLAUDE.md` still quotes 1,960 `bank_papers` (live 627).

## 10. UNVERIFIED

A real signed-in walk through `/checker` and `/hod` on a phone; the full `distribute_unassigned_papers` body; where the "put on hold" refusal lives now (it is not in the text of `checker_authorize_question`); `anon` closure of every `hod_*` function (11 checked, all closed).
