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
