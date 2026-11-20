# Test kit: the question-writing rules in any chatbot

Run this after any change to `public/games/instructions.md`, to check that ChatGPT, Gemini and Claude all write
questions the Write questions page accepts.

## How to run it

For each chatbot (ChatGPT, Gemini, Claude) and each of the 3 tests below, so 9 runs in all:

1. Open a **new chat** (no earlier messages; turn off memory or custom instructions if you can).
2. Paste the **whole text of `public/games/instructions.md`**, then a blank line, then the test's request exactly as
   written below, in the same message.
3. Copy the chatbot's **whole reply** (the chat around the code block is fine).
4. Paste it into Write questions (`/games?dummy=1` works) and note the problems the page shows, or send all
   9 replies to Claude to score against the checker.

Test 2 is long (up to 80 questions): if the chatbot stops partway, reply "continue" as many times as it asks, and
paste all its parts together. Note whether it said clearly what was left.

## What a pass looks like

- The page shows **no problems** for the reply (red or amber), and Send is ready.
- Every question has Q, A, Fill, Wrong and Level (True/False: Q, A and Level).
- The chapter and Topic lines are exactly as given.
- Test 2: 2 to 6 topics, at most 80 questions, a note that they came from general knowledge, and if the reply was
  split, nothing repeated or missing.
- Test 3: all four questions kept, the chapter and Topic lines unchanged.

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

## Results

| Date | Rules version | Chatbot | Test 1 | Test 2 | Test 3 | Notes |
|---|---|---|---|---|---|---|
| 2026-11-20 | 1.1 | Claude Haiku (fresh) | 15 questions, 1 problem (a Fill line with no ___) | 25 in 6 topics, 0 problems, far too few | 4 kept, 0 problems | Too few in test 2: wording fixed in 1.2 |
| 2026-11-20 | 1.1 | Claude Sonnet (fresh) | 15 questions, 0 problems | not run (stopped) | 4 kept, 0 problems | |
| | 1.2 | ChatGPT | | | | |
| | 1.2 | Gemini | | | | |

## Versions of the rules

The page carries only its version number (the line at the top). What changed in each version:

- 1.8 (21 November 2026): the list of changes moved here from the page; the page ends with an empty "End of instructions" heading, which the prompt names as the end.
- 1.7 (21 November 2026): the reply starts with the version of these rules it followed; the address is the www one.
- 1.6 (21 November 2026): the chapter lines in step 1 are placeholders, so they can't be copied as they are.
- 1.5 (21 November 2026): each rule said once; no rule changed.
- 1.3 and 1.4 (21 November 2026): an order for when rules pull apart (accuracy, coverage, distinct, count); three kinds of fact; one fact tested once, however it is worded; the level is the thinking needed, judged for the class; wrong options checked against the exact wording; True/False tests a real misconception; Hindi Also lines; fixed topics never take stray facts; a running count across replies.
- 1.2 (20 November 2026): with no material, being careful about single facts doesn't mean writing far fewer questions.
- 1.1 (20 November 2026): one set of rules for every chatbot, at this address and for pasting. Added: when to use it, these rules come first, ask for missing details once, a question-by-question check, long chapters over several replies, no reliance on memory or tools, Part C examples.
- 1.0 (19 November 2026): first rules page for chatbots.
