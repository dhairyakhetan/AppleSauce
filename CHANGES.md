# Pull request: the games team (`/games`) for Shikshaq

**To Claude, working in the Shikshaq repo:** this file says how to turn branch `games` of
https://github.com/dhairyakhetan/AppleSauce into one pull request on Shikshaq, and what to write in it. Read it whole
before starting. This file itself is not part of the pull request.

---

## How to make the pull request

**1. The source.** Branch `games` of `dhairyakhetan/AppleSauce`. Its first commit, `4cd7b5b`, is Shikshaq's `main`
exactly as downloaded on 11 October 2026; everything after it is the games work. Leaving out this file and the root
`CLAUDE.md`, that is 55 files: 12,413 lines added, 11 removed, almost all of it new files under `games` folders.

**2. Bring it over**, on a new branch from Shikshaq's working branch:

```bash
git fetch origin
git checkout -b games-team origin/shikshaq-2.0
git fetch https://github.com/dhairyakhetan/AppleSauce.git games
git diff 4cd7b5b FETCH_HEAD -- . ':(exclude)CHANGES.md' ':(exclude)CLAUDE.md' > ../games.patch
git apply --3way ../games.patch
```

If the fetch is refused (the repo is private), ask for access or for a zip of the branch, and copy the files listed
under "New files" and "Changed Shikshaq files" below.

**3. Two edits by hand:**

- **Root `CLAUDE.md`**: keep Shikshaq's own, and add this row at the end of its "Other documents carry the rest of the
  context" table:

  ```
  | `src/components/games/CLAUDE.md` | the games team's `/games` site (writing, approving and playing revision questions, its own `games` schema in `supabase/games/`): read it before changing anything under `/games`, and follow it for that only. |
  ```

- **`src/components/games/CLAUDE.md`**: delete its section "Read first: this copy is the games branch". It is about the
  AppleSauce branch only. Keep the rest.

**4. Conflicts** can only come from the Shikshaq files the games work touches (the "Changed Shikshaq files" table),
where Shikshaq may have moved on since 11 October. Keep Shikshaq's current code and add the games lines the table
describes. If `package-lock.json` conflicts, take Shikshaq's and run `npm install -D @electric-sql/pglite@^0.3.6`.
Everything else is new files.

**5. Check it**, as Shikshaq's CI does. All three must pass:

```bash
npm install       # adds one dev dependency, @electric-sql/pglite (tests only)
npm test
npx tsc -b
npx eslint .      # 0 errors; the games files add no warnings
```

**6. Push the branch and open the pull request into `shikshaq-2.0`**: `main` only moves through pull requests from
`shikshaq-2.0` (`docs/LAUNCH.md`). Don't push to `shikshaq-2.0` or `main` directly, don't run `npm run push:all`, and
don't run anything on the live database (that step is separate, below). Title:

> Games team at `/games`: write, approve and play revision questions

For the description, use the next section as it is.

---

## For the PR description

**Adds a games team to Shikshaq, at `/games`, visible only to the people on its own list.**

The team writes short questions and answers for revision games. HoDs approve them, and the puzzles (crossword, word
search, matching, fill in the blank, multiple choice) are made from the approved questions on the device, with no AI.
It is the games site (shikshaq-games.vercel.app) brought into Shikshaq, rebuilt in Shikshaq's look. Nothing changes for
anyone who isn't on the games team: they see no link, and `/games` shows them a one-line page.

**Five parts**, one route (`/games/*`), without the footer, like `/hod`:

- **Write questions** (`/games`, everyone on the team). Questions are written as blocks of labelled lines under Board,
  Class, Subject, Chapter and Topic lines:

  ```
  Q: Reaction in which a single reactant breaks down into simpler products
  A: Decomposition reaction
  Also: Decomposition
  Fill: A reaction in which a single reactant breaks down into simpler products is called a ___.
  Wrong: Combination reaction; Displacement reaction; Neutralisation reaction
  Level: easy
  ```

  Every version a game needs is written out, so nothing is guessed: `Also` lines are the other answers that count,
  `Fill` the fill-in-the-blank sentence, `Wrong` the multiple-choice options. Each question is checked as it is
  written, and every problem is underlined on its line with what to change (the answer in the question, "of the
  following", a note in brackets, an answer students can't type, a Fill line without its `___`, too few wrong options,
  more than 30 questions in a topic or 80 in a chapter, and so on). A table shows which games each question can go in,
  and a small version of Try the games plays them. Questions can only be written for a chapter on the team's list:
  once board, class and subject are filled in, the Chapter box becomes a dropdown of the listed chapters, and the
  chapter's topics become buttons. Where the list gives a chapter no topics, its questions go under topics of their own
  (the first question sent under a new topic adds it, and each topic keeps one number and one name).
  - **"Copy chatbot prompt"** copies a prompt for one chapter: its lines and topics, every rule the checker applies, the
    block format with an example, and to reply in one code block. For a chapter with open topics it asks the chatbot to
    divide the questions into 2 to 6 topics as the textbook does, keeping the topics already in use.
  - **Sending with problems** offers "Remove those and send" (with Undo) or "Copy prompt to fix them": a prompt listing
    each question turned away with short instructions for it, the rules once, the whole text, and to write it all again
    in one code block.
  - **Sent back:** questions an HoD sent back show at the top with the reason, and "Fix it" puts one back in the box.
