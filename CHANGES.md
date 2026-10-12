# Changes: the games team, inside Shikshaq

Use this when making the pull request into the Shikshaq repo. Everything here is relative to the first commit on this
branch, `4cd7b5b` (Shikshaq-main exactly as downloaded on 11 October 2026), so `git diff 4cd7b5b..games` shows the
same changes line by line. All work is on `games`; `feat/games-integration` is an older copy and is no longer updated.

**Not for the Shikshaq repo:** this file, and the "Read first: this copy is the games branch" section at the top of
`CLAUDE.md` (it is about this branch only). Leave both out of the PR.

---

## For the PR description

**Adds a games team to Shikshaq, at `/games`, visible only to the people on its list.**

The team writes short questions and answers for revision games. An HoD approves them, and students' puzzles
(crossword, word search, matching, fill in the blank, multiple choice) are made from the approved ones on the device,
with no AI. It is the question bank site (shikshaq-games.vercel.app) brought into the main site, rebuilt in Shikshaq's
look.

- **Write questions** (`/games`). Teachers write `Question | Answer` lines under Board, Class, Subject, Chapter and
  Topic lines. Problems are underlined as they write. Questions can only be written for a chapter and topic on the
  team's fixed list. Once board, class and subject are filled in, the Chapter box becomes a picker of the listed
  chapters, and the chapter's topics become buttons that add their Topic line. They check the rows, play a small
  version of Try the games made from their questions, and send them for approval. Questions an HoD sent back show at
  the top, with the reason, and "Fix it" puts one back in the box. "Copy chatbot prompt" copies a short prompt made for
  one chapter: that chapter's lines and its topics, and nothing about the site, sending or any other chapter (everyone
  on the team copies the same prompt). It uses the chapter in the boxes; when there isn't one of the teacher's own (or
  the example is loaded), it first asks which chapter, from the list.
- **Approve questions** (`/games/approve`, HoDs and admins). Batches wait here. Approve or send back one question or a
  whole batch, with a reason the teacher sees. Every action can be undone for a few seconds. Admins can also download
  the approved questions as CSV or JSON.
- **Only what each role needs.** No IDs, codes, column lists or explanatory paragraphs on any page; members see Write
  questions and Try the games, HoDs also Approve questions, admins also Team, and anyone else a one-line page.
- **Try the games** (`/games/play`). Pick a class, subject and chapter; every topic is in by default, and tapping one
  leaves it out. Then play the puzzles students will get. Every puzzle is checked before it is shown.
- **Multiple choice.** A question can carry up to 5 wrong options after its answer (`Question | Answer | Wrong; Wrong;
  Wrong`), kept in a new `wrong_options` column. A question without them still plays as multiple choice, with other
  answers from the round as its options. True/false questions play only as multiple choice.
- **Typed answers are checked the way a teacher would** (fill in the blank), for every subject: case, spaces and
  punctuation don't matter; words in `[brackets]` are optional (`Decomposition [reaction]`); a short form in round
  brackets after the answer counts (`Central Processing Unit (CPU)`); words the question already says, "a/the" and
  titles (Lord, Dr, Mahatma...) can be left out; numbers count by value (`1/2` and `0.5`, `eight` and `8`); a small spelling slip
  gets half a point and is shown in amber with the right spelling. A wrong answer turns into the right one in place,
  without a jump.
- **Team** (`/games/team`, admins). Add someone by their Google email as member, HoD or admin, change roles, remove
  people. The moderator can't be removed or demoted.
- **Account menu.** A "Games team" group with Write questions (and Approve questions for HoDs and admins), only for
  people on the team.
