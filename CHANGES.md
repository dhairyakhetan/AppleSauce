# Pull request: Write questions made simple, capped lists, and the team's log (`/games`)

**To Claude, working in the Shikshaq repo:** this file says how to turn branch `games` of
https://github.com/dhairyakhetan/AppleSauce into one pull request on Shikshaq, and what to write in it. Read it whole
before starting. This file itself is not part of the pull request. Every change made on the branch is added here as it
is made, so this file always describes the whole of what is to be handed over.

---

## How to make the pull request

**1. The source.** Branch `games` of `dhairyakhetan/AppleSauce`. Its commit `dc1d807` is Shikshaq's `shikshaq-2.0`
exactly as it was at `33a3788` (3 November 2026; checked by tree hash), which already has the games team. Everything
after `dc1d807` is the new work. Leaving out this file, every change is inside the games team's own files
(`src/components/games/`, `src/lib/games/`, `src/dummy/games-*`, `supabase/games/`): no other Shikshaq file changes.

**2. Bring it over**, on a new branch from Shikshaq's working branch:

```bash
git fetch origin
git checkout -b games-write-simpler origin/shikshaq-2.0
git fetch https://github.com/dhairyakhetan/AppleSauce.git games
git diff dc1d807 FETCH_HEAD -- . ':(exclude)CHANGES.md' > ../games.patch
git apply --3way ../games.patch
```

If the fetch is refused (the repo is private), ask for access or for a zip of the branch, and copy the files listed
under "Reference" below.

**3. One edit by hand:** in `src/components/games/CLAUDE.md`, delete the section "Read first: this copy is the games
branch". It is about the AppleSauce branch only. Keep the rest.

**4. Conflicts** can only come from games files Shikshaq changed after `33a3788`. Keep the games branch's version of
them unless the Shikshaq change is unrelated, and then keep both.

**5. Check it**, as Shikshaq's CI does. All three must pass:

```bash
npm install
npm test
npx tsc -b
npx eslint .      # 0 errors; the games files add no warnings
```

**6. Push the branch and open the pull request into `shikshaq-2.0`**: `main` only moves through pull requests from
`shikshaq-2.0` (`docs/LAUNCH.md`). Don't push to `shikshaq-2.0` or `main` directly, don't run `npm run push:all`, and
don't run anything on the live database (that step is separate, below). Title:

> Games: Write questions in four steps, every list capped, and the team's log

For the description, use the next section as it is.

---

## For the PR description

**Write questions is rebuilt to be simple for people and for chatbots, every list on the games pages is capped, and the
Team page gets a log.** Only the games team's pages change; nobody else sees any of it.

**Write questions, in four steps:**

1. **Choose where the questions go**: Board, Class, Subject, Chapter and Topic are dropdowns of the team's list, so
   nothing about the place is typed and nothing can be misspelt. A chapter whose topics aren't fixed also offers "A new
   topic" (its name, written the standard way, numbered after the others) and "No topic". The choice is remembered on
   the device.
2. **Get questions from a chatbot**: "Copy chatbot prompt" copies a prompt for that one topic, with three short steps
   on how to use it.
3. **Paste or write the questions**: the box holds questions only. Lines with a problem are underlined in red, and the
   cursor on one says why.
4. **Send for approval**: "Send the 12 ready questions" sends those that pass; the ones to fix stay in the box. "Copy a
   prompt to fix them" asks the chatbot to fix them, and its answer goes back in the box.

Beside the box, **"Your questions" is a column of its own that scrolls by itself** (it stays in view on a computer, and
is capped in height on a phone): every question as it will be sent, marked ready (with the games it plays in) or with
what to fix, one sentence per problem, each with a link to its line. "To fix" shows only those. Lines that aren't
questions are listed first.

**Why chatbots made mistakes, and what changed:**

- **The chatbot no longer writes the chapter and topic lines.** They had to match the list exactly, and were the
  commonest reason a whole reply was turned away. The prompt is now for one topic, and asks for question blocks only.
  A Board, Chapter or Topic line a chatbot adds anyway is fine when it names what is chosen; one that names somewhere
  else holds back the questions, so nothing goes under the wrong topic.
- **The checker reads what chatbots add around labels as they meant it**: "Answer:", "Wrong options:", "Difficulty:",
  "Q1.", bullets, numbers, bold, headings, code fences, several answers on one Also line, several Wrong lines. The
  words of a question or answer are still never changed.
- **One clear rule set, said once** and used by the chatbot prompt, the fix prompt and the checker: Q, A, Fill and
  Wrong always (3 to 5 wrong options separated by ";"), Also only for another right answer, Level if wanted; True/False
  is only Q and A. Before, a missing Fill line was an amber warning that still stopped the send, a missing Wrong line
  wasn't noticed, and ___ in a question changed which lines were needed. Now there is one level of problem, and the
  page says exactly what to add.