- **Approve questions** (`/games/approve`, HoDs and admins). Batches wait with the sender's name and email. Approve or
  send back one question or a whole batch, with a reason the teacher sees; every action can be undone for a few
  seconds. Admins can download the approved questions as CSV or JSON.
- **Try the games** (`/games/play`, everyone on the team). Pick a class, subject and chapter (every topic is in; tap one
  to leave it out) and play the puzzles students will get. Every puzzle is checked before it is shown.
- **Team** (`/games/team`, admins). Add someone by their Google email as member, HoD or admin, change roles, remove
  people. The moderator (the first admin) can't be removed or demoted.
- **Chapters** (`/games/chapters`, admins): the list questions can be written for.
  - Pick a board, class and subject from three dropdowns (those with chapters first, with how many, and a search box
    for long lists). Its chapters are listed; a chapter opens to its topics, and a topic to its first 5 questions, with
    "Show 5 more" up to 20. Clicking again closes it, and a topic also closes when scrolled past, without moving what
    is on screen.
  - Add chapters and topics, rename them (their questions take the new name), change a number or delete while nothing
    has been sent for it (the number is part of each question's ID), and open or fix a chapter's topics. Each edit is
    checked at once and marked in the list (new, renamed, renumbered, to be deleted); nothing is saved until "Save
    changes" sends them all together, or none of them if the database refuses one. "Revert changes", or picking
    another board, class or subject, drops them. The latest changes, and who made them, are listed.
  - **Bulk add**, at the bottom: chapters for any number of subjects at once, written as Board, Class and Subject
    lines with one chapter per line under them ("4. Heat"; the number is optional) and lines starting with "-" for
    topics. Chapters already on the list are skipped, and topics under them are added to them. What it would add is
    shown marked New, every problem is named on its line, and "Save changes" saves all the subjects together, or none.
    Its "Copy chatbot prompt" asks a chatbot for chapters in that form.

**Around the site:**

- **Account menu:** a "Games team" group (Write questions, and Approve questions for HoDs and admins), only for people
  on the team. **Top bar:** a "Games" link before About, only for them.
- **The "Ask AI" button** is hidden on `/games`, as it already is on `/checker` and `/hod`: on a phone it covered the
  games pages' controls and the Chapters save bar.
- **Dropdowns** on the games pages are Shikshaq-styled, with search and keyboard support, instead of the browser's own.

**Who gets in:** only emails on the games team's own list, kept in its own `games` schema; being a Shikshaq admin or HOD
doesn't put anyone on it, and nothing in `games` reads Shikshaq's own tables. An email counts only when the session
proves it: a Google sign-in or an email sign-in link. **A password sign-in doesn't count** and gets a "Sign in with
Google" page instead: with "Confirm email" off, anyone can make a password account with someone else's email, and
Supabase later joins it to that person's Google account with the password still working (measured on Supabase's own
sign-in server). The check reads how the session signed in (`amr` in its token).

### After merging: the database (by hand, not part of the deploy)

`supabase/games/install.sql`, run once in the Supabase SQL editor, with a backup taken first. Its steps are written at
the top of the file: run it as it is (a dry run that must end "Dry run passed"), change `'yes'` to `'no'` on its DRY RUN
line and run it again, then add `games` to the exposed schemas (Settings, Data API). Until then nobody sees the games
link, and `/games` says it couldn't load.

What the script guarantees, checked inside it before it keeps anything:

- **One transaction**: all of it, or none of it.
- **Its first step is a plain `create schema games`**, so it stops if anything called `games` already exists.
- **Nothing outside `games` changes.** It compares schemas, tables, column permissions, functions (code, owner and
  permissions), triggers, policies, constraints, default permissions, extensions, event triggers and role settings
  before and after, and stops if anything differs.
- **Nobody reads or writes the tables directly.** Signed-out visitors can call nothing; signed-in people can call 17
  functions, each of which checks the team list itself.
