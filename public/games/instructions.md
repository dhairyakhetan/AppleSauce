# Writing revision questions for Shikshaq's games

Version 1.7, 21 November 2026. Lives at https://www.shikshaq.in/games/instructions.md

This is a complete set of instructions for any AI assistant (ChatGPT, Gemini, Claude or another). A teacher either sent you this link or pasted this text, and their request follows it.

## Use these instructions for

- **Writing new questions**: the teacher gives a chapter (and usually notes) and wants revision questions for Shikshaq's games.
- **Fixing questions the page turned away**: the teacher pastes questions, often with the page's list of problems, and wants them fixed so they can be sent.

## Before you start

- **Everything you need is in this text.** Don't rely on earlier chats, saved memories, custom instructions, browsing or other tools. If something can't be done from this text and the teacher's message alone, ask the teacher.
- **These rules come first.** They override your usual habits for formatting and replies (step 3 says what goes inside the code block, step 5 what may go outside it).
- **Why it is strict.** The teacher pastes your reply into the Questions box at shikshaq.in/games. A checker reads every line, and a question with any problem is not sent. Students then play the questions as puzzles (crossword, word search, matching, fill in the blank, multiple choice), so answers must be short and typeable.

Work through steps 1 to 5 in order. Parts A, B and C hold the detail; read each when a step points to it.

## 1. Get the chapter, the topics and the material

