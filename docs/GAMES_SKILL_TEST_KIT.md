# Test kit: the question-writing rules in any chatbot

Run this after any change to `public/games/instructions.md`, to check that ChatGPT, Gemini and Claude all write
questions the Write questions page accepts.

## How to run it

For each chatbot (ChatGPT, Gemini, Claude) and each of the 4 tests below, so 12 runs in all:

1. Open a **new chat** (no earlier messages; turn off memory or custom instructions if you can).
2. Paste the **whole text of `public/games/instructions.md`**, then a blank line, then the test's request exactly as
   written below, in the same message.
3. Copy the chatbot's **whole reply** (the chat around the code block is fine).
4. Paste it into Write questions (`/games?dummy=1` works) and note the problems the page shows, or send all
   12 replies to Claude to score against the checker.

Test 2 is long (up to 80 questions): if the chatbot stops partway, reply "continue" as many times as it asks, and
paste all its parts together. Note whether it said clearly what was left.

## What a pass looks like

- The page shows **no problems** for the reply (red or amber), and Send is ready.
- Every question has Q, A, Fill, Wrong and Level (True/False: Q, A and Level).
- The chapter and Topic lines are exactly as given.
- Test 2: 2 to 6 topics, at most 80 questions, a note that they came from general knowledge, and if the reply was
  split, nothing repeated or missing.
- Tests 1 and 2: right after the code block, a line starting "Source:" (test 1: the teacher's notes; test 2:
  general knowledge of the textbook, with a request to check the facts).
- Test 3: all four questions kept, the chapter and Topic lines unchanged.
- Test 4: **no questions at all**: one message that names the off-chapter notes (the electric circuit facts) and the
  wrong facts (body temperature, sea breeze) and asks whether to use them, leave them out or correct them.

## Test 1: from the teacher's notes, fixed topics

```
Board: CBSE
Class: 7
Subject: Science
Chapter 4: Heat
Topics (fixed: use only these, written exactly like this):
Topic 1: Hot and Cold
Topic 2: Transfer of Heat

15 questions from my notes: A thermometer measures temperature. A clinical thermometer reads from 35 to 42 degrees Celsius. Normal body temperature is 37 degrees Celsius. A laboratory thermometer reads from -10 to 110 degrees Celsius. Heat flows from a hotter object to a colder one. In solids heat moves by conduction. Metals are good conductors; wood and plastic are insulators. In liquids and gases heat moves by convection. Sea breeze blows from sea to land during the day; land breeze blows at night. The Sun's heat reaches us by radiation, which needs no medium. Dark clothes absorb more heat than light clothes, so we wear light clothes in summer. Woollen clothes keep us warm because wool traps air, a poor conductor.
```

## Test 2: a whole chapter, no notes, topics not fixed

```
Board: CBSE
Class: 9
Subject: Social Science
Chapter 2: Physical Features of India
Topics: none given. Divide the chapter into topics yourself.

No notes: write from the textbook.
```

## Test 3: fix questions the page turned away

```
The page keeps turning these away, fix them so I can send them:

Board: CBSE
Class: 10
Subject: Science
Chapter 1: Chemical Reactions and Equations
Topic 1: Chemical Equations

1. Q: What is a balanced chemical equation?
A: It is an equation with equal number of atoms of each element on both sides.

Q: Is rusting a chemical change?
A: Yes

Q: Law of conservation of mass was given by
A: Lavoisier (French chemist)
Wrong: Dalton, Newton, Boyle
Level: Medium

Q: Gas evolved when zinc reacts with dilute sulphuric acid
A: Hydrogen
Also: hydrogen gas
Fill: Zinc reacts with dilute sulphuric acid to give hydrogen ___.
Wrong: Oxygen; Chlorine; Nitrogen
Level: easy
```

## Test 4: notes that don't fit the chapter

