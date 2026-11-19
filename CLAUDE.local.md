# CLAUDE.local.md

This file adds to `CLAUDE.md` and `src/components/games/CLAUDE.md`. It does not replace them. Where they disagree about
testing, this file wins.

## Testing: keep it small

- **Don't run the whole test suite for a small change.** Run only the tests for the files you edited, for example
  `npx vitest run src/lib/games/format.test.ts`, or the test file next to the component you changed.
- **Typecheck what you touched,** and build only when the change could break the build.
- **Run the full suite (`npm test`, the build, any stress or database run) only after a big change:** many files, a
  change to shared code (`src/lib/games/engine/shared.ts`, `format.ts`, `details.ts`), a change to the database
  scripts in `supabase/`, or before the user asks for a merge or a release.
- **Say which tests you ran,** and which you left out and why.
- **If the user says "don't follow the test suites" for a task, skip them for that task,** and say in the answer that
  nothing was run.
