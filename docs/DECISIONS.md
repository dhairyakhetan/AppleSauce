# Owner decisions (12 to 13 November 2026)

This file records what the owner decided, so the code base does not depend on who is working on it or on anyone's
memory. Each line says what was decided, the date, and whether it is built yet. If a decision here conflicts with
older text elsewhere, **this file wins**. If the owner changes their mind, add a new dated line, do not rewrite an
old one. Status words: BUILT (in `main`), IN A PULL REQUEST, NOT BUILT YET, or STANDING (a rule, nothing to build).

The owner is not a developer. Anything said to them is plain English.

## The two folders

| Folder | Job |
|---|---|
| `Shikshaq` (this repository) | the website |
| `Shikshaq Papers` (a separate local folder, its own git history, no remote) | paper processing: PDFs to checked questions, loaded into the same Supabase project |

## People and purpose (13 Nov 2026)

- **Checkers are student volunteers.** Their screens are encouraging, quick and forgiving. STANDING.
- **On screen the word is "checker", never "verifier".** Code names, routes (`/checker`, `?tab=verifiers`), database
  names and test ids keep "verifier" on purpose; only what people read changed. BUILT (13 Nov 2026).
- **A slow or hung request never blames the person's internet and never shows database text.** The one set of words
  is `SLOW_WORDS` / `SLOW_ACTION_WORDS` in `src/lib/checker-timeout.ts` ("This is taking longer than it should. Try
  again in a minute. Nothing is lost."). Use them, do not write new ones. BUILT (13 Nov 2026).
- **The paper library is for students practising, teachers setting work, and tuition centres and schools.** Not
  for parents choosing a teacher. STANDING.
- **Priority is balance** between correctness, speed and coverage; no strong preference. **Check order: whatever is
  ready** (no forced order by board, class or year). STANDING.
- **Where the PDFs come from and whether they are cleared to be shown publicly is handled by the owner outside
  Claude.** Do not add rules about it here. STANDING.

## How questions are settled and corrected (13 Nov 2026)

- **One student pass plus the AI's first look is enough** for a question to count as correct. No second checker.
  STANDING (it is how the code works today).
- **A mistake in a live question is corrected by any checker on the team through the edit tools.** The question as
  it was stays in history (versioned fix path), and an HOD can see and undo the change. There is no public "report
  a mistake" button. STANDING; the HOD-visible "recently changed" list is NOT BUILT YET.
- **Question text is never altered** except through that versioned path (see `CLAUDE.md`, Standing constraints).

## Approval and going live (13 Nov 2026)

- **An HOD's yes is enough to put a fully checked paper live. No admin step is needed.** The four safety checks
  still run. BUILT: `hod_approve_paper` already publishes. The admin button now runs the same checks
  (`admin_approve_paper`, applied live 13 Nov 2026), except for old record-only papers (`approval_kind = 'retro'`).
- **A ready picture is copied to the public site by the HOD's own browser when the paper is opened for approval
  (to-do #76).** No "not on the site yet" warning, no failed pictures check for a picture that is simply ready. BUILT,
  waiting for the owner to paste `PASTE_IN_SUPABASE_SQL_EDITOR_AUTO_STAGE_PICTURES_20261113.sql`. Chosen over an
  edge function (none exists) and a laptop-only copy (needs the laptop on). The safety checks still refuse a paper
  whose picture is not really on the site.
- **HODs see everything.** No per-subject limits for HODs. STANDING (the earlier idea of HOD subject limits is
  dropped).

## What people see on the paper screens (13 Nov 2026) (to-do #68: BEING BUILT, no pull request yet when this was written)

- **Clear coloured labels on every paper**, a pill with an icon and words (so it still reads without colour), the
  same look on the HOD papers lists, the checker "My papers" cards and the admin publish screen.
- **Stages, each with its own label:** Not ready (missing pictures or pages) / Ready, waiting for a checker /
  Being checked (who, and how many questions are left) / Checked, waiting to go live / Live.
- **At a glance the screens answer four things:** can I give it out now, who is stuck or slow, what is blocking it
  (a reason in plain words, for example "page 3 picture missing" or "waiting for HOD"), how close to live.
- **Stuck or slow means 7 days with no progress** after a paper was given to a checker.
- **Stuck papers say why on the card** and sit in a clear "Needs attention" group. No extra badge on the tab.
- **A counts strip at the top of the HOD desk** (Not ready, Ready, Being checked, Waiting approval, Live; tapping a
  stage filters the list) **and a timeline inside each paper** (loaded, pictures complete, given out, checked,
  approved, live).
- **History shown per paper is key moments only.** Click-by-click history is kept in the database for 30 days and
  then trimmed (see Database below).
- **Alerts are on the site only.** No email and no WhatsApp.
- **Visual style:** the "tactile" look keeps the orange brand (PR 110, BUILT 13 Nov 2026).

## Checker experience (13 Nov 2026)

- **A checker with nothing left sees a plain message and an "Ask HOD for more" button** that tells the HODs the
  person is free. IN A PULL REQUEST (to-do #69, 13 Nov 2026): the button is on the empty My papers screen and a "Waiting for papers"
  list is on the HOD Assignments tab. One open ask per person, gone after 3 days or once they hold a paper again, an HOD can
  clear one, 3 asks a day at most. It needs one database file pasted by the owner
  (`supabase/migrations/20261113200000_ask_for_papers.sql`, same text as the paste file `PASTE_IN_SUPABASE_SQL_EDITOR_ASK_FOR_PAPERS_20261113.sql`
  in the Shikshaq Papers folder); until then both places say "not switched on yet" and nothing breaks.
- **A private progress screen for each volunteer, and a friendly leaderboard visible to the team only** (checkers
  and HODs, never the public). No certificates. NOT BUILT YET.
- **Checkers' work and hand-out:** papers are given by the hand-out job; a checker holds at most 10 papers with work.

## Database and libraries (13 Nov 2026)

- **Stay on the free Supabase plans** (database 500 MB, picture storage 900 MB cap used). Unlock papers up to the
  storage ceiling rather than buying more. STANDING.
- **Trim old history to stay under 500 MB**, after saving a copy to a file first: the background timer's job logs
  older than 7 days, and old edit snapshots (`content_versions`) older than 30 days. The tool declines deletes, so
  the owner pastes the SQL. The one-day detector output and two old backup tables were removed on 13 Nov 2026
  (copies saved in the archive folder); the rest is NOT DONE YET.
- **The leaked-password protection switch (a dashboard setting) stays off.** STANDING.
- **Library upgrades: safe ones only.** zod 3 to 4 is IN A PULL REQUEST (112). vitest 5 and vite 8 are skipped on
  purpose (vitest 5 needs vite 6 or newer; they only affect developer tools).
- **DDL (changes to the database structure) is pasted by the owner** from `PASTE_IN_SUPABASE_SQL_EDITOR_*.sql` files
  in the papers folder. Read-only queries are fine for Claude.

## How Claude works (13 Nov 2026)

- **At the start of every session Claude by itself checks:** approved bug requests, checkers running low, things
  waiting on the owner, and the health numbers (database size, picture storage, papers stuck 7 days). Steps and
  queries: `docs/SESSION_START.md`.
- **"Good morning" gets a full status page** (a private artifact with the numbers), plus a short plan.
- **New paper batches are 10 papers, started by Claude when the unlocked pool runs low**, then reported to the owner.
- **Where a paper's journey is the truth:** the laptop list (the registry in the papers folder) for what the
  pipeline controls (reading, loading, pictures). For approved and live the **website database wins**, and Claude
  refreshes the laptop list from it.
- **Merging to `main` is always the owner's word,** asked every time. **Nothing is deleted:** it is moved to an
  archive folder and logged.
- **Tidy depth:** website folder medium (finished audit documents moved to `docs/archive/`), papers folder deep
  (old backups, `drive_ready` and `sorted` copies may be archived; the ICSE hand-over folder stays).
- **Instruction files:** the papers `CLAUDE.md` becomes a short front page with the details in a second file;
  nothing is lost.

## Earlier decisions still in force (12 Nov 2026)

- No storage upgrade; unlock a few papers at a time (now "as many as fit", see above).
- Tactile design runs all three stages and keeps the orange brand.
- Pull requests 105 to 111 are merged; PR 112 (zod) is open, and the paper-status work is being built.
- The checking copy of paper `b392ed` is clean; live changes only after student checkers pass all 29 questions.
- Maths papers stay frozen (no check, approve, fix or re-split) unless the owner asks.

## Dead code to remove later (13 Nov 2026)

Nothing here is dropped yet. Each item is listed so a later tidy-up can remove it on purpose.

- **Database function `checker_next_question()`.** Nothing calls it. The only trace in the site code is the wrapper
  `checkerNextQuestion` in `src/lib/checker-api.ts` (also the `nextQuestion` slot of the `CheckerApi` type and the dummy
  copy), and no screen uses that slot; the checking screens use the per-paper `verifier_next_in_paper` and the
  verdict-and-next call. No SQL function calls it either (`supabase/migrations/20261011190000_close_legacy_checker_rpcs.sql`
  already revoked it from the public, anon and signed-in roles). Several old migration tests still read its text, so
  remove the function, the wrapper and those tests together, in one change that the owner pastes.

## Owner decisions owed (found in the 13 Nov 2026 fault hunt)

- **"Publish anyway": an HOD or admin may publish a paper whose checks failed, by ticking a box and typing why (14 Nov
  2026).** Owner: "allow me to ignore and pass as an override"; "still build it". The reason (at least 10 characters),
  who did it and which checks were skipped go into the paper's history (History tab). A small "Published anyway" marker
  shows in Live papers; the public page shows nothing different. Still hard stops: nothing passed yet, no school, class,
  subject or board, a live Maths copy; questions left out still need their own confirmation. BUILT, waiting for the
  owner to paste `PASTE_IN_SUPABASE_SQL_EDITOR_PUBLISH_OVERRIDE_20261114.sql`; until then the button says it is not
  switched on yet and changes nothing. The normal Publish button never skips a check.
- **A paper that goes live has no page of its own for search engines, and is not in the sitemap, until the site is
  redeployed.** The pages and the sitemap are made at build time. The app itself shows the new paper at once (the
  Latest papers shelf reads it live), so students are fine; only search engines wait. **Recommendation: a daily
  redeploy** (a Vercel deploy hook, called once a day by a scheduled GitHub Action), so every paper published
  that day is searchable by the next morning, with nobody having to remember. Cost: one extra build a day. Note
  that `CLAUDE.md` says deploy hooks were "not available to us"; the owner would need to create the hook in the
  Vercel project settings and save its address as a GitHub secret. **DECIDED 14 Nov 2026 (owner: "fully automate
  without laptop") and BUILT** as `.github/workflows/daily-redeploy.yml` (every day 02:00 India time, also runnable by
  hand from the Actions tab). It does nothing, and does not fail, until the secret `VERCEL_DEPLOY_HOOK_URL` exists: the
  owner creates the hook once (Vercel project > Settings > Git > Deploy Hooks) and saves its address as that GitHub
  secret. Until then, redeploy by hand after a publishing day.
  **CHANGED 15 Nov 2026: the owner chose "Skip the daily redeploy".** The workflow file stays in the repo but is
  DISABLED in GitHub (turn it back on from the Actions tab, Daily redeploy, Enable workflow, and add the secret
  `VERCEL_DEPLOY_HOOK_URL`). Until then a new paper's own search page and sitemap entry appear at the next merge or
  a manual redeploy in Vercel.
  **CONFIRMED 25 Nov 2026 (owner): keep it off, and let Claude ask for a rebuild whenever a session finds one is
  needed** (a paper went live after the last merge to `main`). The way: a one-line pull request to
  `docs/LAST_REBUILD.md` that the owner merges, because Claude cannot reach the live site's Vercel account. The
  rule is in `CLAUDE.md` (Architecture worth knowing, "Pages freeze at build time") and the check is in
  `docs/SESSION_START.md` section 4.
- **A student can ask for a question to be sent back to the AI, but only an HOD can say yes (18 Nov 2026, owner).** In the
  student's "Ask for help" sheet there is a second button, "Send back to the AI", and it needs a reason (5 characters or
  more). Nothing goes to the AI at that moment. The question leaves the student and waits in the HOD's Needs you tab,
  marked "wants the AI to read this again" with the student's reason. The HOD answers **Yes, it needs AI review** or
  **No, keep it with me**. A yes only sets a mark ("needs AI review", reason kept, who and when kept); it never changes
  the question's words. A no clears the mark and leaves the question with the HOD. While the mark is there the question
  stays in the HOD's pile, so the HOD can still **set it aside and Publish anyway** if the paper should go live without
  it (owner's choice). When the owner later asks for an audit, Claude reads the marked questions and their reasons,
  re-reads each one against the saved PDF by paper ID, and the redone question goes **straight back to the HOD** to
  check, not to a student. Built as columns `ai_redo_*` on the questions table (not a new `review_bucket` value, so the
  allowed values of that column are unchanged), functions `checker_ask_for_ai_redo` and `hod_ai_redo_decide`, and the
  verdict word `ask_ai_redo` in `verifier_verdict_and_next`. Migration `20261118100000_ai_redo_requests.sql`: the owner
  pastes it before the pull request is merged, or the new student button shows an error. The audit-and-redo tool itself
  lives in the Papers folder and is not built yet.
- **Papers are given to checkers ONLY when an HOD presses Auto assign all (owner, 26 Nov 2026: "stop auto assigning, only auto assign when orange button is pressed").** The 2-minute job and the fallback when a checker opens their list no longer assign; the 2-minute job still takes back papers idle for 7 days. Migration `20261126100000_assign_only_on_button.sql`, pasted by the owner.
- **If the question cannot be found on the paper, the checker is shown the pages (owner, 26 Nov 2026: "If you can't find the question on the paper, just fall back to showing the pages").** A question whose page was looked for and not found (`source.page_verified = false`) now counts as having a picture when every printed page of its paper is stored, so it is no longer parked with an admin as "page not found". The checker sees the whole paper from page 1 with the line "We could not find this question on the page; look through the pages below." Migration `20261126200000_page_fallback_when_not_found.sql`, pasted by the owner before the merge; then the Papers folder's `enforce_picture_rule.py` returns the already-parked questions to students.
- **HODs can send to the AI themselves, send a whole paper, and send a Ready paper back to checking (27 Nov 2026, owner).** On Needs you, each card has **Send to AI** (a reason of 5 to 500 characters, with a counter; same mark as an agreed student request, "needs AI review", the HOD recorded). A few seconds of **Undo** follow, and the undo is real on the server (only the HOD who sent it, only while the AI has not picked it up). The Send to AI tab shows a count. **Send whole paper to AI** on an opened paper takes ONE reason and sends every open question waiting on the HOD (and, if the HOD ticks the box, the paper's other open questions that sit with students, which come to the HOD first); a confirm box says how many go. Each question's reason starts "The HOD says this problem runs through the whole paper:" so the AI re-read job sees a paper-wide problem. On Ready, **Send back to checking** (a reason is required and logged) takes a waiting, not-live pipeline paper off the list and reopens its passed questions for the student checkers; nothing is handed out by itself, the paper waits under Papers nobody has for Auto assign all. A checker's paper card now reads "Given by <HOD first name>" ("Given by an HOD" when no name). Guardians get Edit profile (name, phone, child's class, subjects). Migration `20261127140000_hod_features.sql`, pasted by the owner; every screen keeps working before the paste.
- **A paper that is set aside (marked red) is never given out or listed as free (owner, 27 Nov 2026).** A paper is set aside when `audit_papers.is_red` is true (its `status` says `red` and `red_reason` says why), for example the second copy of the ICSE Maths 2025 paper. "Papers nobody has" and Auto assign all leave it out, the HOD's assign button refuses it, and "Not ready to give out" does not list it. It shows under "Held for another reason" with the reason "set aside". Nothing is deleted. Migration `20261127130000_handout_speed.sql` (paste file K), which also makes the three lists and Auto assign all fast again: since 26 Nov nearly every paper is free, so the old per-question checking walked several thousand questions and passed the database's 8 second limit. One fast question-counting function (`paper_handout_facts`) now serves all four.