- **Every problem is one plain sentence** on the line to fix, with what to change. Wrong options separated by commas,
  options listed as a), b), c), and a question written on one line each get their own message.
- **At most 30 questions a send**, all for one topic (the database's own checks are unchanged).

**The guide at the bottom ("How to write a good question") is rewritten for people**: one question taken apart line
by line (what to write, whether it is needed, an example), a whole example, the eight usual mistakes each shown wrong
and then right with why, the limits, and what to do when something needs fixing. Its numbers come from the code, and
a test checks its example passes.

**Every list is capped**, with "Load more", so nothing fills the page:

- **Approve questions** loads only what a tab shows, newest first: Waiting 3 batches at a time (a long batch shows 10
  questions, then 10 more), Approved 20 at a time, Sent back 20 at a time. The numbers on the tabs are the totals, and
  "Showing 20 of 69" says how much is loaded. "Approve all" still approves the whole batch. Before, every waiting and
  sent-back question loaded at once, and approved ones 200 at a time.
- **Questions sent back to you** (top of Write questions) show 5 at a time.
- **Team** shows 20 people at a time.

**The team's log:** a "Logs" button on Team opens every change to the team, newest first, 20 at a time: who was
added and as what, whose role changed from what to what, who was taken off, by whom and when. It starts with everyone
on the team now.

### After merging: the database (by hand, before the deploy)

`supabase/games/upgrade-1-team-log-and-pages.sql`, run once in the Supabase SQL editor, **after** `install.sql`, with a
backup taken first. **Run it before deploying this version**: the new site calls its functions, while the site already
deployed doesn't need them and keeps working. Its steps are at the top of the file: run it as it is (a dry run that
must end "Dry run passed"), change `'yes'` to `'no'` on its DRY RUN line and run it again.

What it adds, all new, all in the `games` schema:

| | |
| --- | --- |
| `games.team_log` | Every change to the team (add, role, remove), by whom and when. Starts with everyone on the team now. Nobody reads or writes it directly. |
| `games.admin_team_set`, `games.admin_team_remove` | Add someone, change a role, or take someone off: they call `admin_set_role` and `admin_remove` (so every check is the same) and note the change in the log. Admins. |
| `games.admin_team_log(before_id, take)` | The log, newest first, 20 at a time. Admins. |
| `games.hod_counts()` | How many are waiting, approved and sent back. HoDs and admins. |
| `games.hod_waiting(before_at, before_batch, take)` | The waiting questions, 3 batches at a time, newest batch first. HoDs and admins. |
| `games.hod_sent_back(before_at, before_id, take)` | The sent-back questions, 20 at a time, newest first. HoDs and admins. |

What it guarantees, checked inside it before it keeps anything:

- **One transaction**: all of it, or none of it. It stops at once if the `games` schema isn't installed, and at its
  first `create` if it was run before.
- **Nothing that exists changes**, inside `games` or outside: it compares schemas, tables, every column (type, not
  null, permissions), functions (code, owner, permissions), triggers, policies, constraints, default permissions,
  extensions, event triggers and roles before and after, and stops if anything differs, or if anything new is not
  what it adds (a new column on a table that exists, say). `admin_set_role`, `admin_remove` and `hod_questions` are
  left exactly as they are.
- **Signed-out visitors can call nothing** in `games`; signed-in people only the site's functions (the 17 from
  `install.sql` and these 6), each of which checks the team list itself.

To remove only what it adds (the site would then need the version before this one): the two lines at the top of the
file.

**One thing it can't stop:** an admin who calls the old `admin_set_role` or `admin_remove` directly (not through the
site) changes the team without a log entry. Closing that would mean changing those functions' permissions, which this
script deliberately doesn't do. Revoke `execute` on them from `authenticated` later, once this version is live, if
that matters.

---

## Reference

### New files

| File | What it is |
| --- | --- |
| `src/components/games/QuestionList.tsx` | "Your questions": the scrolling column beside the box, each question ready or with what to fix, "All" and "To fix". |
| `src/components/games/QuestionsBox.tsx` | The box, with the red underline on lines with a problem (taken out of `WriteQuestions.tsx`, one level of problem). |
| `src/components/games/SentBack.tsx` | Questions sent back to you, 5 at a time, with "Fix it" (taken out of `WriteQuestions.tsx`). |
| `src/lib/games/place.ts`, `place.test.ts` | The five dropdowns: what each offers from the list, where the questions go once all are chosen, a new topic's number and name, and the place of a sent-back question ("Fix it"). |
| `src/lib/games/details.test.ts` | The board, class, subject, chapter and ID tests, moved out of `format.test.ts` unchanged. |
| `src/lib/games/upgrade.test.ts` | Runs `install.sql` and then the upgrade on PGlite: the dry run, refusing without the schema or a second time, stopping when anything that exists would change (a grant, a replaced function, a new column, an unexpected function), who can call what, the log (start, add, role, remove, refused changes noted nowhere, paging), counts, waiting by batches, sent back by pages. |
| `supabase/games/upgrade-1-team-log-and-pages.sql` | The upgrade (above). |

