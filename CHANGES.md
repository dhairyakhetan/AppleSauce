# Changes: the games team, inside Shikshaq

Use this when making the pull request into the Shikshaq repo. Everything here is relative to the first commit on this
branch, `4cd7b5b` (Shikshaq-main exactly as downloaded on 11 October 2026), so
`git diff 4cd7b5b..games` shows the same changes line by line (`feat/games-integration` is the same branch, kept in step).

**Not for the Shikshaq repo:** this file, and the "Read first: this copy is the games branch" section at the top of
`CLAUDE.md` (it is about this branch only). Leave both out of the PR.

---

## For the PR description

**Adds a games team to Shikshaq, at `/games`, visible only to the people on its list.**

The team writes short questions and answers for revision games. An HoD approves them, and students' puzzles
(crossword, word search, matching, fill in the blank) are made from the approved ones on the device, with no AI.
It is the question bank site (shikshaq-games.vercel.app) brought into the main site, rebuilt in Shikshaq's look.

- **Write questions** (`/games`). Teachers write `Question | Answer` lines under Board, Class, Subject, Chapter and
  Topic lines. Problems are underlined as they write. They check the rows (each linked to its chapter and topic by an
  ID), try a small playable game made from their questions, and send them for approval or download them. Questions an
  HoD sent back show at the top, with the reason, and "Fix it" puts one back in the box. "Copy chatbot prompt" copies
  the full instructions a chatbot needs to write questions in this format.
- **Approve questions** (`/games/approve`, HoDs and admins). Batches wait here. Approve or send back one question or a
  whole batch, with a reason the teacher sees. Every action can be undone for a few seconds. The approved tab is the
  question bank, and downloads as CSV or JSON.
- **Try the games** (`/games/play`). Pick a class, subject, chapter and topics, then play the puzzles students will
  get. Every puzzle is checked before it is shown.
- **Team** (`/games/team`, admins). Add someone by their Google email as member, HoD or admin, change roles, remove
  people. The owner can't be removed.
- **Account menu.** A "Games team" group with Write questions (and Approve questions for HoDs and admins), only for
  people on the team.

**Nothing in the database is touched by this PR.** It has no SQL. The pages use their own `games` schema, which isn't
installed yet. Until it is, nobody sees the games team's link, and `/games` says it couldn't load. Dummy mode
(`?dummy=1`, test builds only) runs all four parts against made-up data.

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
4. The purple bar at the top switches who you are (Admin, HoD, Member, Not on the team). "Start over" puts the
   made-up questions back. The test-build toolbar at the bottom left also has a button for each games page.

---

## New files