```
Board: CBSE
Class: 7
Subject: Science
Chapter 4: Heat
Topics (fixed: use only these, written exactly like this):
Topic 1: Hot and Cold
Topic 2: Transfer of Heat

10 questions from my notes: A thermometer measures temperature. Normal body temperature is 40 degrees Celsius. Heat flows from a hotter object to a colder one. In solids heat moves by conduction. Sea breeze blows from land to sea during the day. A switch completes or breaks an electric circuit. A fuse melts when too much current flows.
```

## Results

| Date | Rules version | Chatbot | Test 1 | Test 2 | Test 3 | Notes |
|---|---|---|---|---|---|---|
| 2026-11-20 | 1.1 | Claude Haiku (fresh) | 15 questions, 1 problem (a Fill line with no ___) | 25 in 6 topics, 0 problems, far too few | 4 kept, 0 problems | Too few in test 2: wording fixed in 1.2 |
| 2026-11-20 | 1.1 | Claude Sonnet (fresh) | 15 questions, 0 problems | not run (stopped) | 4 kept, 0 problems | |
| 2026-11-25 | 1.14 | Claude Haiku and Sonnet (fresh) | notes that fit: 8 questions, 0 problems, "Source: your notes." | no notes (8 asked): 8 questions, "Source: general knowledge…" | | Test 4 and its parts: notes from another chapter, notes partly about circuits, two wrong facts: all three asked first and wrote nothing |
| | 1.2 | ChatGPT | | | | |
| | 1.2 | Gemini | | | | |

## Versions of the rules

The page's top line carries the date it was last updated and its version number. What changed in each version:

- 1.15 (26 November 2026): the answer is the thing itself, not a phrase about it ("One-fourth", not "Becomes one-fourth"), and questions ask for a thing, not "What happens to…"; the Fill rule and check say to read the sentence with the answer in the gap, with no word said twice; wrong options match the answer's shape; part C has the bad example and its fix. Found in real questions sent on 16 November (ISC Class 12 Physics). The page now sends such a question to the HoD with a note.
- 1.14 (25 November 2026): the teacher's material comes first; before writing, the chatbot checks it against the chapter and, if any part belongs to another chapter or disagrees with the textbook, asks the teacher and writes nothing until they answer. Every reply names its source on a "Source:" line after the code block.
- 1.13 (21 November 2026): step 3 no longer claims the page rejects every break; some rules only the chatbot's own check catches.
- 1.12 (21 November 2026): step 3 says plainly that the game ignores capitals, spaces, hyphens, punctuation, brackets and "the", so an Also line differing only in those is never needed ("Air-tight containers").
- 1.11 (21 November 2026): the reply's first line names the guide, how many questions and the chapter, instead of the date.
- 1.10 (21 November 2026): an Also line that only repeats the answer is left out by the page instead of stopping the question ("Also: s" for "(s)").
- 1.9 (21 November 2026): replies start with "Written with Shikshaq's question guide, updated" and the page's date, instead of a version number.
- 1.8 (21 November 2026): the list of changes moved here from the page; the page ends with an empty "End of instructions" heading, which the prompt names as the end.
- 1.7 (21 November 2026): the reply starts with the version of these rules it followed; the address is the www one.
- 1.6 (21 November 2026): the chapter lines in step 1 are placeholders, so they can't be copied as they are.
- 1.5 (21 November 2026): each rule said once; no rule changed.
- 1.3 and 1.4 (21 November 2026): an order for when rules pull apart (accuracy, coverage, distinct, count); three kinds of fact; one fact tested once, however it is worded; the level is the thinking needed, judged for the class; wrong options checked against the exact wording; True/False tests a real misconception; Hindi Also lines; fixed topics never take stray facts; a running count across replies.
- 1.2 (20 November 2026): with no material, being careful about single facts doesn't mean writing far fewer questions.
- 1.1 (20 November 2026): one set of rules for every chatbot, at this address and for pasting. Added: when to use it, these rules come first, ask for missing details once, a question-by-question check, long chapters over several replies, no reliance on memory or tools, Part C examples.
- 1.0 (19 November 2026): first rules page for chatbots.