### Changed files

| File | Change |
| --- | --- |
| `src/components/games/WriteQuestions.tsx` | Rebuilt: the four steps, the dropdowns, the column beside the box, Send of the ready questions (the rest stay in the box), the fix prompt in step 4, the game preview behind "Show the games". The detail boxes that wrote lines into the text, the topic buttons, the chapter-picking dialog, the "Check" panel and the send dialog are gone. |
| `src/components/games/Guide.tsx` | Rewritten for people (above). |
| `src/components/games/GamePreview.tsx` | No heading of its own (the page gives it one); plays the ready questions. |
| `src/components/games/ApproveQuestions.tsx` | Each tab pages from the database; batches show 10 questions at a time; totals on the tabs; "Check for new questions" always there. |
| `src/components/games/Team.tsx` | "Logs" (the team's log in a dialog, 20 at a time); the list 20 at a time. |
| `src/lib/games/format.ts` | Rewritten checker (`read`): questions only, Fill and Wrong needed, labels read as chatbots write them, one level of problem, each with a sentence for people and an instruction for a chatbot; `checkPlace` for Board/Chapter/Topic lines; `toRows` puts questions under the chosen place. |
| `src/lib/games/prompt.ts` | The prompt for one topic, asking for question blocks only; `RULES`, said once and used by both prompts; a shorter fix prompt. Bulk add's prompt unchanged. |
| `src/lib/games/catalog.ts` | Only the list's rules now (`sameName`, `isOpen`, `newTopic`); checking typed chapter and topic lines is gone with them. |
| `src/lib/games/details.ts` | The helpers for the old detail boxes are gone; boards, classes, subjects, IDs and `readMeta` stay. |
| `src/lib/games/api.ts`, `rows.ts` | `loadWaiting`, `loadSentBack`, `hodCounts`, `loadTeamLog` (and `TeamChange`); approved questions 20 at a time; team changes through the logging functions. `loadForHod` and `approvedCount` are gone (the database functions behind them stay). |
| `src/dummy/games-fake-api.ts` | The same, by the database's rules: the log (starting with the made-up team and a few changes), paging, counts. Its made-up texts are read with a small `rowsOf`. |
| `src/lib/games/format.test.ts`, `prompt.test.ts`, `src/dummy/games-fake-api.test.ts` | Rewritten for the above. |
| `src/components/games/CLAUDE.md` | The working notes, brought up to date. |

### Deleted files

| File | Why |
| --- | --- |
| `src/lib/games/catalog.test.ts` | Tested checking typed chapter and topic lines against the list, which the dropdowns replace. |

### Checks run on this version

| Check | Result |
| --- | --- |
| `npx tsc -b`, `npx eslint .` | Clean: 0 errors; the games files add no warnings. |
| `npm test` | All pass: 194 files, 2,859 tests; the games' 11 files have 182. |
| Live-shaped build (`vite build` with `VITE_PREVIEW_TOOLS=false`) | Builds. No dummy code, made-up data or preview tools in it. The games pages are their own download (192 kB). |
| The upgrade on PGlite (Postgres 17) | As committed, a dry run that keeps nothing; refuses without the schema and a second time; stops on a changed grant, a replaced function, a new column or an unexpected function; the six functions do what is described, for the right people only. |
| Browser, dummy mode, 1280 px and 390 px | No sideways scrolling and no page errors. Choosing with the dropdowns, a new topic for an open chapter (named, numbered, and chosen in the list once sent), pasting, the column beside the box, sending the ready questions with the rest left in the box, copying the prompt for the topic; Approve questions 3 batches at a time and Approved 20 then 40 of 69; a member sees no Approve link; the team's log. |

**Not done here:** running real chatbots on the new prompt. The test that its example and a reply in the asked-for
form pass the checker is in `prompt.test.ts`; trying it with ChatGPT, Gemini and Claude on a real chapter is worth doing
before or after merging. `npm run build` (the full one) needs Shikshaq's live Supabase keys for its sitemap, so it
wasn't run here.

### Try it locally

1. `npm install`, then a `.env.local` with `VITE_SUPABASE_URL=http://localhost:54321`,
   `VITE_SUPABASE_PUBLISHABLE_KEY=placeholder` and `VITE_PREVIEW_TOOLS=true` (the placeholders keep it away from the
   live database).
2. `npm run dev`, then open <http://localhost:8080/games?dummy=1>. The purple bar switches who you are.
