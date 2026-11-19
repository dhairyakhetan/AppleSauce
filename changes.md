# Proposed changes: the /games page

This list covers only the `/games` site (`src/components/games/`, `src/lib/games/`, `src/pages/Games.tsx`). It replaces the earlier list, which was written for the old standalone site and no longer fits. Nothing here is done yet. It comes from reading the code, with no tests or browser run, so each item is a reading of the code and not a confirmed failure.

## What the new code already fixed

These problems from the old site are gone:

- The fill-in input no longer remounts on every state change (it has no state-based `key`), so focus stays while typing.
- A check no longer runs on blur.
- Devanagari and other non-Latin vowel signs are kept (`unaccent` only strips marks after Latin letters).
- Commas inside numbers are ignored ("1,00,000" = "100000"), and "3.5" is not "35".
- Tab leaves the crossword, and the preview doesn't take the keyboard until it is tapped.
- Crosswords take answers up to 25 letters (15 across), and word searches up to 15.
- An `Also:` line gives other accepted answers, and `Fill:` and `Wrong:` are written by the teacher, not guessed.

## A. Answer input in the games (`src/components/games/GameView.tsx`, `Revise.tsx`)

1. **Repeated wrong tries.** In `FillGame`, `check()` runs again on Enter or "Check all" for an answer that is already wrong, even when the text hasn't changed, and each run adds a try. Pressing Enter twice, or "Check all" twice, shows "Show answer" after one real attempt. Fix: skip the check when the typed text equals the text last marked wrong.
2. **Word search cancel.** There is no `onPointerCancel` (or lost-capture) handler on the grid. If the browser cancels a touch (a call, a system gesture), the drag stays "held" and the next tap acts as a drag end. Add a handler that clears the drag.
3. **All five games are built on every change.** `games` in `Revise.tsx` runs `makeGame` for crossword, word search, matching, fill and choice each time the topics or seed change, but only one is shown. Each retries up to 12 times. Build the shown game first and the others when its tab is opened.
4. **Changing the class resets the subject.** `open(chapters.find((c) => c.cls === n))` jumps to the first chapter of that class, so a student who picked Chemistry has to pick it again. Keep the same subject when the new class has it.
5. **Questions with no chapter ID are dropped silently** in `chaptersOf`. Show how many were left out, or put them under "Other questions".
6. **Matching cleanup.** The `setTimeout` that clears the wrong highlight isn't cleaned up on unmount. Harmless, but easy to fix.
7. **Later: load one class or chapter at a time** instead of the whole approved bank.

## B. The chatbot prompt (`src/lib/games/prompt.ts`) and the guide (`Guide.tsx`)

`prompt.test.ts` checks that labels, limits, levels and examples match the checker, so change `prompt.ts`, `Guide.tsx` and `format.ts` together.

1. **The question counts contradict each other.** The prompt asks for "20 to 30 questions per topic", but a chapter is capped at 80 (`MAX_PER_CHAPTER`) and an open chapter gets 2 to 6 topics. Four topics at 20 is already 80, and six at 20 is 120, so the checker turns away the extra questions. Fix: ask for a total (for example "about 60 to 80 in the chapter, spread over its topics") or scale per topic by the number of topics.
2. **Labels must stay in English.** The prompt says "write in the material's language". The checker reads only `Q:`, `A:`, `Also:`, `Fill:`, `Wrong:`, `Level:`, `Topic N:` and the Board, Class, Subject and Chapter lines in English. Add one line saying so, and that `Level:` stays easy, medium or hard.
3. **"At most one True/False in five" isn't checked.** The prompt states it, but I found no matching check in `format.ts`. Either enforce it or drop the sentence, so the prompt doesn't promise a rule the page doesn't apply.
4. **The block is long.** Every question has six lines (Q, A, Also, Fill, Wrong, Level) and a chapter can have 80, so a chatbot may stop partway. Add a sentence on what to do then (say so, and write the rest on "continue", repeating the chapter and Topic lines), and say whether a second paste goes below the first or replaces it. Test how the page reads a repeated Board line first.
5. **A missing `Fill:` stops a question being sent.** The page shows "No Fill: line" as a warning, but a question with any red or amber problem isn't sent. Check that the prompt's "Every question has Q, A, Fill, Wrong and Level" is clear enough that a chatbot doesn't leave `Fill:` out of Hindi or number answers.
6. **Say what Hindi and symbol answers do.** An answer with digits, symbols or another script can't go in a crossword or word search, only in matching, fill and choice. The guide says nothing about this. Add one line, so teachers writing Hindi questions know why the grid games are greyed out.
7. **The example uses the first topic of the chapter only** (`formatExample`), and the shared example is about plants and hexagons. Add one grid-friendly answer pair with an `Also:` short form, such as "Decomposition reaction" with "Decomposition", which is already in the guide's sample.
8. **Add one line against the injection reading** at the top of the prompt: the teacher pasted it, and it only describes a format.

## C. Writing questions (`WriteQuestions.tsx`, `format.ts`)

I read `format.ts` fully and skimmed `WriteQuestions.tsx`, so these are lighter checks.

1. **A reply that quotes labels in another language** (such as "प्रश्न:") is turned away with "Start each question with Q:". Fine, but the message could say "labels must be in English".
2. **`TYPEABLE` rejects characters Hindi keyboards can type?** It allows letters and marks of every script, so Hindi is fine. Symbols such as `°`, `²` and `√` are refused on purpose. Keep that, but have the prompt give the keyboard form (it already does).
3. **Worth a test:** pasting 80 six-line questions into the editor, to check the typing and the underlines stay fast. I didn't measure it.

## Suggested order

1. B1 (the question-count contradiction), B2 and B3: small edits to the prompt, with the tests that go with them.
2. A1 and A2: small and local.
3. A3 to A5, then the rest of B.
4. A7 only when the bank grows.
