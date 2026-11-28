# The /games site: working notes

> **ONLY FOLLOW THIS FILE FOR CHANGES IN THE /GAMES SITE, AND NOTHING ELSE.** It covers the games team's pages and
> everything behind them: `src/components/games/`, `src/lib/games/`, `src/pages/Games.tsx`, `src/hooks/useGamesRoleBadge.ts`,
> `src/dummy/games-*` and `GamesDummy.tsx`, and `supabase/games/`. Everything else about Shikshaq (the checks, the
> design rules, the security model) is in the root `CLAUDE.md`, which applies here too.

## The live database

The `games` schema goes into Shikshaq's live database, which cannot be restored: there is no backup history to go back
to, so anything changed there stays changed.

- Everything that already exists is read-only: no insert, update or delete on its tables, and no drop, alter, rename or
  truncate. No `create or replace` of a function that already exists, and no new trigger, policy, grant, index or
  foreign key on an existing table (a foreign key adds hidden triggers to the table it points at).
- Everything new goes in the `games` schema, made with plain `create` the first time (not `or replace`, not
  `if not exists`), so a name that is already taken stops the whole script instead of changing what is there. Removing
  all of it is then one `drop schema games cascade`.
- Never run SQL that writes on the live database yourself. Give it to the user, rehearsed first inside a transaction
  that raises at the end, with a backup taken before it is run.

## The games team (`/games`)

A staff team like the papers and teachers teams, for the revision games: people
on it write short questions and answers, HoDs approve them, and the games
(crossword, word search, matching, fill in the blank, multiple choice) are made from the approved
ones on the device, with no AI. Brought in from the games site (`main` of
`dhairyakhetan/AppleSauce`, shikshaq-games.vercel.app).

- **One route, five parts:** `/games` Write questions (everyone on the team),
  `/games/approve` Approve questions (HoDs, admins), `/games/play` Try the games
  (everyone on the team), `/games/team` Team (admins), `/games/chapters`
  Chapters (admins). `pages/Games.tsx` picks
  the part; `RouteTransition` in `App.tsx` keeps `/games/*` mounted, so the text
  being written survives moving between parts. Footerless, like `/hod`, and
  without the "Ask AI" button (`Chatbot.tsx` treats `/games` as a work tool).
- **Who gets in:** only emails on the games team's own list, in its own
  `games` schema. Being a Shikshaq admin, HOD or checker doesn't put anyone on
  it, and nothing reads Shikshaq's own tables. The account menu's "Games team"
  links come from `useGamesRoleBadge` (`games.my_role()`); any failure means no
  link, which is also what happens until the schema is installed.
