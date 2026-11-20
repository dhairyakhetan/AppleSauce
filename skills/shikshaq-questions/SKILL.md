---
name: shikshaq-questions
description: >-
  Write school revision questions for Shikshaq's games (crossword, word search, matching, fill in the blank, multiple choice) in the exact block format the Write questions page at shikshaq.in/games accepts (Q:, A:, Also:, Fill:, Wrong:, Level: under Board, Class, Subject, Chapter and Topic lines). Use this whenever someone wants questions, a question bank, quiz items, MCQs or revision material for a school chapter (CBSE, ICSE, state boards, NCERT books, any class or subject) to paste into Shikshaq, wants a chatbot reply turned into that format, or wants questions checked or fixed so the page stops turning them away, even if they only say "make questions for class 10 science chapter 2" or paste notes and say "questions from this".
---

# Shikshaq revision questions

You turn a chapter (and usually a teacher's notes) into question blocks that a teacher pastes into the **Questions** box on shikshaq.in/games. A strict checker reads every line. Any question with a problem is not sent, so a block that is nearly right is as useless as a missing one. Students then play these questions as puzzles, which is why answers must be short and typeable.

Work through the steps in order. The reference files hold the detail; read the one a step points to when you reach it.

## 1. Get the chapter, the topics and the material

You need four chapter lines, copied exactly as given (they must match the site's chapter list, so never "correct" them):

```
Board: CBSE
Class: 7
Subject: Science
Chapter 4: Heat
```

If they are missing, ask for them once. Then the topics, which come in three cases:

- **fixed**: use only the given Topic lines, written exactly. Skip one the material doesn't cover. Never add one.
- **already in use**: keep those lines exactly for questions that belong there, and number any new topic after the last one.
- **none given**: split the chapter yourself into 2 to 6 topics: the parts the textbook gives headings to, in teaching order. Not "MCQs", not one fact, not the chapter's name.

The material is the teacher's notes, passage or rough questions. Every fact comes from it. With no material, use only well-established facts from the standard textbook for that chapter, and say in your reply that the teacher should check them. Be most careful with exact numbers, dates and lesser-known names: leave one out rather than guess, and name any you kept but aren't sure of.

The Fill sentence, the wrong options and any Also lines are yours to write even when the material gives only the fact; that's expected, so don't mention it. If the teacher names a topic only by number ("topic 2"), ask for its full Topic line.

## 2. Choose what to ask

Read `references/choosing-questions.md` before you write. In short: one fact per question; spread questions over the whole topic, not its first paragraph; prefer facts whose answer is a word or two of letters (they work in all five games); give each question in a topic a different answer; mix easy, medium and hard.

How many, if the teacher gives no number:

| Topics | Questions per topic |
|---|---|
| 1 or 2 | 20 to 30 |
| 3 | 20 to 26 |
| 4 | 20 |
| 5 | 16 |
| 6 | 13 |

Never more than 30 in a topic or 80 in the chapter, whatever is asked. If the teacher gives a total, spread it over the topics. Fewer is fine when the material is short; never pad.

## 3. Write each question as a block

```
Q: the question
A: the answer
Also: another answer that is just as right
Fill: the same fact as a sentence, with ___ where the answer goes
Wrong: a wrong option; another; another
Level: easy
```

The rules the checker enforces (it rejects any break):

- **Layout.** The chapter lines first, then `Topic N: Name`, then that topic's blocks. Blank line between blocks and after each Topic line. Each part on one line. No numbering, bullets, bold, headings or tables.
- **English labels.** Board, Class, Subject, Chapter, Topic, Q, A, Also, Fill, Wrong, Level, the words True and False, and easy, medium, hard stay in English. Everything else is in the material's language.
- **Q.** One fact with exactly one correct answer. At most 300 characters. Makes sense alone: never "the above", "of the following", "which of these", "given below", or a figure, diagram, map, table or passage. Never contains the answer or any Also answer, word for word. No yes/no questions; no "True or false" or "(True/False)" in it.
- **A.** What a student types: at most 6 words and 100 characters, never a sentence, no brackets or notes, never two answers joined by "/" or "or". Units go in the question. A symbol a keyboard lacks (x², √2, π) needs an Also line typed with ordinary keys (x^2, sqrt 2, pi). Read `references/trimming-answers.md` for how to cut an answer down without changing the fact.
- **Also** (optional, at most 5, one per line, at most 6 words). Only an answer that is just as right: short form, full form, another name, a number in words. Never the answer again with a space, hyphen, capital, punctuation or "the" changed: the game already accepts those, and the checker rejects the line ("The Alps" for Alps, "Flood plain" for Floodplain).
- **Fill** (required). The same fact as one sentence with exactly one `___` standing for the whole answer, at least 3 other words, at most 300 characters, reading correctly with the answer in the gap. It must not contain the whole answer or any whole Also answer. One word of a longer answer is allowed (for *Sea breeze*, "In the day a cool ___ blows in from the sea" is accepted), but a sentence without it is usually clearer.
- **Wrong** (required). 3 to 5 options on one line, separated by `;` (never commas), each at most 6 words. Believable, clearly wrong, the same kind as the answer (a year for a year), about as long. A number answer gets number options; a word answer gets no bare numbers. Never the answer, an Also answer, a repeat, or "All of the above", "None of these", "Both A and B" (options are shuffled).
- **Level** (required). easy (recall), medium (understand), hard (apply or link ideas).
- **True/False** (at most 1 in 5). Q is a statement, `A: True` or `A: False` with nothing after the word, then Level. No Also, Fill or Wrong.
- **No repeats.** The same question twice in a chapter is rejected, even with a different ending ("?" or ".").

`references/examples.md` has good blocks and the common bad ones, each with why the checker rejects it and the fix. Read it the first time you use this skill.

## 4. Check before you reply

If you can run code, save your block to a file and run:

```
python3 scripts/check.py questions.txt
```

It applies the checker's main rules and prints every problem with its line number; fix them all and run it again until it prints `No problems`. The site's own checker has the final say, so treat a clean run as necessary, not sufficient.

Without code, go through each block by eye: chapter lines exact; every block under a Topic line; Q, A, Fill, Wrong, Level present (True/False: Q, A, Level); answer and Also answers absent from Q and Fill; one `___` with 3+ words around it; 3 to 5 `;`-separated wrong options, none right; nothing over 6 words; no Also that only respaces the answer; labels in English.

## 5. Reply

Put everything in **one code block**: the chapter lines, then each Topic line with its questions. Nothing else inside the block, so the teacher can copy it in one click. After the block, at most three short sentences, only those that apply: which answers you supplied because the material lacked them; that you wrote from general knowledge and the teacher should check; that the material was short so there are fewer questions than asked. If asked for changes, write the whole block again.

## Fixing questions the page turned away

When a teacher pastes questions the page turned away, with or without the page's list of problems (or its "Copy prompt to fix them" text):

1. If there is no list, find the problems yourself with `scripts/check.py`, or by going through the rules in step 3.
2. Fix each problem with the smallest change that works: cut an answer to its key term, turn a Yes/No into a True/False statement, move a bracket note out, swap commas for `;`. Reword a question only when it has to change (it gives the answer away, needs a figure, or isn't one fact).
3. Add any missing Fill, Wrong or Level line, so every question is complete.
4. Keep every line that had no problem exactly as the teacher wrote it, including the chapter and Topic lines, and keep every question (don't drop one to make the rest pass).
5. Return the whole text in one code block, then one sentence saying what kinds of changes you made.

The "at most 1 True/False in 5" guide is for new sets; when fixing, a Yes/No question may become True/False even in a short set.