| File | What it is |
| --- | --- |
| `src/pages/Games.tsx` | The page: checks who you are, the links between the four parts, the "not for you" pages, and the real/dummy switch (the same pattern as `pages/Hod.tsx`). A part stays mounted once opened. |
| `src/components/games/WriteQuestions.tsx` | Write questions: the four detail boxes (kept in step with the text), the Questions box with underlined problems, the check panel, downloads, the sent-back panel, Send, the guide at the bottom, and the phone's "jump to results" button. |
| `src/components/games/GamePreview.tsx` | "3. See how it plays": a small, playable game made from the questions on screen, with a tab per game. A game these questions can't make is greyed out with what it needs. "Full size" opens it as students see it. |
| `src/components/games/ApproveQuestions.tsx` | Approve questions: waiting, approved and sent-back tabs, batches, the reason box, undo, older approved questions a page at a time, download of the bank. |
| `src/components/games/TryGames.tsx` | Try the games: class, subject, chapter and topic pickers, and the puzzle. |
| `src/components/games/Team.tsx` | Team: add, change and remove people. |
| `src/components/games/GameView.tsx` | The four games, playable (also in a compact size for the preview). |
| `src/components/games/Guide.tsx` | "How to write your questions", for people. The board and subject lists and the limits come from the code. |
| `src/components/games/shared.tsx` | Shared parts on screen: the table of rows grouped by chapter and topic, loading, failure and empty states, and the icon that turns into a check mark. |
| `src/components/games/helpers.ts` | Plain helpers: button looks, dates, saving and copying, "Undo" (Shikshaq's toasts), the games' names. |
| `src/components/games/games.css` | Only what utility classes can't do: the underline layer behind the Questions box and the puzzle grids. Uses Shikshaq's colour variables only, and loads with the games pages only. |
| `src/lib/games/rows.ts` | The question row, its CSV, JSON and Sheets exports, the bank's statuses, roles. |
| `src/lib/games/format.ts` | The formatter: reads the pasted text into rows, with every problem and its line. Unchanged from the games site. |
| `src/lib/games/details.ts` | Boards, classes, subjects, chapters, topics and the IDs. Unchanged from the games site. |
| `src/lib/games/prompt.ts` | What "Copy chatbot prompt" copies. |
| `src/lib/games/api.ts` | Every database call, as one `GamesApi` object. `realGamesApi` talks to the `games` schema through Shikshaq's own Supabase client. |
| `src/lib/games/engine/` | The games engine (`index`, `shared`, `crossword`, `wordsearch`, `matching`, `fill`). Each game has a maker and a separate checker, and a puzzle is only shown after its checker passes it. Unchanged from the games site, except one character (below). |
| `src/hooks/useGamesRoleBadge.ts` | The account menu's check: your role on the games team, or none. Cached for 30 minutes, no retries. Any failure means no link. |
| `src/dummy/games-fake-api.ts` | Dummy mode's made-up database. It keeps the real one's rules: repeats skipped, numbering within a topic, sent-back questions not taken back unchanged, who may do what. |
| `src/dummy/GamesDummy.tsx` | Dummy mode's wrapper and its purple bar. Reached only through the test-build-only lazy import, so it is compiled out of the live site. |
| Tests | `src/lib/games/format.test.ts` (the formatter), `src/lib/games/prompt.test.ts` (the chatbot prompt agrees with the code), `src/lib/games/engine/engine.test.ts` and `engine-stress.test.ts` (every checker catches broken puzzles; thousands of puzzles checked), `src/dummy/games-fake-api.test.ts` (the dummy database keeps the rules). |

## Changed Shikshaq files

| File | Change | Why |
| --- | --- | --- |
| `src/App.tsx` | A lazy `Games` page and one route, `/games/*`. `RouteTransition` keys every `/games/...` address as one page. | One route keeps the page (and the text being written) when moving between its parts; without the key change Shikshaq remounted the page on every address change. |
| `src/lib/role-home.ts` | `Roles` gets an optional `gamesRole`. A `games` team ("Games team") with two links: Write questions, and Approve questions for HoDs and admins. | The account menu's teams come from here. Where people land after signing in (`homeFor`) is unchanged. |
| `src/components/layout/team-style.ts` | Icons for the two links, and the games team's look (near-black chip). | Every team has its own look; the existing test checks they differ. |
| `src/components/layout/TopBar.tsx`, `src/components/Navbar.tsx` | Two lines each: read `useGamesRoleBadge()` and pass it to `roleGroups`. | The desktop and phone menus show the games team's links. |
| `src/lib/dummy-mode.ts` | Four entries in `DUMMY_PAGES`. | The test-build toolbar offers the games pages in dummy mode. |
| `src/lib/chromeless-routes.ts` | The four games addresses added to `FOOTERLESS_ROUTES`. | Work screens without the footer, like `/hod` and `/checker`. |
| `src/lib/role-home.test.ts` | Two more tests. | The games links show only for the games team, and resolve to the games route. |
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
- **New**: the game preview ("3. See how it plays").
- **Who gets in**: only emails on the team's list. On the games site anyone signed in with Google was a member.
- **Chatbot instructions**: no longer hidden in the page (on shikshaq.in that would be hidden text on every page). All
  of it now travels in the copied prompt. The board and subject lists in it come from the code.
- **The database layer**: `db.ts` split into `rows.ts` (no database) and `api.ts` (the calls). The calls use Shikshaq's
  Supabase client and the `games` schema instead of the games site's own Supabase project.
- **One character in the engine**: `[\s\-]` became `[\s-]` in `engine/shared.ts`. It behaves the same, and Shikshaq's
  lint treats the escape as an error.

## Database

- No SQL in this PR, and no change to any existing table, function or setting.
- The `games` schema (tables, functions, and who may call them) is the next step. It will be one script, plus one
  setting (expose `games` in the API settings). It reads nothing of Shikshaq's own tables.
- Until it is installed, two things happen:
  - The account menu asks `games.my_role()` once per signed-in visit (cached 30 minutes, no retries). The request
    fails quietly and no link shows.
  - Someone who types `/games` sees "Your access to the games team did not load".

## Checks run on this branch

| Check | Result |
| --- | --- |
| `npx tsc -b` | Clean. The new files were also checked with `strict` on: clean. |
| `npx eslint .` | 0 errors, 212 warnings. That is the same 212 as before this change: none are new. |
| `npm test` | 145 files, 2,165 tests, all pass (140 files and 2,085 tests before; the new ones are listed above). |
| Live-shaped build (`vite build` without `VITE_PREVIEW_TOOLS`) | Builds. No dummy code or made-up data in it. The games pages are a separate download (137 kB script, 4 kB styles), fetched only when `/games` opens. |
| Browser, dummy mode, desktop (1280 px) and phone (390 px) | All four parts work. The example loads; problems are underlined; the preview plays every game. "Copy chatbot prompt" copies the instructions. "Fix it" loads a sent-back question; Send makes a batch; Approve all works, with Undo. Try the games plays the approved questions; Team lists people. Text survives moving between parts. Each role sees only its parts; someone off the team gets the "for the games team" page. No sideways scrolling on a phone, and no page errors. |

`npm run build` (the full one) needs Shikshaq's live Supabase keys for its sitemap step, as before, so it was not run
here.

## Still to do

- The `games` schema install script, with its tests on a throwaway Postgres, and the steps for Kanish. It needs a
  backup first, then one script that changes nothing outside `games` (it checks itself), then the API setting.
- The lists of boards, classes, chapters and topics Kanish is sending. Chapters and topics will become their own tables
  inside `games`.
- Check whether "Confirm email" is on in Shikshaq's Supabase sign-in settings. The games team asks for a Google sign-in
  either way.