- **The database:** `supabase/games/install.sql` makes the whole `games`
  schema in one transaction (a dry run by default; it stops if anything outside
  `games` would change), and puts in the starting list of chapters (rows
  near its end, through `games.list_add_chapters`, the checks the site's add
  uses: 564, the site's Mathematics chapters and others drafted from the
  syllabus for classes 9 to 12, still to be checked). From then on the list is
  kept on the site, on Chapters (`/games/chapters`, admins:
  `components/games/Chapters.tsx`): one board, class and subject at a time,
  edits kept and marked on the page (`lib/games/list-draft.ts`) until "Save
  changes" sends them all at once to `games.admin_save_chapters`, which checks
  them again and refuses a save from a list that changed since it was loaded.
  Bulk add, at the bottom (`components/games/BulkAdd.tsx`, `readBulk`), takes
  Board, Class and Subject lines with chapters under them, for any number of
  subjects, and saves them all in one call (a list of saves, all or none).
  Its red button switches it to Bulk remove (`readBulkRemove`): the same lines, then the chapters to delete by number,
  name or both, or a subject with no chapters under it to delete all of them; chapters with questions are kept (the
  database's rule), anything not on the list is a problem on its line, and the red bar asks twice. In both modes a
  Board line starts afresh and a Class line forgets the subject once the block above has had chapters, so nothing goes
  to a subject left over from it (Bulk add takes the three lines in any order before a block's first chapter; Bulk
  remove wants Subject after Board and Class). A kept chapter named twice is listed once. In Bulk remove, a block with
  no chapter lines removes every chapter of its subject, even if another block names some; a failed delete asks twice again. Bulk remove has its own
  text (a list written to add is never read as one to delete), and any change to the text or the list disarms its
  second press. The Chapter dropdown's approved counts load again after each send.
  Until it is installed on the live database, every call in
  `lib/games/api.ts` (`realGamesApi`) fails and the pages say so. The site calls functions only; no role can read the tables.
  `lib/games/database.test.ts` runs the script on PGlite.
- **Sign-in rule:** an email counts only if the session signed in with Google
  (or another provider in `games.settings`) or an email link, read from the
  token's `amr`. A password sign-in gets `'reauth'` from `games.my_role()` and
  a "sign in with Google" page: with "Confirm email" off, a password account
  can be made with someone else's email and later merges with their Google
  account (measured on a local GoTrue).
- **The fixed list:** questions can only be sent for a chapter on
  `games.chapters`, under the list's name. Topics: where the list gives a
  chapter topics (`games.topics.from_list`), only those; where it gives none
  the chapter is open, and the first question sent under a new topic adds it
  (one number and one name per topic). `lib/games/catalog.ts` checks the
  Questions box against it as people write (the database refuses the rest
  anyway); Board, Class, Subject and Chapter are dropdowns of what is on
  the list (typing boxes only if the list can't load; classes highest first, here and on every games page), each waiting for the one before (greyed out, "Select Board first" on hover),
  the Chapter dropdown showing how many approved questions each chapter has; the topics become buttons.
- **Dummy mode:** `?dummy=1` on any `/games` page, or the preview toggle's
  "Games team" buttons, runs the real pages against
  `dummy/games-fake-api.ts`, which keeps the database's rules (list included). Its list of chapters is exactly
  `dummy/games-sample-chapters.json` (the games list as of 25 November 2026, about 1,300 chapters, CBSE's Classes 9 to 12
  electives and skill subjects less the rarest removed on 25 November 2026), so the Board dropdown's counts are the real
  list's. The made-up questions and their topics sit on real chapters of it (`HOMES` in `games-fake-api.ts`: for example
  the made-up Heat is the list's Heat Transfer in Nature), and their header lines are rewritten to match (`MOVED`).
  It starts with something for every part: approved questions the games play with; waiting batches, one of them
  (Meera Iyer's ISC Class 12 Physics, `WAITING_PHYSICS`) mostly fine but with one of each "Please check" note, so
  Approve all asks first and the flagged box has work; and questions sent back to you, two on their own and three sent
  back together with one reason (`SENT_BACK_REACTIONS`), which Write questions shows as one batch.
  The tests start with the made-up chapters only (`createFakeGamesApi(false, false)`).
  Dummy mode is in its own chunk loaded only in the test build, so none of this reaches the live site.
  Its banner switches between admin, HoD, member, not on the team, and signed
  in with a password.
- **Files:** `lib/games/` (rows and exports, `format.ts` the formatter,
  `details.ts` boards, subjects and IDs, `catalog.ts` the list check,
  `prompt.ts` what "Copy chatbot prompt" copies (and the Chapters page's
  Bulk add prompt), `engine/` the games: each has a
  maker and a separate checker, and a puzzle is only shown after its checker
  passes it; `answers.ts` marks typed answers), `components/games/` (the five parts, `Picker.tsx` the dropdown every games page uses instead of `<select>`, `Revise.tsx` the game
  picker and player used full size by Try the games and small by the preview,
  the guide; `games.css` is only what utility classes can't say, in Shikshaq's
  colour variables).
- **The format is one block per question** (`Q:`, `A:`, `Also:`, `Fill:`,
  `Wrong:`, `Level:`), and `lib/games/format.ts` checks it strictly: every
  problem is on the line to fix and says what to change, and a question with
  any problem (red or amber) isn't sent. Send then offers "Remove those and
  send" or "Copy prompt to fix them" (`fixPrompt` in `prompt.ts`).
- **What the page can't be sure of goes to the HoD** (`doubts` in `format.ts`): an answer that may be two
  answers ("Kolkata or Calcutta"), "in the map" or "from the table", a full stop on only some of the answer and
  options, a wrong option that contains the answer (only for answers made of words: a formula option such as "kq/r^2"
  holding "kq/r" is plainly wrong, and "dV/dr" isn't two answers), an answer that repeats a word next to the ___ so it
  doesn't fit the gap (`fillGap`: the word before the ___ is the answer's first word, or the word after it is in the
  answer), an answer much longer than every wrong option, an answer and options that write × and x (or ² and ^)
  differently, a True/False statement with "always", "never" or "only", and two questions in one topic with the same
  answer (`doubts(r, others)`, with the batch or the Questions box as `others`). These don't stop a question: Write questions shows "Sent with
  a note for the HoD", and Approve questions works out the same notes from the question and shows "Please check".
  Each note says, in plain words, what it found (quoting the answer or option), why it matters and what to do ("The
  answer "-1.6 × 10^-19" writes the times sign as "×", but the wrong option "-1.6 x 10^-20" writes it as "x". In multiple
  choice the odd one out is easy to guess, so write it the same way in all of them."); a question with two or more
  notes shows them as a numbered list (`RowsTable` in `shared.tsx`).
  Nothing is stored, so it needs no database change. Clear mistakes stay errors. On Approve questions a cross clears a
  question's notes until the page is opened again (`cleared`, in memory only); "Approve all" on a batch with flagged
  questions asks first (View them, Approve all anyway); the flagged box shows only those, with Clear all and Send all
  back (one typed reason), then what was done, with Approve all the rest and Undo. The asking and the flagged box are
  one popup whose steps change in place (`Morph` in `shared.tsx`: the box eases to its new size and the new step rises
  in), so nothing closes and opens again in between. Each batch has Copy batch (its
  questions as text, any size: a browser can't put a file on the clipboard).
- **Try the games** (`TryGames.tsx`, `Revise.tsx` full size): the same Board, Class, Subject and Chapter dropdowns as Write
  questions (`Picker`), listing only chapters with enough approved questions for at least one game (`playable`), highest
  class first and opening there. With none, it plays the page's own example (its good questions) and says "(demo mode)"
  (`demoQuestions`); dummy mode's banner has "No approved questions" to see it. How the games play (`GameView.tsx`): in
  the crossword and fill in the blank nothing is marked while answers are being typed; once every square or gap is
  filled they are all checked at once (the crossword says how many letters are wrong and checks again as they are
  changed; fill in the blank's Check answers, or Enter on the last gap). Enter goes to the next clue or gap not yet
  answered (Shift+Enter back, in the crossword), and finishing a crossword word goes on to the next one. The clue being
  answered is a light line just above the grid. In the word search a rounded highlight follows the finger between
  letters along the nearest of the eight directions, settles on whole letters on letting go, stays round each word found
  in its colour, and fades out red on a miss. Matching and multiple choice still answer at once (a tap is the answer).
  The crossword's clue line is `w-0 min-w-full` (as wide as the grid, never widening its column) and two lines tall at
  least, so the clue list and the grid don't move as the clue changes. Multiple choice shows each question as its own
  card ("3 of 10") with lettered options (A, B, C…) on cards of their own. Matching shows two headed columns, Questions numbered
  1, 2… and Answers lettered A, B…; either side can be picked first, the other side then waits (dashed edges); a
  matched pair takes one colour on both sides (any but the bright blue of a picked card, `PAIR_COLOURS`) and each shows
  its partner's label ("→ G", "← 1"); a wrong pair flashes red with a small shake.
  The layout pass (unslop, 27 November 2026): the crossword and word search grids size their squares to the card's
  width (`.games-fit`, a container in `games.css`, and `100cqw` in `--cell`), so on a phone they fit inside the card
  instead of running off it; the crossword's clue numbers are at least 9px. The four dropdowns sit two a row on a
  phone (Subject and Chapter full width) and four a row from `sm`. The five game tabs are one row that scrolls sideways
  on a narrow screen, with New puzzle beside it. Each game's instruction is one short sentence or two. An empty Fill
  gap is a grey box that turns white with a blue edge when typed in. `play.e2e.ts` checks the fit and the one row at
  390px.
- **Nothing is guessed from a question.** Each game uses only what was written
  for it: `Also` lines are the only other answers that count, `Fill` is the
  only fill-in sentence, `Wrong` the only multiple-choice options
  (`engine/index.ts` `usableIn`). Marking (`engine/answers.ts`) is strict on
  purpose: no synonym, unit, title or number-word lists. The user asked for the
  work to fall on the writer, not on sorting answers.
- **The autocorrect** (`lib/games/tidy.ts`, run by the Questions box a second after typing stops and when the box is
  left): only sure fixes, never the words of a question, answer, Fill or option. Board, Class and Subject the site's
  way ("cbsu", "cBsE" → CBSE), Chapter and Topic lines in the list's wording when the number or name makes it clear,
  label capitals ("q1:" → "Q:"), levels in lower case, commas to ";" in a Wrong line, a blank line before each Q:, and
  the four chapter lines put back at the top if deleted, once the writer has moved below them. The caret's own line
  only gets changes that keep its length; the rest waits until the writer moves on. It goes in as an edit of the box,
  so Ctrl+Z still works. Never a guess: a Topic number and name that disagree, topics under a chapter it couldn't
  match, and a Wrong line whose parts may hold a comma of their own ("Copper, zinc and tin") are left as written. The
  timed fix runs only while the Questions box itself has focus and no keyboard is composing a word. The line being typed
  never gets its Wrong commas changed; in a pasted reply only the code block is fixed; a fix taken back with Ctrl+Z is
  not made again; a whole-text paste or an emptied box forgets the old chapter lines; and when the box is left, the
  caret line follows any lines the fix added (so a Topic button still lands where the caret was). A fix made when the
  box is left isn't in the browser's undo history, so it shows its own "Tidied the questions" Undo; taking any fix back
  (Ctrl+Z or that Undo) keeps it from being made again, including a blank line put before a Q: or a chapter line put
  back. Undo on Try an example, Fix it or Clear brings back the old text's own chapter lines too.
- **Colours in the Questions box:** each kind of line has its own colour (chapter lines grey, Topic purple, Q dark,
  A green, Also teal, Fill blue, Wrong orange-brown, Level light grey; labels a little lighter). The textarea's text is
  see-through and the copy behind it (`games-backdrop` in `WriteQuestions.tsx`, `lineKind` in `helpers.ts`) is what shows, so the copy
  must keep exactly the textarea's font, padding and width: no bold, no other font size.
- **Write questions, small behaviours:** a dropdown pick or a topic button types its line into the box a letter at a
  time (`typeTo`, about half a second, at once with reduced motion; the box is read-only meanwhile, and anything that
  reads the text finishes it first with `settled`). Changing a Board, Class, Subject or Chapter already set when the box
  has questions of the writer's own asks "Clear your questions for the new chapter?" (Clear and change, with Undo; Keep
  them; Cancel); the example's questions, or none, are cleared without asking. Setting a detail for the first time
  never asks. Clear (and "Start a new batch") removes the questions but keeps the chapter
  lines; Try an example asks first when the box has questions of your own (Undo works either way); both keep the
  pressed button where it was on screen (`steady`), so the page never jumps. Topic buttons show a tick and how many
  questions are under each topic. In the preview, a greyed-out game's tab says on hover what it needs, and tapping it says so under the tabs (for phones).
- **Write questions, the layout pass (unslop):** a cross on each sent-back question removes it from the list for good
  on that device (kept in `localStorage` under `games.sentBack.dismissed` by `pages/Games.tsx`, which leaves them out
  of the list and the tab's count; the database has no place for it). A removed one comes back only when the same question is sent again unchanged (the send says so, with "See why"). Questions of one batch sent back together with one reason (same reason, same moment: `sentTogether` in `rows.ts`)
  are one entry, with the reason, "Show the N questions" and "Fix them in the Questions box". The list is checked again
  each time Write questions is opened. The problem list has one entry per line, the
  line number coloured red or amber and the text dark; clicking it centres the whole question in the box (measured on
  the copy behind the box, as lines wrap). Under each result only the games it is left out of ("Not in: Word search").
  Step 3 has the same card colour as the others, with a Full screen button by its heading; the small preview's
  crossword uses at most 8 answers. Send for approval stays in view (sticky) beside the preview. The phone's "problems
  to fix" button shows only while the results are still below.
- **Browser tests:** `npm run e2e` (Playwright, `playwright.config.ts`, files in `e2e/games/*.e2e.ts`) starts the dev
  server with the preview tools on and a placeholder Supabase address, and drives Write questions and Chapters in dummy
  mode: the autocorrect and its Undo, the dropdowns (typed in, and asking before a change clears questions), the merged
  problem list, flagged batches on Approve questions (`flagged.e2e.ts`), Try the games (`play.e2e.ts`), sent-back questions, the preview's greyed-out games, Bulk add and
  Bulk remove. No database or keys needed. `@playwright/test` is pinned to the Playwright version whose browser is
  installed. Not in `npm test` or CI (vitest runs in node with no browser); run it after changing these pages.
- **Motion (Apple's fluid-interface rules: settle with no bounce, start from where things are, turn around mid-way):**
  the tab rows (the parts, Approve's Waiting/Approved/Sent back, the games) have one highlight that glides to the tab
  chosen (`SlidingPill` in `shared.tsx`, inside a `relative` row; tabs carry `data-pill`); a new part, tab or puzzle
  fades and rises in without being mounted again (`useEnter` in `helpers.ts`); parts that open and close (the sent-back
  list, "Show the N questions", Approve's chapter rows and "Why is this going back?") grow and shrink from their
  current height (`Reveal` in `shared.tsx`; a `flow-root`, so its margins are counted the same while it moves and after,
  and nothing shifts when it settles). When a part's height changes, the blocks below the change (sections, list rows,
  anything `data-flip`) slide to their new place instead of jumping (`useSmoothLayout` in `helpers.ts`, on the part's
  element in `pages/Games.tsx`): each block's place is noted in its part or parent block, again just before each press
  or key, and the browser's own scroll to keep the view steady is allowed for, so a change above the view moves
  nothing on screen; it leaves what a `Reveal` is already moving alone. While a pick types its line in, the page checks the finished text, so no
  error shows for a half-typed line. All of it is still with reduced motion. `e2e/games/motion.e2e.ts` measures it.
- **Popups open and close smoothly:** every games popup stays mounted and is opened with `open`, so Radix plays the
  site's open and close animations (`overlay-modal`); a popup's words are kept as they were while it closes (`useLatch`
  in `helpers.ts`), as clearing or replacing changes them at once. Reduced motion turns the movement off.
- **Questions and answers are never reworded.** Only a bullet or number before
  a label, Markdown bold around it, quotes or bold around a whole part, and
  extra spaces are removed.
- **The chatbot prompt is short and made for one chapter** on the list: it
  sends the chatbot to the rules at `https://www.shikshaq.in/games/instructions.md`
  (`INSTRUCTIONS_URL` in `prompt.ts`) and gives what that page can't know: the
  chapter's lines, its topics (fixed, already in use, or none given, in the
  page's own words) and a place for the teacher's material.
  `lib/games/prompt.test.ts` fails if the prompt, the page, the labels, limits,
  levels or examples drift from the checker. Change `prompt.ts`,
  `public/games/instructions.md`, `Guide.tsx` and `format.ts` together.
- **The rules page (the question-writing skill):** `public/games/instructions.md`, served at
  `/games/instructions.md` as plain text (`vercel.json` sets `text/plain`). One set of rules for any
  chatbot, for every way it is used: the copied prompt links to it, and teachers can paste it whole into
  ChatGPT, Gemini or Claude. Its top line has the date it was last updated and a version number (with any change, update both
  and add the change to the list in `docs/GAMES_SKILL_TEST_KIT.md`). Replies start with "Written with Shikshaq's
  question guide", the number of questions and the chapter, which shows the chatbot read the page, ends with an empty "End of instructions" heading
  that the copied prompt names as the end of the page, and covers when to use it, the 5 steps, a question-by-question check, long chapters over several replies,
  fixing rejected questions, and parts A (choosing questions), B (trimming answers) and C (good and bad
  examples with the page's messages). `prompt.test.ts` checks its limits, its worked example and every
  good block in part C against the checker. `docs/GAMES_SKILL_TEST_KIT.md` is the test to rerun in
  fresh chats after a change. The checker leaves out a chatbot's own sentences around its code block,
  so a whole reply can be pasted.