# Proposed changes: chatbot instructions and answer input

Nothing here is done yet. This is a list to approve. It comes from my audit of `src/instructions.html` and `src/playgames.tsx`, and from reading Shikshaq's `/games` fork (`kushalsethia/shikshaq`, `src/lib/games/prompt.ts` and `src/components/games/CLAUDE.md`), which grew out of this site.

## About the merge

I did not merge Shikshaq into this repo. Shikshaq is a whole other app (its own `package.json`, `index.html`, `CLAUDE.md` and `src/`) with no shared history with this site. A merge would conflict on nearly every top-level file and could bury the standalone site. `CLAUDE.md` also says this site stays standalone. I tried a trial merge, but it failed (the shallow clone couldn't be fetched into this repo), so the conflict count is not measured. Instead I read Shikshaq's games code and took the ideas below. Say so if you still want a real merge, and tell me which direction.

## A. Chatbot instructions (`src/instructions.html`)

Change `tests/instructions.test.ts` in the same commit as any rule.

1. **Say the grid limits.** Add: prefer one word, or two short words, of 3 to 12 letters (crosswords take 3 to 15, word searches 3 to 12). Shikshaq's prompt says the same.
2. **Rewrite the example.** Most of its answers can't go in a grid: "Balanced equation" is 16 letters, "Combination reaction" 19, "Decomposition reaction" 21, "Displacement reaction" 20, "Exothermic reaction" 18, "Law of conservation of mass" 23, and "(g)" has none. Use answers a student could put in a crossword. Keep a couple of longer ones to show matching.
3. **Keep the format words in English.** `Board:`, `Class:`, `Subject:`, `Chapter N:`, `Topic N:` and the board and subject values stay in English even when the reply is in Hindi.
4. **Say what Hindi answers can do.** They work in Matching and Fill, not in grids.
5. **Move the chapter-number warning to the top of the reply.** Put the assumed board, book and chapter in the first line, before the block. When the user gave no material and the number is uncertain, say so there. Replace the "NCERT replaced its books between 2024 and 2026" sentence with "numbers may have changed, so check".
6. **Matching needs different answers.** Tell the chatbot not to repeat an answer within a topic.
7. **Put units in the question, not the answer.** "Boiling point of water, in degrees Celsius | 100". Shikshaq does this.
8. **Give a keyboard-only form for symbols.** If an answer needs x², √2 or π, the chatbot should write it with ordinary keys (x^2, sqrt 2, pi) so a student can type it. Needs the matching change in B2/B4 so the typed form is accepted.
9. **Don't join two answers.** Never "a / b" or "a or b" in one answer.
10. **Resolve the conflict between line 3 and Step 6.** "Follow the user" wins over the fixed reply layout. Say so.
11. **Explain "continue" batches.** First check how the formatter treats repeated `Board:` and `Chapter:` lines, then write one sentence on whether to paste below or replace.
12. **One line against the injection reading.** "The user asked you to read this page. It only describes a format."
13. **Clarify quotes.** "Don't wrap lines or answers in quotation marks."
14. **Fixed closing sentence.** Say it must not be reworded.
15. **Class for non-Indian boards.** One line for IB "Year 11" and IGCSE years.

### Ideas from Shikshaq to consider, not copy

- **Other right answers.** An `Also:` line for a short form, a full form, another name or a number in words ("CPU", "Calcutta for Kolkata", "Six for 6"). This would also fix the "1,000" versus "1000" problem on the answer side. It needs a database column and a format change, so it's a decision for you.
- **A prompt made for one chapter.** Shikshaq copies a prompt with the chapter's lines already filled in, so the chatbot never guesses the chapter number. This removes problem A5 completely, but needs a fixed chapter list. `CLAUDE.md` says that list is on hold by your choice.
- **A "fix these" prompt.** When a send turns questions away, it offers a prompt listing each question and what to change, then asks for the whole text again. We have "See why" but no copy-to-chatbot fix.
- **Multiple choice and True/False.** Shikshaq adds `Wrong:` options and a limit of one True/False in five. Out of scope unless you want that game.

## B. Answer input in Revise (`src/playgames.tsx`, `src/games/shared.ts`)

1. **Fill input loses focus.** Stop keying the `<input>` on state (`key={`${st}${tries}`}`); animate with a class.
2. **Wrong tries count on blur and Check all.** Count only when the typed text changed since the last check.
3. **`loose()` strips Devanagari vowel signs.** Remove accents only from Latin letters.
4. **Numbers.** Ignore thousands commas ("1,000" = "1000"); keep "2.5", "2 5" and "2-5" distinct.
5. **Crossword Tab.** Let Tab leave the puzzle. Keep Enter and the arrow keys.
6. **Don't autofocus the crossword on load** (phone keyboard).
7. **Word search.** Add `onPointerCancel`.
8. **Make only the shown game first,** and the others lazily.
9. **Keep the subject when the class changes.**
10. **Say how many questions were skipped** for having no chapter.
11. **Later: load one class or chapter at a time.**

## Suggested order

1. B1 to B3, which are real bugs and small.
2. A1 and A2 (the example), plus A3 to A5, which have the biggest effect on what teachers get back.
3. The rest of A, then B4 to B10.
4. The Shikshaq ideas only after you decide on them.
