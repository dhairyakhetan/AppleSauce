# Trimming an answer to what a student types

The answer is matched against what a student types. Case, spaces, punctuation between words, Latin accents, commas inside numbers and a leading "a", "an" or "the" don't matter; anything else does. So the answer should be the shortest text that is completely right, with every extra word moved into the question. Never change a fact, a number or a unit to make it shorter.

## The cuts, with the keyword to look for

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
| Yes / No | Rewrite the question as a statement with A: True or A: False | Q: Is the Sun a star? / A: Yes | Q: The Sun is a star / A: True |
| More than 6 words left after all this | Put the rest in the question, or pick another fact | A: The law of conservation of mass in reactions | A: Law of conservation of mass |

## Keep these, they are not extra

- Words that are part of the term: *Balanced equation*, *Prussian soldiers*, *Law of conservation of mass*.
- A capital or a hyphen the term really has: *Franco-Prussian War*.
- The number alone when the fact is a number: *1857*, *37*, *6*. Add the number in words as an Also line when students might type it (*Also: Six*).

## Also lines: what counts and what doesn't

Add an Also line only for a different, equally right answer:

- short or full form: *Central Processing Unit* / *CPU*
- another name: *Kolkata* / *Calcutta*
- a number in words: *6* / *Six*
- the answer without a word the question already gives: *Decomposition reaction* / *Decomposition*

Never add the same answer written another way, because the game already accepts it and the checker rejects the line:

- *Alps* / ~~The Alps~~ (a leading "the" is ignored)
- *Floodplain* / ~~Flood plain~~ (spaces are ignored)
- *Carbon dioxide* / ~~carbon-dioxide~~ (hyphens and capitals are ignored)
- a misspelling: the game already gives half marks for a small slip

## The same rule for Fill and Wrong

- **Fill**: the `___` stands for the whole trimmed answer, so the sentence around it must not repeat any of the answer's words or any Also answer. *"Heat flows from a hotter body to a ___ one"* (Colder) works; *"The ___ Plateau is in Meghalaya"* with Also *Meghalaya* gives the answer away.
- **Wrong options** follow the answer's form: if the answer is two words, so are the options; if it's a number, so are they.
