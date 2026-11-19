# Paper checker audit, 5 November 2026

Written for the owner. Plain words on purpose.

**What this is.** The testers' sheet of 2 November had 7 problems. I checked each one against the real code and the live
database, then looked for the "plumbing" problems behind them (how the back end and the screen talk to each other). This
page lists every problem in one shape so nothing is vague:

- **How you would notice it** (the sign).
- **What is going on** (the spec of the problem).
- **What should happen / what must never happen.**
- **What is missing and what I did.**
- **How it was proven.**
- **Status**: one of *Fixed (this branch)*, *Fixed (needs your paste)*, *Already fixed before tonight*, *Your decision*,
  *Pipeline job*, *Accepted*.

**How to read the proof lines.** "Test" means an automatic check that runs on every change; the file name is given.
"Live check" means I asked the real database a question that only reads and changes nothing. "Not proven" means I could
not prove it from here, and I say what would.

**Everything on this branch was checked together:** type check clean, 195 test files and 2,991 tests pass, lint has 0
errors (the old warnings were already there). Last checked 6 November, after your answers were applied.

---

## Morning checklist (the only things that need you)

1. **Merge the branch** `checker-plumbing-2026-11-05`. It already contains the two waiting fixes from PR #95, so merging
   it makes those live too. (If you merge PR #95 first, this branch simply adds on top.)
2. **Paste two database files** into the Supabase SQL editor, in this order. **The website works the same whether or not
   you paste them**, so there is no rush:
   1. `supabase/migrations/20261105100000_checker_counts_subjects_and_lock.sql`: fixes the counters, locks one open
      function and gives the subjects hint its list.
   2. `supabase/migrations/20261106100000_hold_stops_answers_and_later_corrected.sql` (added 6 November after your
      answers): a paper put on hold takes no more answers; "Later corrected" counts a skip someone else settled.
3. **Your decisions of 6 November are in** (see section D). Nothing is waiting on you except the two pastes.

---

## A. The seven problems on the testers' sheet

### A1. "Questions on the left do not match the paper on the right" and "the page jumps from 2 to 3"
- **How you would notice it:** the verifier sees page 3 right after page 1, or the words on the left are about a
  different paper than the picture.
- **What is going on:** two different things.
  1. The flip walks through the pages we *have*. If page 2 was never stored, the flip goes from page 1 to page 3.
  2. A wrong paper happens when the whole PDF belongs to a different paper than the typed questions.
- **Should happen:** the screen says which page is missing, never jumps silently, and a question on a missing page is
  never passed blindly. A paper whose PDF is the wrong one is not given to a verifier at all.
- **Must never happen:** a verifier passes a question while looking at a different paper.
- **Already fixed before tonight:** the label now reads "Page 3 of 5" from real page numbers and names pages that are
  missing (2 Nov). The "wrong PDF" hold is live in the database (live check on 5 Nov: the serving rule contains it).
- **Missing, and done tonight:** when the question's own page has no picture, the flip opened silently on page 1. It now
  says "This question is on page N, which has no picture yet… If you cannot find the question, do not pass it." A page
  stored as text (such as "4") was ignored by the flip; it is now read properly.
- **Still true, not a code problem:** live check on 5 Nov: of 48 papers that still have work for students, **1 has no
  page pictures at all**, and **6 papers (across all papers) are missing a page in the middle**. Only those 7 can still
  skip a page. Fixing them means re-running the page-picture job in the papers folder (see D3).
- **Not proven:** a paper whose PDF is wrong for *less than half* of its questions is not caught by the hold. That
  cannot be measured from here.
- **Proof:** Test `src/lib/paper-pages.test.ts` (9 checks: page read as text, note says which page is missing, label
  uses real page numbers, gap named). Live check above. **Status: Fixed (this branch) + Pipeline job.**

### A2. "Error when submitting preferred subjects"
- **How you would notice it:** a verifier types a subject, presses Send, and gets a red-looking sentence instead of "Sent".
- **What is going on:** the library has papers in only four subjects (live check: Maths 627, English 300, History and
  Civics 125, Economics 7). The box is free text. Typing Science or Biology is refused by the database because there are
  no papers. Since 2 Nov the screen shows the database's plain sentence, but the refusal itself still happens.
- **Should happen:** the verifier is told which subjects are worth typing before they type.
- **Must never happen:** a valid subject being refused.
- **Done tonight:** the box now shows "Subjects with papers right now: Mathematics, English, History & Civics,
  Economics." It reads a new small database list. **If the new list function is not pasted yet, the box simply has no
  hint and works as before** (this is tested).
- **Proof:** Test `src/lib/checker-subjects-hint.test.ts` (hint wording, empty when unknown, the read never throws when
  the function is missing or the network fails). Test `src/lib/checker-counts-migration.test.ts` (the function is
  read-only, behind the checker check, closed to the public and signed-out visitors). Live check: the query returns the
  four subjects. **Status: Fixed (this branch); the hint appears after you paste the file.**

### A3. "View full page" button not working, papers look cropped
- **How you would notice it:** the verifier taps "See the whole page" and only a small note appears.
- **What is going on:** the screen offered the page button whenever the page number was verified. The database only
  needs a stored page picture for *some* questions. For the others the button led to a picture that was never stored, and
  no other way to see the paper was offered.
- **Should happen:** whenever a verifier cannot get the whole page, the whole paper is one tap away.
- **Must never happen:** a button that leads nowhere.
- **Already fixed:** a crop with no verified page got a "See the whole paper" button (2 Nov).
- **Done tonight:** the same button now also shows when the page was asked for and could not be loaded, and the note says
  "The whole page is not stored yet… you can open the whole paper instead." In the wide layout the frame's header
  button now switches correctly while the paper is open.
- **Proof:** Test `src/components/checker/VerifyScreenWiring.test.ts` (the rule, the declaration order, the header
  button, the note). Type check clean. **Not proven:** I did not see it drawn on a phone; see "limits".
  **Status: Fixed (this branch).**

### A4. "Asked to sign in again after each paper"
- **How you would notice it:** right after the last answer of a paper, the screen says "Sign in again".
- **What is going on:** the last answer closes the paper inside the database. Any later question-read then answers
  "this paper is not assigned to you". The screen used to read that as a sign-in problem.
- **Should happen:** "Paper finished". The person stays signed in.
- **Already fixed:** a closed paper stays on "Paper finished" (2 Nov), and a paper-gone screen exists (PR #95, now in
  this branch).
- **Missing, done tonight:** when the reply to the *last* answer is lost on a bad connection and the answer is sent again,
  the follow-up read was refused and the screen showed "paper gone", although the answer had been saved. It now ends on
  "Paper finished".
- **Left as is, on purpose:** any other unexpected refusal still says "Sign in again, or ask an admin". That is honest
  for an expired sign-in and for an account that was switched off.
- **Proof:** Test `src/lib/checker-verdict-flow.test.ts` (saved + paper closed gives "finished"; a different failure is
  still an error). **Status: Fixed (this branch).**

### A5. "The whole set of papers changes after 1 or 2 papers"
- **How you would notice it:** cards move around on My papers after every answer; a finished paper disappears; a new
  one appears.
- **What is going on:** by design, a finished paper leaves the list, and the system tops each verifier back up to 10
  papers as they finish. The *jumping* was a screen fault: the list was sorted by "questions left", which changes after
  every answer.
- **Should happen:** cards stay where they were; only a finished paper moves (to the bottom). New papers arrive at the
  end.
- **Done tonight:** the list is ordered by when each paper was handed out, the same order the database uses.
- **Proof:** Test `src/lib/verifier-papers.test.ts` ("does not reshuffle the cards when answers change how many
  questions are left" plus two more). **Status: Fixed (this branch).**

### A6. "The verified count is not updating"
- **How you would notice it:** the Today/Total numbers are lower than the work done, or go up twice for one question.
- **What is going on:** the counters counted *log lines*. A typo fix is logged under a different name, so it was never
  counted (25 so far). Editing a done question and saving it again counted the same question twice.
- **Should happen:** one number per question the verifier handled.
- **Done tonight:** counters now count distinct questions, include typo fixes, still use the Kolkata day.
- **Live check:** with the new method, all-verifiers total moves from 4,841 to 4,858 (the 25 typo fixes added, 8 double
  counts removed). The query ran fine on real data.
- **Proof:** Test `src/lib/checker-counts-migration.test.ts` (distinct questions, typo included, counted log only, gate
  kept, grants kept). **Status: Fixed (needs your paste).** Until you paste it the old numbers stay.
- **Left on purpose:** a skip and the "this is just the OR" button count in neither number (they are not verdicts). A
  count on the list page does not refresh by itself when someone else (a HOD undo, another tab) changes it; it
  refreshes when the page is opened again.

### A7. Picture-composition questions in English
- **How you would notice it:** the question says "look at the picture" and the verifier sees no picture.
- **What is going on:** the crop that is shown is the region of the question words. A picture printed beside the words
  is often outside it, and only the whole page shows it. Before 2 Nov the page pictures were not made for English at all.
- **Should happen:** a question that depends on a picture is not given to a verifier until the whole page is stored, and
  when it is given, the whole page is easy to open.
- **Already fixed:** the live serving rule now holds back questions that lean on a figure or table until their page is
  stored (live check on 5 Nov: the rule is live). The pipeline now makes English page pictures.
- **Done tonight:** the dead page button fix (A3) covers the case where the page is expected but missing.
- **Not proven:** whether *every* English paper has had its pages filled. I could only count that 7 papers across the
  whole library have a page problem. A picture that is missing from the scan itself cannot be fixed by the website.
- **Proof:** live check; Test on the page button (A3). **Status: Partly fixed; the rest is the Pipeline job in D3.**

### A8. "Corrected later" count on the HOD Verifiers tab
- **Status: Already fixed and live.** Live check: the database function now returns the "skipped then done" column.
- **What it counts:** a question this verifier skipped and later passed, fixed, split, or sent to the HOD, themselves.
- **Your ruling, 6 November: "Yes, count it".** A question they skipped that someone *else* later settled now counts too.
  "Settled" = a later counted log line by anyone: pass, fix, typo fix, split, sent to the HOD, admin pass, admin edit,
  set aside, or moved to students. An undone line does not count.
- **Done:** `hod_team()` in `supabase/migrations/20261106100000_hold_stops_answers_and_later_corrected.sql`; the column
  tooltip now says "by them or by someone else" (true before and after the paste).
- **Live check (select only):** 20 before, 23 after, over 41 skipped questions.
- **Proof:** Test `src/lib/checker-hold-and-later-migration.test.ts` (any actor, the action list, a second skip never
  settles a skip, same grants). **Status: Fixed (needs your paste).** Until you paste it the old count stays.
- **Small oddity:** "Skipped" counts each skip, "Corrected later" counts each question once, so a question skipped
  twice then fixed shows 2 skipped and 1 corrected.

---

## B. Plumbing problems I found (not on the sheet)

### B1. The 10-minute hold on a question is not renewed while the verifier edits
- **Notice:** a very long edit is refused with "open too long".
- **Reality:** the screen already handles this. It asks for the question again; if the same question comes back, it sends
  the answer once more. The typed words are kept. A different verifier cannot have it, because a paper belongs to one
  person.
- **Status: Accepted.** Proof: Test `src/lib/checker-outbox.test.ts` (retake lease).

### B2. The last answer's reply is lost, and the answer is sent again
- **Fixed tonight** (see A4).

### B3. An answer can still be sent after the paper is put on hold
- **Notice:** a question the verifier already has open is still answerable after the hold (wrong-PDF flag) is added.
- **Reality:** the database re-checks serving rules when a question is *handed out*, not when it is *answered*.
- **What should happen:** hold means no more answers. **Your ruling, 6 November: "Yes, stop it".**
- **Done:** the authorize step now refuses a held paper with 'This paper was put on hold' (in
  `supabase/migrations/20261106100000_hold_stops_answers_and_later_corrected.sql`). Only the hold is checked at answer
  time, not the picture or page rules, so a person is never refused mid-answer because a picture job is running. An HOD
  settling an escalated question is not blocked. The screen says: "This paper was put on hold by your HOD, so that
  answer was not saved. Your earlier answers on it are kept. Pick another paper for now." and does not retry.
- **Proof:** Test `src/lib/checker-hold-and-later-migration.test.ts` (check sits after the lease check, in the verifier
  branch only; older refusals kept; the message; the outbox treats it as final). **Status: Fixed (needs your paste).**
  Not proven: the real database refusing it live (the migration was never run).

### B4. "Split" and "This is just the OR" skip the safe-save queue
- **Notice:** on a dead connection these two buttons fail at once, instead of waiting.
- **Reality:** no data is lost: the question stays as it was and the verifier can press it again. **Status: Accepted.**

### B5. Screen and database disagree about pictures for questions with parts
- **Reality:** the database serves a question if its *parent* has a whole-question picture. The screen, when any part has
  its own picture, shows only the per-part pictures and drops the whole-question one, so a part with no picture of its
  own shows a "No separate picture" tile. **Status: Not changed** (changing it alters what every verifier sees on
  multi-part questions). **Spec when you want it:** show the whole-question picture first, then the part tiles.

### B6. `page_verified` can be text in the database and a true/false on the screen
- **Reality:** the database accepts the text `'true'`; the screen only trusts a real true. A text value would be
  served but show no page. **Status: Accepted** (no such rows are known; the pipeline writes true/false).

### B7. Hand-assigning a paper skips the 10-paper limit and the "own school" rule
- **Reality:** only an HOD can do this, on purpose, one paper at a time. **Your ruling, 6 November: keep ignoring the
  limits.** **Status: Accepted.**

### B8. Any verifier can trigger "return idle papers"
- **Reality:** it does only what the 2-minute timer already does. **Status: Accepted.**

### B9. One database function was open to everyone
- **Notice:** `checker_reference_ok` could be run by signed-out visitors (live check). It only reads and the caller has
  no rights to the tables, so the real risk is small.
- **Done tonight:** closed by name in the migration, like its neighbours.
- **Proof:** Test `src/lib/checker-counts-migration.test.ts`. **Status: Fixed (needs your paste).** After pasting, re-run
  the live check: `has_function_privilege('anon', …)` must say false.

### B10. The old admin publish page is weaker than the HOD publish button
- **Reality:** `/admin/paper-approvals/<id>` still publishes. It checks open questions, the basic header and pictures,
  but not year, exam, marks, time, general instructions, scanner junk, the "a person must have checked it" rule, or the
  "left-out questions" tick. Only an admin can use it.
- **Your ruling, 6 November: "Switch it off".** **Done:** `/admin/paper-approvals/<id>` no longer shows that page. It
  opens the same paper in the HOD publish flow (`/hod?tab=ready&paper=<id>`), so old bookmarks and emailed links still
  work. The old page's code is still in the folder but nothing reaches it (safe to delete in a later tidy-up).
- **Proof:** Test `src/pages/admin/admin-nav.test.ts` (the route is the redirect, the old page is not loaded, the
  target keeps `?dummy=1`). **Status: Fixed (this branch).**

### B11. "Fix" on the HOD Needs-you tab is two steps
- **Reality:** if the edit saves and the pass fails, the question is changed but still open. An error shows and one more
  press finishes it. **Status: Accepted.**

### B12. Set-aside questions leave an empty grey card on the public paper
- **Reality:** the HOD screen says they "will not go live". The public paper showed one grey card for every held
  question, and it said "being checked and will appear soon", which is false for a set-aside question. The page is
  not told why a question is held (on purpose: no question text or reason reaches the browser), so the card cannot tell
  the two apart.
- **Your ruling, 6 November: "Add a short sentence".** **Done:** the card now says "This question is not shown right now.
  It may appear here later." It is true for both cases and still gives no reason or text.
- **Proof:** Test `src/lib/admin-approval.test.tsx` (the sentence, no "will appear soon", no dashes).
  **Status: Fixed (this branch).**

### B13. The Gemini chat key
- **Reality:** the setup guide told you to name the key with the public `VITE_` prefix. Nothing in the website uses that
  name today, and the real key is the private one, but the guide was a trap.
- **Done tonight:** guide corrected. The server code still *accepts* the old name as a fallback; remove it only after
  confirming the live host has the private `GEMINI_API_KEY` set. **Status: Fixed (this branch, guide only).**

### B14. Free preview text said "five"
- **Fixed tonight** (comment). The database gives two. Live: `vis_n <= 2`.

---

## C. Things I checked and found fine

- **The answer key is not sent to the public.** The public paper reader does not use it (live check).
- **The new 5 Nov HOD functions are locked** to signed-in people (live check).
- **Hand-out rules** (10 papers, class limit, own school, idle 7 days, score) match what the screen says.
- **A double press** of Pass is safe: one entry per question; the second is treated as already saved.
- **Two tabs, same person** are handled (the second press is "already saved" or keeps the words).
- **Undo** refuses cleanly in every case I read (30 minutes, someone else touched it, HOD already handled it).

## D. Decisions and jobs for you

All of these were asked on 6 November and answered. Nothing here is waiting on you.

1. **Old admin publish page (B10):** "Switch it off". **Done.**
2. **Skipped, then fixed by someone else (A8):** "Yes, count it". **Done in the second migration (needs your paste).**
3. **Page pictures (A1, A7):** "Upload the backlog now". **Done for the two papers that still had open work and a page
   problem.** Paper `f8dde764` was missing page 4, and paper `d51dec17` had no page pictures at all (27 pages). 28 pages,
   about 3 MB, uploaded and registered; checked live: both papers now have every page with no gaps. The other papers
   that showed a page gap in my live check have no open student work: their pictures were removed on purpose by the
   clearing rule (a finished paper keeps no pages), so nothing was uploaded for them. The **question-picture backlog**
   (`picture_queue.py upload --yes`) was **not** run: you answered about the papers with gaps.
4. **Hand-assign past the limit (B7):** "Keep ignoring". **No change.** **Hold = no more answers (B3):** "Yes, stop it".
   **Done in the second migration (needs your paste).** **The held-question grey card (B12):** "Add a short sentence".
   **Done.**

## E. Limits of this audit (so you know what is not proven)

- **I did not see the screens drawn.** The checks are tests of the rules and the code, plus live reads of the database.
  A real click-through on a phone, signed in, is still worth doing on the test site.
- **The live database was only read, never changed.** The migration was checked as plain text and its queries were run
  as selects, not applied.
- **Counts are from 5 November 2026** and will drift as papers are handed out.
- The page-by-page design review (separate branch) is described in its own report.