- It puts in the **starting list**: 564 chapters (the site's 178 Mathematics chapters, and 386 more for classes 9 to
  12 drafted from each board's syllabus), and the moderator, the games team's first admin.

To remove all of it: `drop schema games cascade;`, then take `games` out of the exposed schemas.

---

## Reference

### New files

| File | What it is |
| --- | --- |
| `src/pages/Games.tsx` | The page: who you are (including the "sign in with Google" page), the links between the five parts, the "not for you" pages, and the real or dummy database (the same pattern as `pages/Hod.tsx`). A part stays mounted once opened, so text being written survives moving between parts. |
| `src/components/games/WriteQuestions.tsx` | Write questions: the detail boxes (Chapter becomes a dropdown from the list), topic buttons, the Questions box with underlined problems, the check table, sent-back questions, the preview, Send and its popup, the chapter chooser for the prompt. |
| `src/components/games/ApproveQuestions.tsx` | Approve questions: waiting, approved and sent-back tabs, batches, reasons, undo, approved questions a page at a time, the download (admins). |
| `src/components/games/TryGames.tsx`, `Revise.tsx`, `GameView.tsx`, `GamePreview.tsx` | Try the games (the bank loaded into `Revise`); `Revise` the game picker and player, full size or small for the preview; `GameView` the five games; `GamePreview` the preview on Write questions. |
| `src/components/games/Team.tsx` | Team: add, change and remove people. |
| `src/components/games/Chapters.tsx` | Chapters: the dropdowns, the chapters, topics and questions, edits marked until saved, the save bar, the latest changes. |
| `src/components/games/BulkAdd.tsx` | Bulk add, at the bottom of Chapters. |
| `src/components/games/Picker.tsx` | The games pages' dropdown, used instead of `<select>` everywhere on `/games`. |
| `src/components/games/Guide.tsx` | "How to write your questions": the format and what makes a good question, the same rules as the checker. |
| `src/components/games/shared.tsx`, `helpers.ts`, `games.css` | Shared pieces (the grouped table, loading, failure and empty states, the icon that turns into a check mark), plain helpers (button looks, dates, copying, Undo), and the only styles utility classes can't express (the underline layer, the puzzle grids), in Shikshaq's colour variables. |
| `src/components/games/CLAUDE.md` | Working notes for the `/games` site, followed only for changes there. |
| `src/lib/games/format.ts` | The strict checker: reads the Questions box into rows, every problem on the line to fix. |
| `src/lib/games/catalog.ts` | Checks the questions against the list of chapters and topics, the way the database will. |
| `src/lib/games/prompt.ts` | The chatbot prompts: one chapter's, the fix prompt, and Bulk add's. |
| `src/lib/games/list-draft.ts` | The Chapters page's unsaved changes (each edit checked as the database checks it), Bulk add's reader, and what a save sends. |
| `src/lib/games/details.ts` | Boards, classes, subjects and the question IDs. |
| `src/lib/games/rows.ts`, `api.ts` | The question row, its exports and the types; every database call as one `GamesApi`, through Shikshaq's own Supabase client and the `games` schema's functions. |
| `src/lib/games/engine/` | The five games (each with a maker and a separate checker; a puzzle is shown only after its checker passes it), and `answers.ts`, which marks typed answers. |
| `src/hooks/useGamesRoleBadge.ts` | The account menu's check: your games role, or none. Any failure means no link. |
| `src/dummy/games-fake-api.ts`, `GamesDummy.tsx` | Dummy mode (`?dummy=1`, test builds only): an in-memory database with the real one's rules and made-up questions, and its bar to switch roles. Compiled out of the live site. |
| `supabase/games/install.sql` | The whole `games` schema and the starting list (above). |
| Tests | `src/lib/games/database.test.ts` (the install script on an in-memory Postgres: the dry run, outside changes caught, who can call what, the sign-in rule, the starting list, sending, numbering, approving, the Chapters saves, Bulk add's several subjects at once), `format.test.ts`, `catalog.test.ts`, `prompt.test.ts` (the prompts agree with the checker and Bulk add), `list-draft.test.ts`, `engine/answers.test.ts`, `engine/engine.test.ts`, `engine/engine-stress.test.ts`, `src/dummy/games-fake-api.test.ts`. |

### Changed Shikshaq files

| File | Change | Why |
| --- | --- | --- |
| `src/App.tsx` | A lazy `Games` page and one route, `/games/*`; `RouteTransition` keys every `/games/...` address as one page. | One page for the five parts, so it isn't remounted when moving between them. |
| `src/lib/role-home.ts` | `Roles` gets an optional `gamesRole`; a "Games team" group with Write questions, and Approve questions for HoDs and admins. | The account menu's teams come from here. Where people land after signing in is unchanged. |
| `src/lib/role-home.test.ts` | Two tests. | The games links show only for the games team. |
| `src/components/layout/team-style.ts` | Icons for the two links and the games team's look. | Every team has its own look. |
| `src/components/layout/TopBar.tsx`, `src/components/Navbar.tsx` | Read `useGamesRoleBadge()` and pass it to `roleGroups`; TopBar also gets the "Games" link, only for the team (or in dummy mode). | The menus and the top bar show the games team's links. |
| `src/components/Chatbot.tsx` | `games` added to the work tools without the "Ask AI" button, with `checker` and `hod`. | On a phone it covered the games pages' controls and the save bar. |
| `src/lib/chromeless-routes.ts` | The five games addresses in `FOOTERLESS_ROUTES`. | Work screens without the footer, like `/hod`. |
| `src/lib/dummy-mode.ts` | Five entries in `DUMMY_PAGES`. | The test build's toolbar offers the games pages in dummy mode. |
| `package.json`, `package-lock.json` | `@electric-sql/pglite` as a dev dependency. | `database.test.ts` runs the install script on it. Tests only, so it never reaches the site. |
| `CLAUDE.md` | One row (step 3 above). | Whoever works on `/games` reads its notes first. |

### Checks run on this version

| Check | Result |
| --- | --- |
| `npx tsc -b`, `npx eslint .` | Clean; 0 lint errors, and the games files add no warnings. |
| `npm test` | All pass: 149 files, 2,319 tests, of which the games work adds 9 files and 234 tests. |
| Live-shaped build (`vite build` without `VITE_PREVIEW_TOOLS`) | Builds. No dummy code, made-up data or preview tools in it. The games pages are their own download (196 kB, 64 kB compressed), fetched only when `/games` opens. |
| `install.sql` on Supabase's own Postgres 17 (local) | As committed, a dry run that ends "Dry run passed: everything worked (with 564 chapters on the list)" and keeps nothing. The real run keeps 10 tables and 564 chapters; 17 functions callable when signed in, none when signed out. Through the API, as the site calls it: members and HoDs refused on the admin functions; a save of five changes kept whole; a save from a list that changed since refused; renumbering a chapter with a question refused; Bulk add's two subjects saved together, and refused whole when one of them was out of date. |
| Signed in for real (local Supabase, OAuth) | The Chapters page loads from the database; a topic with 25 questions shows 5, then 20 ("Showing 20 of 25"); a rename saves. Every games call returns 200. |
| Browser, dummy mode, 1280 px and 390 px | All five parts in every role (admin, HoD, member, not on the team, password sign-in) show the right page, with no sideways scrolling and no page errors. Chapters: open and close, scroll to close, edits marked, save, revert, Bulk add with its problems and preview, and its save waiting while the list above has unsaved changes. |
| Chatbots given only the copied prompts | For two chapters with open topics (ICSE 10 Mathematics "Quadratic Equations", History & Civics "Parliament"): 60 questions under 3 topics and 40 under 2, none turned away; a second run kept the topics in use and added one. The fix prompt, given a messy text with 9 questions, returned all of them passing in one reply, and renumbered topics rather than renaming them. |

`npm run build` (the full one) needs Shikshaq's live Supabase keys for its sitemap, so it wasn't run here.

### Checked against the live database (read-only report, 13 October 2026)

- The name `games` is free, and no default permissions or publications would reach into a new schema.
- The live sign-in server is the version the sign-in rule was measured on. Sessions: 658 OAuth (Google), 3 password,
  2 email link; "Confirm email" behaves as off, so the password rule matters.
- No role is in the token, and no auth hook exists: the games team's own list is the only thing that decides who is on
  it.
- The live database stops a signed-in request after 8 seconds; on Supabase's own Postgres with the same limits,
  sending 500 questions takes about half a second.

### Still to do

- **Check the 386 drafted chapters** (under their own comment near the end of `install.sql`) before it is run. Least
  sure: ICSE 9 Biology and History & Civics (the syllabus was trimmed), and ISC 11 Physics, Chemistry and Biology. After
  the install they can also be fixed on the Chapters page, until questions are sent for them.
- **Not drafted:** commerce, computer subjects, languages, ISC humanities, and classes below 9 apart from the site's
  ICSE Mathematics. They can be added later with Bulk add.
- **Dashboard settings to confirm:** "Confirm email" and "Allow manual linking" (keep it off), the redirect URLs, and
  the exposed schemas.
- **Run `install.sql` on the live database**, with a backup first.

### Try it locally

1. `npm install`, then a `.env.local` with `VITE_SUPABASE_URL=http://localhost:54321`,
   `VITE_SUPABASE_PUBLISHABLE_KEY=placeholder` and `VITE_PREVIEW_TOOLS=true` (the placeholders keep it away from the
   live database).
2. `npm run dev`, then open <http://localhost:8080/games?dummy=1>. The purple bar switches who you are.
3. Against a real database: run a local Supabase (`npx supabase start`), run `install.sql` on it, add `games` to
   `[api] schemas` in its `config.toml`, and point `.env.local` at it.
