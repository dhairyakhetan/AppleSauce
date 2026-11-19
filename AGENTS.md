# Agent instructions

**Read [CLAUDE.md](CLAUDE.md) first and follow it.** It is the single source of
truth for how this repository is worked on. This file exists so tools that look
for `AGENTS.md` rather than `CLAUDE.md` still find their way there. (It is a
short pointer on purpose, not a copy; updated 13 Nov 2026.)

This repository is the **website**. Paper processing lives in a separate local
folder, `Shikshaq Papers`, with its own `CLAUDE.md`.

The things most likely to be got wrong, in short:

1. **`main` moves only by a pull request the owner says "merge" to.** Work on a
   short branch in its own worktree under `.claude/worktrees/`. Never push to
   `main`, never merge on your own. `npm run push:all` and the `shikshaq-2.0`
   branch are legacy: do not use them.

2. **`npx tsc --noEmit` checks nothing here.** The root config is
   `"files": []` with project references. Use `npx tsc -b`.

3. **Question-paper text is never altered.** Not cleaned, retyped or
   re-cased. Any change to how it is stored or moved must be proven
   byte-exact, not assumed.

4. **Live database changes are the owner's paste.** Read-only queries are fine.
   If the SQL tool declines a write, stop and write a
   `PASTE_IN_SUPABASE_SQL_EDITOR_*.sql` file; never route the write another way.

5. **Decisions live in `docs/DECISIONS.md`.** Read it, and add to it, before
   building on the checker, HOD or paper-status screens.

Both deployments share one **live** Supabase project. A write from the test
site is a write to production.