- **Top bar.** A "Games" link before About, in the same style as the others, only for people on the team (and in a
  test build's dummy mode).

**The database part is two scripts, run by hand, not part of the deploy** (`supabase/games/install.sql` and
`supabase/games/list.sql`). Everything goes in a new `games` schema. Nothing that already exists is changed, and the
install script checks that itself. Until the scripts are run, nobody sees the games team's link, and `/games` says it
couldn't load. Dummy mode (`?dummy=1`, test builds only) runs all four parts against made-up data.

---

## Setting up the database (for Kanish)

Run these in the Supabase dashboard's SQL editor. Neither script touches anything outside the `games` schema.

**Before anything: take a backup** (Database, then Backups, or `pg_dump`). The live database has no backup history.

### 1. Install the `games` schema: `supabase/games/install.sql`

1. The **MODERATOR** line near the top already has `dhairyaplayz97@gmail.com`: the games team's first admin, whom
   nobody can remove or demote. Nothing to change there.
2. Paste the whole file into the SQL editor and run it. This is a **dry run**: it builds everything, checks it, then
   undoes it. It must end with an error that starts **"Dry run passed"**. Nothing is kept.
   - If it says anything else, stop and send me the message. Nothing was kept.
3. On the **DRY RUN** line, change `'yes'` to `'no'`. Run the whole file again. This time it is kept.
4. **Settings, then Data API** (API settings): add `games` to **Exposed schemas**, and save.

What the script guarantees, all checked inside it before it keeps anything:

- **One transaction.** All of it happens, or none of it.
- **Its first step is a plain `create schema games`.** If anything called `games` already exists, it stops there.
- **It compares everything outside `games` before and after**: schemas, tables, column permissions, functions (their
  code, owner and permissions), triggers, policies, constraints, default permissions, extensions, event triggers, and
  role settings. If anything differs, it stops and nothing is kept.
- **Nobody can read or write the tables directly.** Signed-out visitors can call nothing. Signed-in people can call
  exactly 14 functions, and each one checks the team list itself. It refuses to finish if either is not true.

To remove all of it later: `drop schema games cascade;` (then take `games` out of the exposed schemas).

### 2. Load the list of chapters and topics: `supabase/games/list.sql`

Questions can only be sent for a chapter and topic on this list. The list starts empty, so nothing can be sent until
this is run.

1. Paste the list between the two `$list$` lines in the file. You can copy it straight from a spreadsheet (columns
   separated by tabs) or write it by hand (separated by `|`). There is one row per topic, with these columns: board,
   class, subject, chapter number, chapter, topic number, topic. A chapter with no topics is one row with the topic
   columns empty. A header row is fine.
2. Run the whole file. This is a dry run too. It ends with **"Dry run passed: the list has N chapters and M topics, of
   which ... are new"**. If a row has a problem it names the row (numbered as in the sheet) and why, and keeps nothing.
3. Change `'yes'` to `'no'` on its DRY RUN line and run it again.

It only adds. If a chapter or topic is already on the list under a different name, it stops, because questions keep
the names they were sent with. Running it again with more rows adds only the new ones. Board and subject names must be
on the site's lists. Those are the boards and subjects the install script adds, the same ones the site's formatter
knows.

### 3. Add the team

Sign in to the site with the moderator's Google account, open `/games/team`, and add people by their Google email.

---

## How sign-in works for the games team (measured, not assumed)

Shikshaq's sign-in is Supabase Auth (Google, plus email). The games team trusts an email only when the session
**proves** it: a Google sign-in, or an email sign-in link. **A password sign-in doesn't count.** Instead it gets a page
saying "Sign in with Google to open the games team", with a button that signs out and goes to Shikshaq's sign-in page.

Why, measured on Supabase's own sign-in server (GoTrue v2.197, run locally with a stand-in Google):

- With **"Confirm email" off**, anyone can sign up with a password using someone else's email.
- When the real owner of that email later signs in with Google, Supabase **joins the two into one account**. The
  stranger's password still works on it.
- So "this account has Google linked" proves nothing. What counts is **how this session signed in**. That is the
  `amr` claim in the session's token (`oauth`, `otp` for an email link, or `password`). It keeps its value when the
  token is refreshed.
- `user_metadata.email_verified` is `true` even for an account that was never verified, so it isn't used.

This is in `games.proven_email()`. The providers that count are in `games.settings.sign_in_providers`, which is
`{google}` by default. It works the same whether "Confirm email" is on or off, so that setting no longer matters for
the games team.

---

## Try it locally

1. `npm install`
2. Make a file `.env.local` at the root (it is ignored by git) with:

   ```
   VITE_SUPABASE_URL=http://localhost:54321
   VITE_SUPABASE_PUBLISHABLE_KEY=placeholder
   VITE_PREVIEW_TOOLS=true
   ```

   The placeholders keep your local site away from the live database. The rest of Shikshaq will show no data; the games
   pages in dummy mode work fully. (`VITE_PREVIEW_TOOLS=true` is what turns dummy mode on. It never reaches the live
   site.)
3. `npm run dev`, then open <http://localhost:8080/games?dummy=1>.
4. The purple bar at the top switches who you are (Admin, HoD, Member, Not on the team, Signed in with a password).
   "Start over" puts the made-up questions back. The test-build toolbar at the bottom left also has a button for each
   games page.

To try it against a real database instead, run a local Supabase (`npx supabase start`), run the two scripts on it,
add `games` to `[api] schemas` in its `config.toml`, and point `.env.local` at it.

---

## New files

| File | What it is |
| --- | --- |
| `supabase/games/install.sql` | The whole `games` schema in one transaction, with the dry run, the moderator line and the outside-change check (above). Tables: settings, team, boards, subjects, chapters, topics, batches, questions, question_bank. The site calls functions only. |
| `supabase/games/list.sql` | Loads the fixed list of chapters and topics from pasted rows, with a dry run. It only adds. |
| `src/pages/Games.tsx` | The page: checks who you are (including the "sign in with Google" page for a password sign-in), loads the list of chapters, the links between the four parts, the "not for you" pages, and the real/dummy switch (the same pattern as `pages/Hod.tsx`). A part stays mounted once opened. |
| `src/components/games/WriteQuestions.tsx` | Write questions: the four detail boxes (kept in step with the text; Chapter becomes a picker from the list), topic buttons, the Questions box with underlined problems, the check panel, the sent-back panel, the preview, Send, the guide, and the phone's "jump to results" button. |
| `src/components/games/Revise.tsx` | The game picker and player: class, subject, chapter, topics (all in by default; tap one to leave it out) and a tab per game. Try the games uses it full size; the preview uses a small version. |
| `src/components/games/GamePreview.tsx` | "3. See how it plays": the small `Revise` made from the questions on screen. A game these questions can't make is greyed out with what it needs. "Full size" opens the full one. |
| `src/components/games/ApproveQuestions.tsx` | Approve questions: waiting, approved and sent-back tabs, batches, the reason box, undo, older approved questions a page at a time, download of the bank (admins). |
| `src/components/games/TryGames.tsx` | Try the games: loads the bank into `Revise`. |
| `src/components/games/Team.tsx` | Team: add, change and remove people. |
| `src/components/games/GameView.tsx` | The five games, playable (also in a compact size for the preview). |
| `src/components/games/Guide.tsx` | "How to write your questions", for people: the format and what makes a good question. The limits come from the code. |
| `src/components/games/shared.tsx` | Shared parts on screen: the table of rows grouped by chapter and topic, loading, failure and empty states, and the icon that turns into a check mark. |
| `src/components/games/helpers.ts` | Plain helpers: button looks, dates, saving and copying, "Undo" (Shikshaq's toasts), the games' names. |
| `src/components/games/games.css` | Only what utility classes can't do: the underline layer behind the Questions box and the puzzle grids. Uses Shikshaq's colour variables only, and loads with the games pages only. |
| `src/lib/games/rows.ts` | The question row, its CSV, JSON and Sheets exports, the bank's statuses, roles, and the list's chapter and topic types. |
| `src/lib/games/format.ts` | The formatter: reads the pasted text into rows, with every problem and its line. As on the games site, plus wrong options for multiple choice. |
| `src/lib/games/details.ts` | Boards, classes, subjects, chapters, topics and the IDs. Unchanged from the games site. |
| `src/lib/games/catalog.ts` | Checks the Questions box against the list of chapters and topics, on the line to fix, the way the database will. |
| `src/lib/games/prompt.ts` | What "Copy chatbot prompt" copies: the instructions for one chapter on the list, with its lines and topics. |
| `src/lib/games/api.ts` | Every database call, as one `GamesApi` object. `realGamesApi` calls the `games` schema's functions through Shikshaq's own Supabase client. |
| `src/lib/games/engine/` | The games engine (`index`, `shared`, `crossword`, `wordsearch`, `matching`, `fill`, `choice`), and `answers.ts`, which decides whether a typed answer is right, half right (a spelling slip) or wrong. Each game has a maker and a separate checker, and a puzzle is only shown after its checker passes it. |
| `src/hooks/useGamesRoleBadge.ts` | The account menu's check: your role on the games team, or none. Cached for 30 minutes, no retries. Any failure means no link. |
| `src/dummy/games-fake-api.ts` | Dummy mode's made-up database. It keeps the real one's rules: the list, repeats skipped, numbering within a topic, sent-back questions not taken back unchanged, who may do what, the password case. |
| `src/dummy/GamesDummy.tsx` | Dummy mode's wrapper and its purple bar. Reached only through the test-build-only lazy import, so it is compiled out of the live site. |
| Tests | `src/lib/games/database.test.ts` (both SQL scripts on an in-memory Postgres: the dry run, the moderator line, every kind of outside change caught, who can call what, the sign-in rule, the list, sending, numbering, approving, the bank, paging; 31 tests), `src/lib/games/catalog.test.ts` (the list check), `src/lib/games/format.test.ts` (the formatter), `src/lib/games/prompt.test.ts` (the chatbot prompt agrees with the code), `src/lib/games/engine/engine.test.ts` and `engine-stress.test.ts` (every checker catches broken puzzles; thousands of puzzles checked), `src/dummy/games-fake-api.test.ts` (the dummy database keeps the rules). |

## Changed Shikshaq files

| File | Change | Why |
| --- | --- | --- |
| `src/App.tsx` | A lazy `Games` page and one route, `/games/*`. `RouteTransition` keys every `/games/...` address as one page. | One route keeps the page (and the text being written) when moving between its parts; without the key change Shikshaq remounted the page on every address change. |
| `src/lib/role-home.ts` | `Roles` gets an optional `gamesRole`. A `games` team ("Games team") with two links: Write questions, and Approve questions for HoDs and admins. | The account menu's teams come from here. Where people land after signing in (`homeFor`) is unchanged. |
| `src/components/layout/team-style.ts` | Icons for the two links, and the games team's look (near-black chip). | Every team has its own look; the existing test checks they differ. |
| `src/components/layout/TopBar.tsx`, `src/components/Navbar.tsx` | Two lines each: read `useGamesRoleBadge()` and pass it to `roleGroups`. TopBar also gets a "Games" link before About, shown only when that role is set (or in dummy mode). | The desktop and phone menus show the games team's links; the desktop bar has the games pages one click away. |
| `src/lib/dummy-mode.ts` | Four entries in `DUMMY_PAGES`. | The test-build toolbar offers the games pages in dummy mode. |
| `src/lib/chromeless-routes.ts` | The four games addresses added to `FOOTERLESS_ROUTES`. | Work screens without the footer, like `/hod` and `/checker`. |
| `src/lib/role-home.test.ts` | Two more tests. | The games links show only for the games team, and resolve to the games route. |
| `package.json`, `package-lock.json` | `@electric-sql/pglite` as a dev dependency. | `database.test.ts` runs the SQL scripts on it: a real Postgres in memory, no server, no network. Tests only, so it never reaches the site. |
| `CLAUDE.md` | A "The games team (`/games`)" section. (The branch note at the top is not for the PR.) | So the next person knows where things are. |

## What changed in the games code on the way in

- **Screens rebuilt in Shikshaq's look**: its page panels, colours, buttons, tabs and toasts. They follow its motion
  rules: no shake when something is wrong, a colour change instead.
- **Dropped, because Shikshaq has its own**: the sign-in screen, the profile page (avatar and bio), and the games
  site's own page switching.
- **Moved**:
  - The notifications bell is now a panel at the top of Write questions.
  - "HoD desk" is now Approve questions. Shikshaq's papers team already has an "HOD desk".
  - "Revise" is now Try the games.
  - "People and roles" is now Team.
- **New**:
  - The preview ("3. See how it plays"): a small version of Try the games, made from the questions being written.
  - The fixed list of chapters and topics, with the chapter picker and topic buttons.
  - The password sign-in rule.
  - Multiple choice (a fifth game and the `wrong_options` column) and the answer checking described above. On the
    games site a typed answer had to match letter for letter.
- **Who gets in**: only emails on the team's list, from a Google or email-link sign-in. On the games site anyone signed
  in with Google was a member.
- **Chatbot instructions**: no longer hidden in the page (on shikshaq.in that would be hidden text on every page). All
  of it now travels in the copied prompt, which is made for one chapter: about 3,800 characters instead of the games
  site's 14,800, with no lists of boards and subjects and no guessing which chapter or textbook is meant. It also asks
  for some multiple-choice questions, and explains optional words and short forms.
- **The database layer**: `db.ts` split into `rows.ts` (no database) and `api.ts` (the calls). The calls use Shikshaq's
  Supabase client and the `games` schema's functions instead of the games site's own Supabase project and its tables.
- **Lint**: `[\s\-]` became `[\s-]` in `engine/shared.ts`. It behaves the same, and Shikshaq's lint treats the escape
  as an error.

## Checks run on this branch

| Check | Result |
| --- | --- |
| `npx tsc -b` | Clean. The games files were also checked with `strict` and unused-code checks on: clean. |
| `npx eslint .` | 0 errors, 212 warnings, the same 212 as before this change. The games files have none. |
| `npm test` | 147 files, 2,206 tests, all pass (140 files and 2,085 tests before). |
| Both SQL scripts on Supabase's own Postgres 17 (local) | Install: as committed it is a dry run that ends "Dry run passed" and leaves nothing; the real run makes 9 tables and 20 functions; running it again stops at `create schema games`. A sneaked-in change outside `games` (a function, a grant, a policy, a default permission, a role setting) is caught and nothing is kept. List: the dry run counts, the real run adds, and problems are named by row. |
| Real network calls, local Supabase, real OAuth sign-in | The site's calls go to `/rest/v1/rpc/<function>` with the `games` profile, and return 200. A member wrote questions with the chapter picker and a topic button. An off-list topic was underlined and held back. One question was sent as batch `B20261012-01`. The HoD approved it, and Try the games played it from the bank. A password session got `reauth` from `games.my_role()` and the "Sign in with Google" page. Signed out: refused. Tables can't be read directly. |
| Live-shaped build (`vite build` without `VITE_PREVIEW_TOOLS`) | Builds. No dummy code, made-up data or preview tools in it. The games pages are a separate download (142 kB script, 4 kB styles), fetched only when `/games` opens. |
| Browser, dummy mode, desktop (1280 px) and phone (390 px) | All four parts and every role work, including the password case. No sideways scrolling on a phone, and no page errors. |

`npm run build` (the full one) needs Shikshaq's live Supabase keys for its sitemap step, as before, so it was not run
here.

## Still to do

- **The list itself.** Kanish is sending the boards, classes, chapters and topics. It goes in through `list.sql`
  (above). Until then nothing can be sent.
- **Run the two scripts on the live database**, with a backup first (above).