You need four chapter lines, copied exactly as the teacher gives them (they must match the site's chapter list, so never "correct" or translate them). Their shape:

```
Board: [the board]
Class: [the class]
Subject: [the subject]
Chapter [number]: [the chapter's name]
```

For example, `Board: CBSE`, `Class: 7`, `Subject: Science`, `Chapter 4: Heat`. Always use the teacher's own lines, never these placeholders or this example.

**If something essential is missing** (the board, class, subject, or the chapter's number and name), ask for all the missing items together in one message, then wait. Never guess a chapter number. Ask in the same message if the teacher names a topic only by its number ("topic 2"): you need its full Topic line. Missing notes don't stop you (see below).

Then the topics. The teacher's message says which case it is:

- **"fixed"**: use only the given Topic lines, written exactly. Skip one the material doesn't cover. Never add one, and never force a fact into a topic it doesn't clearly belong to: leave it out, and say after the block what you left out.
- **"already in use"**: keep those lines exactly for questions that belong there, and number any new topic after the last one.
- **none given**: split the chapter yourself into 2 to 6 topics: the parts the textbook gives headings to, in teaching order, named as the textbook names them. If it has no headings, group by its main themes; never invent finer subtopics. Not "MCQs", not one fact, not the chapter's name.

Write each topic as "Topic 1: Name", "Topic 2: Name", and so on.

The material is the teacher's notes, passage or rough questions. Facts come from three places, in this order:

1. **The teacher's material**: when it is given, it is the only source.
2. **With no material, standard content of that board's and class's textbook**: central ideas, standard definitions and commonly taught examples. Never invent textbook wording, examples, dates or numbers, and leave out anything that depends on one edition or syllabus. With exact numbers, dates and lesser-known names, leave one out rather than guess, and name any you kept but aren't sure of. Say after the block that the questions come from general knowledge of the textbook, not from the teacher's own book, and never imply you checked them against a particular edition.
3. **Anything else**: leave it out.

The Fill sentence, the wrong options and any Also lines are yours to write even when the material gives only the fact.

## 2. Choose what to ask

Read part A before you write: it says how to pick facts, cover a whole topic, test each fact once and mix the levels.

How many, if the teacher gives no number:

| Topics | Questions per topic |
|---|---|
| 1 or 2 | 20 to 30 |
| 3 | 20 to 26 |
| 4 | 20 |
| 5 | 16 |
| 6 | 13 |

Never more than 30 in one topic, and never more than 80 in the chapter, whatever is asked. If the teacher gives a total, spread it over the topics.

**When these pull against each other, this order decides:**

1. **Accuracy**: every fact is certain and comes from the right place (step 1).
2. **Coverage**: the questions cover what the material (or the chapter) really teaches; a fixed topic the material doesn't cover is skipped, not filled.
3. **Distinct**: each question tests a different fact, and each answer in a topic is different.
4. **The count**: the numbers above are targets, not quotas.

So never add an obscure, trivial, repeated or doubtful question to make up a count. But don't stop early either: a chapter's terms, named features, causes, effects, comparisons and examples usually give plenty of good questions. Write fewer only when a topic really has no more, and say so after the block.

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

- **Layout.** The chapter lines first, then a Topic line, then that topic's blocks. A blank line between blocks and after each Topic line. Each part on one line. No numbering, bullets, bold, headings or tables.
- **English labels.** Board, Class, Subject, Chapter, Topic, Q, A, Also, Fill, Wrong, Level, the words True and False, and easy, medium, hard stay in English. Everything else is in the material's language.
- **Q.** One fact with exactly one correct answer. At most 300 characters. Makes sense alone: never "the above", "of the following", "which of these", "given below", or a figure, diagram, map, table or passage. Never contains the answer or any Also answer, word for word. No yes/no questions; no "True or false" or "(True/False)" in it.
- **A.** What a student types: at most 6 words and 100 characters, never a sentence, no brackets or notes, never two answers joined by "/" or "or". Units go in the question. A symbol a keyboard lacks (x², √2, π) needs an Also line typed with ordinary keys (x^2, sqrt 2, pi). Part B shows how to cut an answer down without changing the fact.
- **Also** (optional, at most 5 lines, one answer each, at most 6 words). Only a different answer that is just as right, never the answer respelt (part B lists what counts). In Hindi and other scripts, add another spelling or term only if the textbook itself uses it, and not an English-letter version unless the teacher asks.
- **Fill** (required). The same fact as one sentence with exactly one `___` standing for the whole answer. At least 3 other words around the ___, and at most 300 characters. It reads correctly with the answer in the gap, and must not contain the whole answer or any whole Also answer.
- **Wrong** (required). 3 to 5 wrong options on one line, separated by `;` (never commas), each at most 6 words, the same kind as the answer: a number answer gets number options, a word answer gets no bare numbers. Never the answer, an Also answer, a repeat, or "All of the above", "None of these", "Both A and B" (options are shuffled). Read each option against the exact wording of the question: if it could be argued to be right, even partly, replace it. Part A shows good ones.
- **Level** (required). easy, medium or hard: easy is recall, medium is understanding, hard is applying, comparing, predicting or linking ideas. The level measures the thinking needed, not how obscure the fact is: a hard-to-remember date is not a hard question. Judge it for a student of that class: the same question can be easy in class 10 and hard in class 6.
- **True/False** (at most 1 in 5). A True/False question is different: it has only Q, A and Level. Q is a statement, `A: True` or `A: False` with nothing after the word. Use it to test a real concept or a common misconception ("Heat flows from a colder body to a hotter one" → False), never an obvious statement ("The Sun is a star") or one that is only sometimes true.
- **No repeats.** The same question twice in a chapter is rejected, even with a different ending ("?" or ".").

Part C has good blocks and the common bad ones, each with the page's message and the fix.

## 4. Check every question before you reply

Go through the questions one by one and check each of these in order. Fix anything that fails, then check that question again.

1. **Chapter and Topic lines**: the chapter lines are exactly as given, the question is under a Topic line, and the Topic lines follow step 1.
2. **Complete**: Q, A, Fill, Wrong and Level are all there. A True/False question has only Q (a statement), Level, and `A: True` or `A: False` with nothing after the word.
3. **No giveaway**: neither Q nor Fill contains the answer or any Also answer, word for word.
4. **Fill**: exactly one ___, standing for the whole answer, with at least 3 other words around it, and the sentence reads correctly with the answer put in (a or an, singular or plural).
5. **Answer**: at most 6 words and 100 characters, not a sentence, no brackets, no "/" or "or", no unit after a number, and a typed Also line for any symbol a keyboard lacks.
6. **Also lines**: each one a different right answer, not the answer respelt, with a space, hyphen, capital or "the" changed.
7. **Wrong options**: 3 to 5, separated by `;`, the same kind as the answer, and none of them right, partly right, or arguably right under the question's exact wording.
8. **Repeats**: no two questions test the same fact, even in different words, and no two questions in a topic have the same answer (capitals, spaces and "the" don't make answers different).
9. **Worth asking**: the fact is central and certain, the level fits the thinking it needs, and a True/False tests a real misconception.
10. **Format**: labels, True/False and levels in English; no numbering, bullets, bold or quotation marks around lines.

## 5. Reply

Start with one line naming the version of these rules you followed, for example "Rules version 1.7". It shows the teacher you read them; the page ignores it.

Then put everything in **one code block**: the chapter lines, then each Topic line with its questions. Nothing else inside the block, so the teacher can copy it in one click. After the block, at most three short sentences in the teacher's language, only those that apply: which answers you supplied because the material lacked them; that you wrote from general knowledge and the teacher should check; that there are fewer questions than asked because the topic or material has no more good ones; facts you left out because they fit none of the fixed topics. If asked for changes, write the whole block again.

**If it won't fit in one reply** (a long chapter, or a reply limit): stop at the end of a whole topic, never in the middle of one. After the block, say exactly what is done and what is left, for example "Topics 1 to 3 are done. Reply 'continue' for topics 4 to 6." Start the next reply with the chapter lines again, then carry on from the next topic, without repeating or skipping any question. Keep a running count and state it each time ("Questions 1 to 40 of 78"). Never say the set is complete when it isn't, and never summarise questions you haven't written.

Never say that you saved or sent anything: the teacher pastes your block into the site. Never ask for a password, an account or personal details.

## Fixing questions the page turned away

When a teacher pastes questions the page turned away, with or without the page's list of problems (or its "Copy prompt to fix them" text):

1. If there is no list, find the problems yourself with the check in step 4.
2. Fix each problem with the smallest change that works: cut an answer to its key term, turn a Yes/No into a True/False statement, move a bracket note out, swap commas for `;`. Reword a question only when it has to change (it gives the answer away, needs a figure, or isn't one fact).
3. Add any missing Fill, Wrong or Level line, so every question is complete.
4. Keep every line that had no problem exactly as the teacher wrote it, including the chapter and Topic lines, and keep every question (don't drop one to make the rest pass).
5. Return the whole text in one code block, then one sentence saying what kinds of changes you made.

The "at most 1 True/False in 5" guide is for new sets; when fixing, a Yes/No question may become True/False even in a short set.

## Part A. Choosing good questions from a topic

A question earns its place if a student who revised the topic can answer it in a word or two, and one who didn't can't guess it. Puzzles mix questions from several topics, so each question also has to stand completely on its own.

### How to go through a topic

1. **List the facts first.** Read the topic's material and write down every fact that has a short, single answer: names, terms, definitions turned around, causes, results, places, people, numbers, examples. A paragraph usually holds 2 to 5.
2. **Cover the whole topic.** Take facts from the start, middle and end, and from every sub-heading. Twenty questions on the first page of a topic is a common failure; so is skipping the parts that are harder to turn into questions.
3. **Prefer the terms the chapter teaches.** "Conduction", "Photosynthesis", "Iqta" are what students must learn. A minor name in a side box or an example sentence is trivia; keep only a few.
4. **Turn each fact so the answer is the key word.** "Heat moves through solids by conduction" becomes *"Way heat moves through a solid"* with answer *Conduction*, not *"How does heat move through a solid? Explain."*
5. **Test each fact once, and give each question in a topic a different answer.** Compare questions by the fact they test, not their wording: "Gas plants take in to make food" and "Gas absorbed during photosynthesis" are the same question. Prefer different concepts, relationships, examples and applications. The matching game also pairs questions with answers, so two "Conduction" answers in a topic make it impossible. Across topics a repeated answer is fine.
6. **Mix the levels.** Roughly half easy (recall a fact as taught), a third medium (needs the idea understood: a cause, a comparison, an example), the rest hard (apply, compare, predict or connect ideas: which case, what happens if).

### What makes a fact a good question

| Good | Why |
|---|---|
| A defined term ("Process by which green plants make food" → Photosynthesis) | One right answer, one word, plays in every game |
| A named person, place, date or event from the main text | Short, exact, easy to mark |
| A cause or result ("Gas given off when zinc reacts with dilute sulphuric acid" → Hydrogen) | Tests understanding, still one word |
| A number the chapter states and students must know (Normal body temperature, in degrees Celsius → 37) | Exact, with the unit in the question |

| Avoid | Why |
|---|---|
| Opinions, "why" and "explain" questions | No single answer a student can type |
| Lists ("Name three…", "What are the types of…") | More than one answer, or the order matters |
| Facts that only appear in an activity, a figure or a table | The games show text only, so it can't be asked fairly |
| A question whose answer is a whole sentence | Can't be typed or put in a grid; ask for the key word instead |
| "Which of the following…" | The options aren't shown in four of the five games |

### Answers that play well

- **Words beat numbers.** Crosswords and word searches use only answers made of letters, 3 to 15 letters long (spaces and hyphens are ignored). Prefer *"Instrument that measures temperature" → Thermometer* over *"Highest reading on a clinical thermometer" → 42*. Keep numbers to the facts that really are numbers.
- **One or two words beat four.** "Decomposition reaction" is fine; "The law of conservation of mass" is long. If a shorter form is just as right, add it as an Also line: the grid games then use it (*A: Decomposition reaction, Also: Decomposition*).
- **Hindi and other scripts** are fine. Those answers play in matching, fill in the blank and multiple choice, just not in the letter grids.

### Wrong options that teach

Wrong options appear in multiple choice. Good ones are the mistakes a student might really make:

- Same kind as the answer: other gases for a gas, other years near the right one, other characters from the same story.
- Plausible for this chapter: for "Conduction", use *Convection; Radiation; Evaporation*, not *Photosynthesis*.
- About the same length and form as the answer (two words for a two-word answer), so the right one doesn't stand out.
- Never partly right. For "line segment joining two points on a circle" (Chord), *Diameter* is also a chord, so leave it out.

## Part B. Trimming an answer to what a student types

The answer is matched against what a student types. Case, spaces, punctuation between words, Latin accents, commas inside numbers and a leading "a", "an" or "the" don't matter; anything else does. So the answer should be the shortest text that is completely right, with every extra word moved into the question. Never change a fact, a number or a unit to make it shorter.

### The cuts, with the keyword to look for

| Look for | Cut it | Before | After |
|---|---|---|---|
| A full sentence ("It is…", "This is called…", "They are…") | Keep only the key word or phrase | A: It is called photosynthesis. | A: Photosynthesis |
| Words the question already says | Drop them from the answer | Q: Gas plants take in from the air / A: Carbon dioxide gas | A: Carbon dioxide |
| "The process of", "the method of", "a type of", "known as" | Drop them | A: The process of evaporation | A: Evaporation |
| A unit or symbol after a number ("37 °C", "5 cm", "90°") | Move the unit into the question | Q: Normal body temperature / A: 37 °C | Q: Normal body temperature, in degrees Celsius / A: 37 |
| Brackets with another name ("(CPU)", "(H2O)") | Move it to an Also line | A: Central Processing Unit (CPU) | A: Central Processing Unit / Also: CPU |
| Brackets with a note ("(approx.)", "(in India)", "(e.g. iron)") | Drop the note, or put it in the question | A: 3 lakh km per second (approx.) | Q: Speed of light, roughly, in km per second / A: 300000 |
| Two answers joined by "/" or "or" | Keep one, put the other on an Also line | A: Kolkata / Calcutta | A: Kolkata / Also: Calcutta |
| A list ("Iron, copper and silver") | Ask for one item, or rethink the question | A: Iron, copper, silver | Q: Metal that rusts / A: Iron |
| A description instead of the term | Ask so that the term is the answer | A: Heat moving through a solid | A: Conduction |
| A symbol a keyboard lacks (x², √, π, →) | Keep it, and add an Also line typed with ordinary keys | A: x² | A: x² / Also: x^2 |
| More than 6 words left after all this | Put the rest in the question, or pick another fact | A: The law of conservation of mass in reactions | A: Law of conservation of mass |

### Keep these, they are not extra

- Words that are part of the term: *Balanced equation*, *Prussian soldiers*, *Law of conservation of mass*.
- A capital or a hyphen the term really has: *Franco-Prussian War*.
- The number alone when the fact is a number: *1857*, *37*, *6*. Add the number in words as an Also line when students might type it (*Also: Six*).

### Also lines: what counts and what doesn't

Add an Also line only for a different, equally right answer:

- short or full form: *Central Processing Unit* / *CPU*
- another name: *Kolkata* / *Calcutta*
- a number in words: *6* / *Six*
- the answer without a word the question already gives: *Decomposition reaction* / *Decomposition*

Never add the same answer written another way, because the game already accepts it and the checker rejects the line:

- *Alps* / ~~The Alps~~ (a leading "the" is ignored; the page says *This is the same as the answer on the A: line*)
- *Floodplain* / ~~Flood plain~~ (spaces are ignored)
- *Carbon dioxide* / ~~carbon-dioxide~~ (hyphens and capitals are ignored)
- a misspelling: the game already gives half marks for a small slip

### Fill sentences

The `___` stands for the whole trimmed answer, so the sentence around it must not repeat the answer or any Also answer. *"Heat flows from a hotter body to a ___ one"* (Colder) works; *"The ___ Plateau is in Meghalaya"* with Also *Meghalaya* gives the answer away.

## Part C. Good blocks, and the mistakes the page turns away

Every example here was run through the site's checker. A "bad" block shows the message the page gives, then the fixed block. The chapter lines are left out to keep the examples short; a real reply starts with them.

### Good blocks

A word answer with a shorter form for the grid games:

```
Q: Reaction in which a single reactant breaks down into simpler products
A: Decomposition reaction
Also: Decomposition
Fill: A reaction in which a single reactant breaks down into simpler products is called a ___.
Wrong: Combination reaction; Displacement reaction; Neutralisation reaction
Level: easy
```

A number answer: unit in the question, number in words as an Also line, number options:

```
Q: Number of years M. Hamel had taught at the school
A: 40
Also: Forty
Fill: M. Hamel had been teaching at the school for ___ years.
Wrong: 20; 30; 50
Level: medium
```

A symbol a keyboard lacks, with a typeable Also line:

```
Q: Value of x times x, written with a power
A: x²
Also: x^2
Fill: Multiplying x by itself gives ___.
Wrong: 2x; x³; x+x
Level: easy
```

A True/False question:

```
Q: Heat flows on its own from a colder body to a hotter one
A: False
Level: medium
```

A Hindi question (labels, True/False and levels stay in English):

```
Q: पौधों में भोजन बनाने की प्रक्रिया
A: प्रकाश संश्लेषण
Fill: हरे पौधे ___ द्वारा अपना भोजन बनाते हैं।
Wrong: श्वसन; वाष्पोत्सर्जन; परागण
Level: easy
```

### Bad blocks, why, and the fix

#### The answer is in the question

```
Q: Instrument called a thermometer is used to measure what
A: Thermometer
```
Page: *The question shows the answer ("Thermometer"), so it would give it away.* The same happens when an **Also** answer is in the question.

```
Q: Instrument that measures temperature
A: Thermometer
Fill: A ___ measures how hot something is.
Wrong: Barometer; Ammeter; Hygrometer
Level: easy
```

#### The Fill sentence gives the answer away, or is too short

```
Fill: A thermometer is a ___ that measures temperature.
Fill: ___ measures temperature.
```
Page: *The Fill: sentence shows the answer…* and *Write the whole sentence around the ___, so it can be answered on its own.* (at least 3 other words). Fixed: `Fill: A ___ measures how hot something is.`

#### Yes/No, and True/False written wrongly

```
Q: Does heat flow from a hotter body to a colder one?
A: Yes
```
Page: *Yes or No can't be an answer. Write a statement after Q: and "A: True" or "A: False".* Also rejected: `A: True.` (nothing after the word), and `(True/False)` or `True or false:` in the question.

```
Q: Heat flows from a hotter body to a colder one
A: True
Level: easy
```

#### "Which of the following", a figure, a passage

```
Q: Which of the following is a good conductor of heat?
Q: Look at the figure and name the part labelled A
```
Page: *The question must make sense on its own…* / *can't use a figure, diagram, map, table or passage.* The options only appear in one game; ask directly: `Q: Metal used in cooking pans because it conducts heat well`.

#### The answer is a sentence, has brackets, or holds two answers

```
A: It is the process by which plants make food.
A: 37 °C (approx.)
A: Kolkata / Calcutta
```
Page: *The answer has … words. Answers must be short* / *Students would have to type the brackets too* / *Students can't type "°"…* / *Write one answer after A:, and each other answer that counts on its own Also: line.* Part B's table shows the fix for each.

#### Wrong options: commas, too few, partly right, the wrong kind

```
Wrong: Radius, Diameter, Tangent
Wrong: Radius; Diameter
Wrong: chord; Radius; Tangent        (the answer is Chord)
Wrong: 3; 4; Hexagon                 (the answer is 6)
```
Page: *Separate the wrong options with ";", not commas.* / *Write at least 3 wrong options* / *"chord" counts as the answer, so it can't be a wrong option.* / *The wrong options must be the same kind as the answer.* Also never "All of the above" or "Both A and B".

#### Options listed as a), b), c)

```
Q: Gas plants take in to make food
A: Carbon dioxide
a) Oxygen
b) Nitrogen
```
Page: *Don't list options as a), b), c). Write the wrong options on one Wrong: line, separated by ";".*

#### A question split over two lines

```
Q: Instrument that measures
temperature in a laboratory
```
Page: *This line isn't part of the question… A question or answer must fit on one line.*

#### Labels translated, or numbered

```
प्रश्न: तापमान मापने का यंत्र
उत्तर: थर्मामीटर
```
Page: *Write the labels in English: Q:, A:, Also:, Fill:, Wrong: and Level:.* (Numbering like `1. Q:` and bold labels are tidied away by the page, but leave them out.)

#### A topic that isn't on the list

```
Topic 3: Radiation              (the chapter's fixed topics are 1 and 2)
Topic 1: Hot & Cold             (the list says "Hot and Cold")
```
Page: *Chapter 4 has no topic 3 on the list…* / *On the list, topic 1 of chapter 4 is called "Hot and Cold".* Copy Topic lines exactly as given.

#### The same question twice

```
Q: Instrument that measures temperature
Q: Instrument that measures temperature?
```
Page: *Same question as line 7. Leave one of them out.* A different ending or extra spaces don't make it a new question.

## Complete example

The teacher's message gave the chapter lines for CBSE Class 10 Science, Chapter 1: Chemical Reactions and Equations, the fixed topic "Topic 2: Types of Chemical Reactions", and no material. The reply (a real one has 20 or more questions):

```
Board: CBSE
Class: 10
Subject: Science
Chapter 1: Chemical Reactions and Equations
Topic 2: Types of Chemical Reactions

Q: Reaction in which a single reactant breaks down into simpler products
A: Decomposition reaction
Also: Decomposition
Fill: A reaction in which a single reactant breaks down into simpler products is called a ___.
Wrong: Combination reaction; Displacement reaction; Neutralisation reaction
Level: easy

Q: Gas given off when zinc reacts with dilute sulphuric acid
A: Hydrogen
Also: H2
Fill: Zinc reacts with dilute sulphuric acid to give off ___ gas.
Wrong: Oxygen; Chlorine; Nitrogen
Level: medium

Q: Number of products formed when calcium carbonate is heated strongly
A: 2
Also: Two
Fill: Heating calcium carbonate strongly gives ___ products.
Wrong: 1; 3; 4
Level: medium

Q: Rusting of iron is a physical change
A: False
Level: medium
```

I wrote these from general knowledge of the textbook, not from your own book, so please check them before using them.

## Changes

- 1.7 (21 November 2026): the reply starts with the version of these rules it followed; the address is the www one.
- 1.6 (21 November 2026): the chapter lines in step 1 are placeholders, so they can't be copied as they are.
- 1.5 (21 November 2026): each rule said once; no rule changed.
- 1.3 and 1.4 (21 November 2026): an order for when rules pull apart (accuracy, coverage, distinct, count); three kinds of fact; one fact tested once, however it is worded; the level is the thinking needed, judged for the class; wrong options checked against the exact wording; True/False tests a real misconception; Hindi Also lines; fixed topics never take stray facts; a running count across replies.
- 1.2 (20 November 2026): with no material, being careful about single facts doesn't mean writing far fewer questions.
- 1.1 (20 November 2026): one set of rules for every chatbot, at this address and for pasting. Added: when to use it, these rules come first, ask for missing details once, a question-by-question check, long chapters over several replies, no reliance on memory or tools, Part C examples.
- 1.0 (19 November 2026): first rules page for chatbots.
