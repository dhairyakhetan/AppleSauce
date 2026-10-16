# The /games site: working notes

> **ONLY FOLLOW THIS FILE FOR CHANGES IN THE /GAMES SITE, AND NOTHING ELSE.** It covers the games team's pages and
> everything behind them: `src/components/games/`, `src/lib/games/`, `src/pages/Games.tsx`, `src/hooks/useGamesRoleBadge.ts`,
> `src/dummy/games-*` and `GamesDummy.tsx`, and `supabase/games/`. Everything else about Shikshaq (the checks, the
> design rules, the security model) is in the root `CLAUDE.md`, which applies here too.

## Read first: this copy is the games branch

(About the `games` branch of `dhairyakhetan/AppleSauce` only: leave this section out of the Shikshaq pull request.)

This is branch `games` of `dhairyakhetan/AppleSauce`, not the Shikshaq repo. Its first commit is Shikshaq's `main`
exactly as downloaded on 11 October 2026; the games work goes on top, so the difference from that first commit is what
gets handed to the Shikshaq repo (`CHANGES.md` says how). The games site it comes from is `main` of this same repo
(shikshaq-games.vercel.app).

- **Push only to `games`**: `git push -u origin games`, nothing else. Never run `npm run push:all` here, and never add
  or push to the Shikshaq or `kanitest` remotes. "Two remotes, ONE branch" in the root `CLAUDE.md` is about the
  Shikshaq repo itself.

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
  anyway); the Chapter box becomes a picker and the topics become buttons
  once board, class and subject match the list.
- **Dummy mode:** `?dummy=1` on any `/games` page, or the preview toggle's
  "Games team" buttons, runs the real pages against
  `dummy/games-fake-api.ts`, which keeps the database's rules (list included).
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
- **Nothing is guessed from a question.** Each game uses only what was written
  for it: `Also` lines are the only other answers that count, `Fill` is the
  only fill-in sentence, `Wrong` the only multiple-choice options
  (`engine/index.ts` `usableIn`). Marking (`engine/answers.ts`) is strict on
  purpose: no synonym, unit, title or number-word lists. The user asked for the
  work to fall on the writer, not on sorting answers.
- **Questions and answers are never reworded.** Only a bullet or number before
  a label, Markdown bold around it, quotes or bold around a whole part, and
  extra spaces are removed.
- **The chatbot prompt is made for one chapter** on the list (its lines and
  topics, nothing else; for an open chapter it asks the chatbot to divide the
  questions into topics, keeping those already in use) and states every rule
  the checker applies.
  `lib/games/prompt.test.ts` fails if the labels, limits, levels or examples
  drift from the checker. Change `prompt.ts`, `Guide.tsx` and `format.ts`
  together.
