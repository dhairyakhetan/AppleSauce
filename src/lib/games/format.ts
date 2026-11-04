/**
 * The Questions box on Write questions: reads it into questions, and checks each one.
 *
 * Where the questions go (board, class, subject, chapter and topic) is chosen with the dropdowns above the box, never
 * typed, so the box holds only questions, one block each:
 *
 *   Q: the question                                   always
 *   A: the answer                                     always
 *   Fill: the same fact as a sentence, with ___       always, except True/False
 *   Wrong: a wrong option; another; another           always, except True/False (3 to 5, separated by ";")
 *   Also: another answer that is just as right        only when there is one (at most 5)
 *   Level: easy, medium or hard                       if you like
 *
 * A True/False question is a statement after Q: and "A: True" or "A: False", and nothing else.
 *
 * What a chatbot adds around the labels is read as it was meant: a bullet or number before a label, bold around it, a
 * code fence, a heading, a line of dashes, a label written out ("Answer:", "Wrong options:", "Difficulty:"), several
 * answers on one Also: line or several Wrong: lines. Board, Class, Subject, Chapter and Topic lines are allowed when they
 * name what is chosen above (the page checks them, `checkPlace`). Nothing in a question or answer is ever reworded:
 * only extra spaces, and quotes or bold around a whole part, go.
 *
 * Every problem is one sentence on the line to fix, saying what to change (`text`, for people), with the same thing as
 * a short instruction for a chatbot (`fix`, for the prompt that asks one to fix them: prompt.ts `fixPrompt`). A question
 * with a problem isn't sent.
 */
import { hasContent, sameAnswer } from './engine/answers';
import { blanks, BLANK, isTrueFalse, shows } from './engine/shared';
import { sameName } from './catalog';
import { checkBoard, checkClass, checkSubject, parseNumbered, readMeta } from './details';
import { DIFFICULTIES, type Difficulty, type Row } from './rows';

export const MAX_QUESTION = 300;
export const MAX_ANSWER = 100;
export const MAX_ANSWER_WORDS = 6;
export const MAX_ALSO = 5;
export const MIN_OPTIONS = 3;
export const MAX_OPTIONS = 5;
/** The most questions one send takes: one topic's worth. */
export const MAX_PER_SEND = 30;

/** A question as written in the box. `line` is its Q: line, `end` its last line. */
export interface Draft {
  question: string;
  answer: string;
  also: string[];
  fill: string | null;
  wrong: string[];
  level: Difficulty | null;
  line: number;
  end: number;
}

/**
 * A problem on a line. `q`: the question it belongs to (its index in `drafts`); none for a line that isn't part of a
 * question. `missing`: a line the question doesn't have yet, which waits while the person is still writing it.
 */
export interface Issue { line: number; text: string; fix: string; q?: number; missing?: true }

/** A Board, Class, Subject, Chapter or Topic line in the box. */
export interface Header { key: 'board' | 'class' | 'subject' | 'chapter' | 'topic'; value: string; line: number }

/** Where the questions go: what the dropdowns above the box chose. `topic_no` null: no topic (an open chapter only). */
export interface Where {
  chapter_id: string; board: string; class: number; subject: string; chapter_no: number; chapter: string;
  topic_no: number | null; topic: string;
}

type Key = 'q' | 'a' | 'also' | 'fill' | 'wrong' | 'level';
const LABEL: Record<Key, string> = { q: 'Q:', a: 'A:', also: 'Also:', fill: 'Fill:', wrong: 'Wrong:', level: 'Level:' };

/** Each label, and the other ways a chatbot writes it. */
const NAMES: [RegExp, Key][] = [
  [/^(?:q|ques|question)(?:\s*(?:no\.?\s*)?\d{1,3})?$/i, 'q'],
  [/^(?:a|ans|answer|correct answer|right answer)$/i, 'a'],
  [/^(?:also|also accepted|also correct|accepted(?: answers?)?|alternatives?|alternative answers?|other (?:accepted |correct |right )?answers?)$/i, 'also'],
  [/^(?:fill(?:[- ]in)?(?:[- ]the[- ]blanks?)?(?: sentence)?|blank|sentence)$/i, 'fill'],
  [/^(?:(?:wrong|incorrect)(?: options?| answers?| choices?)?|distractors?)$/i, 'wrong'],
  [/^(?:level|difficulty|difficulty level|level of difficulty)$/i, 'level'],
];
/** A bullet or a number a chatbot put before a label. */
const LEAD = /^(?:[-*•▪◦·]\s+|\d{1,3}[.)]\s+)/;

/** A labelled line, or null. "Q1. ..." and "Q1) ..." count as a question too. */
function readLabel(line: string): { key: Key; value: string } | null {
  const t = line.trim().replace(/^#{1,6}\s+/, '').replace(LEAD, '');
  // "**Q:** text" closes its bold after the colon; "Q: __" without bold before it is the start of the text
  const m = t.match(/^(\*\*|__)?([^:*_]{1,30}?)(\*\*|__)?\s*:\s*(.*)$/);
  if (m) {
    const key = NAMES.find(([re]) => re.test(m[2].trim()))?.[1];
    const rest = m[1] && !m[3] && m[4].startsWith(m[1]) ? m[4].slice(m[1].length) : m[4];
    if (key) return { key, value: clean(rest) };
  }
  const q = t.match(/^(?:\*\*)?q\s*\d{1,3}\s*[.)](?:\*\*)?\s+(.*)$/i);
  return q ? { key: 'q', value: clean(q[1]) } : null;
}

/** Extra spaces, and quotes or bold around the whole part, go. Nothing inside is changed. */
function clean(v: string): string {
  let t = v.replace(/\s+/g, ' ').trim();
  for (;;) {
    const m = t.match(/^(\*\*|`|"|“)(.+)(\*\*|`|"|”)$/);
    if (!m || (m[1] === '“' ? '”' : m[1]) !== m[3] || m[2].includes(m[1])) return t;
    t = m[2].trim();
  }
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const split = (v: string) => v.split(';').map(clean).filter(Boolean);

/** Options that stop making sense once the options are shuffled. */
const POSITIONAL = /^(?:all|none|both|neither)\b.*\b(?:above|these|of them|a and b|options?)\b|^(?:both|neither)\s+\(?[a-d]\)?\s+(?:and|nor)\s+\(?[a-d]\)?$/i;
/** A question that leans on options, a figure or text the games don't show. */
const NEEDS_MORE = /\b(?:of|among|from) the following\b|\bwhich of these\b|\bthe above\b|\b(?:given|shown|mentioned|stated|listed) (?:above|below)\b/i;
const NEEDS_PICTURE = /\b(?:in|from|see|refer to|using|use|study|observe) the (?:figure|diagram|picture|image|graph|map|passage|table|chart)\b|\b(?:figure|diagram|picture|image|graph|map|passage|table|chart) (?:given|shown|above|below)\b/i;
const TRUE_FALSE_ASK = /^(?:state\s+)?(?:whether\s+)?(?:true\s+or\s+false|t\s*\/\s*f|true\s*\/\s*false)\b|\(\s*true\s+or\s+false\s*\)|\btrue\s+or\s+false\s*[:?]/i;
/** Characters a student can type on an ordinary keyboard (dashes and curly quotes are read as - and '). */
const TYPEABLE = /^[\p{L}\p{M}\p{Nd}\s!-/:-@[-`{-~₹‘’“”–—−]*$/u;
const untypeable = (s: string) => [...new Set([...s].filter((ch) => !TYPEABLE.test(ch)))].join(' ');
/** A number with a unit symbol ("37 °C", "90°"): the unit belongs in the question. */
const NUMBER_AND_UNIT = /^[-+−]?\d[\d.,]*\s*(?:°\s*[CFK]?|℃|℉|[kMm]?Ω|µ\p{L}*|²|³|(?:[kcmµ]?m|ft|in)[²³]|m\/s²)\.?$/u;
/** What is in round or square brackets after a space in an answer: a note or another answer. */
const BRACKETED = /\s([([][^)\]]*\p{L}{2,}[^)\]]*[)\]])/u;

const NO_ANSWER = 'This question has no A: line. Write the answer on the next line, as A: ...';
const NO_FILL = 'This question has no Fill: line. Add the same fact as a sentence, with ___ where the answer goes.';
const NO_WRONG = `This question has no Wrong: line. Add ${MIN_OPTIONS} wrong options, separated by ";".`;

interface Block {
  line: number;
  end: number;
  q: string;
  a?: { v: string; line: number };
  also: { v: string; line: number }[];
  fill?: { v: string; line: number };
  wrong?: { v: string[]; line: number; raw: string };
  level?: { v: string; line: number };
}

/** Reads the box: the questions, the Board/Class/Subject/Chapter/Topic lines, and every problem, in line order. */
export function read(raw: string): { drafts: Draft[]; headers: Header[]; issues: Issue[] } {
  const drafts: Draft[] = [];
  const headers: Header[] = [];
  const issues: Issue[] = [];
  const seen = new Map<string, number>(); // a question's text → the line it was first written on
  let block: Block | null = null;
  /** A blank line since the question's last line: a loose line after it is not part of that question. */
  let gap = false;

  const finish = (b: Block) => {
    const q = drafts.length;
    const err = (line: number, text: string, fix: string, missing?: true) => issues.push(missing ? { line, text, fix, q, missing } : { line, text, fix, q });
    const a = b.a?.v ?? '';
    const aLine = b.a?.line ?? b.line;
    const also = b.also.map((x) => x.v);
    const it = { answer: a, also };
    const trueFalse = isTrueFalse(a);
    const yesNo = /^(yes|no)$/i.test(a);

    // Q
    if (!b.q) err(b.line, 'The question is empty. Write it after Q:.', 'Write the question after Q:.');
    if (b.q.length > MAX_QUESTION) err(b.line, `The question is longer than ${MAX_QUESTION} characters. Make it shorter.`, `Shorten the question to at most ${MAX_QUESTION} characters.`);
    if (blanks(b.q)) err(b.line, 'No ___ in the question. Ask it as a question or a clue, and put the sentence with ___ on the Fill: line.', 'Take the ___ out of the question: ask it as a question or clue, and put the sentence with ___ on the Fill: line.');
    if (TRUE_FALSE_ASK.test(b.q)) err(b.line, 'Write only the statement after Q:, without "True or false". The A: line says True or False.', 'Write only the statement after Q:, without "True or false".');
    for (const [text, line, what] of [[b.q, b.line, 'question'], [b.fill?.v ?? '', b.fill?.line ?? 0, 'Fill: sentence']] as const) {
      if (!text) continue;
      const which = what === 'question' ? 'Ask the question' : 'Write the Fill sentence';
      const leans = text.match(NEEDS_MORE)?.[0];
      if (leans) err(line, `The ${what} must make sense on its own, without "${leans}": the options only appear in one game.`, `${which} directly, without "${leans}".`);
      if (NEEDS_PICTURE.test(text)) err(line, `The ${what} can't need a figure, diagram, map, table or passage: the games show only text.`, `${which} so that it needs no figure, diagram, map, table or passage.`);
    }

    // A
    if (!b.a) err(b.line, NO_ANSWER, 'Add the A: line with the answer.', true);
    else if (!a) err(aLine, 'The answer is empty. Write it after A:.', 'Write the answer after A:.');
    else if (!hasContent(a)) err(aLine, 'The answer has no letters or digits.', 'Write the answer in letters or digits.');
    else {
      if (a.length > MAX_ANSWER || words(a) > MAX_ANSWER_WORDS) {
        err(aLine, `The answer is too long (${words(a)} words). At most ${MAX_ANSWER_WORDS} words: move the rest into the question.`, `Shorten the answer to at most ${MAX_ANSWER_WORDS} words, and move the rest into the question.`);
      }
      if (yesNo) err(aLine, 'Yes or No can\'t be an answer. Turn the question into a statement, with "A: True" or "A: False".', 'Turn it into a statement, with A: True or A: False, and no Also, Fill or Wrong lines.');
      if (/\s\/\s/.test(a)) {
        const [first, ...rest] = a.split(/\s\/\s/);
        err(aLine, 'Write one answer after A:, and each other right answer on an Also: line.', `Keep "${first}" on the A: line and put ${rest.map((x) => `"${x}"`).join(', ')} on ${rest.length > 1 ? 'Also: lines' : 'an Also: line'}.`);
      }
      const bracket = a.match(BRACKETED)?.[1];
      if (bracket) {
        err(aLine, `Students would have to type "${bracket}" too. If it is another right answer, move it to an Also: line; if it is a note, leave it out.`,
          `Take "${bracket}" out of the answer: put it on an Also: line if it is another right answer, or drop it if it is a note.`);
      }
      if (blanks(a)) err(aLine, 'No ___ in the answer. The ___ goes in the Fill: sentence.', 'Take the ___ out of the answer.');
      if (!TYPEABLE.test(a) && !also.some((x) => TYPEABLE.test(x))) {
        if (NUMBER_AND_UNIT.test(a.replace(BRACKETED, '').trim())) {
          const unit = /²/.test(a) ? 'square metres' : /³/.test(a) ? 'cubic centimetres' : /[°℃℉]/.test(a) ? 'degrees Celsius' : 'ohms';
          err(aLine, `Students can't type "${untypeable(a)}". Put the unit in the question ("..., in ${unit}") and write the answer as the number alone.`, `Put the unit in the question (for example "..., in ${unit}") and make the answer the number alone.`);
        } else {
          err(aLine, `Students can't type "${untypeable(a)}". Add an Also: line with the answer in ordinary keys, such as x^2 for x² or sqrt 3 for √3.`, `Add an Also: line with the answer typed with ordinary keys (it has "${untypeable(a)}": for example x^2 for x², sqrt 3 for √3).`);
        }
      }
      if (b.q && shows(b.q, it)) {
        const x = [a, ...also].find((s) => shows(b.q, { answer: s }));
        err(b.line, `The question gives away the answer ("${x}"). Rewrite it without those words.`, `Rewrite the question so that it doesn't contain "${x}".`);
      }
    }

    // Also
    if (trueFalse && b.also.length) err(b.also[0].line, 'A True/False question has no Also: line. Remove it.', 'Remove the Also: line (a True/False question has none).');
    else {
      b.also.forEach((x, i) => {
        if (i === MAX_ALSO) err(x.line, `At most ${MAX_ALSO} other answers. Remove the rest.`, `Keep at most ${MAX_ALSO} Also: answers.`);
        if (i >= MAX_ALSO) return;
        if (!x.v) return err(x.line, 'This Also: line is empty. Remove it.', 'Remove the empty Also: line.');
        if (x.v.length > MAX_ANSWER || words(x.v) > MAX_ANSWER_WORDS) return err(x.line, `"${x.v}" is too long for an answer: at most ${MAX_ANSWER_WORDS} words.`, `Shorten "Also: ${x.v}" to at most ${MAX_ANSWER_WORDS} words.`);
        if (blanks(x.v)) return err(x.line, 'No ___ in an answer.', `Take the ___ out of "Also: ${x.v}".`);
        if (a && sameAnswer(x.v, a)) return err(x.line, `"${x.v}" is the answer again (capitals and spaces already don't matter). Remove it.`, `Remove "Also: ${x.v}": it is the answer again.`);
        if (also.slice(0, i).some((y) => sameAnswer(x.v, y))) return err(x.line, `"${x.v}" is written twice. Remove one.`, `Remove the second "Also: ${x.v}".`);
      });
    }

    // Fill
    if (b.fill) {
      const f = b.fill.v;
      const n = blanks(f);
      if (trueFalse || yesNo) err(b.fill.line, 'A True/False question has no Fill: line. Remove it.', 'Remove the Fill: line (a True/False question has none).');
      else if (!n) err(b.fill.line, 'The Fill: sentence needs ___ (three underscores) where the answer goes.', 'Put ___ (three underscores) in the Fill sentence where the answer goes.');
      else if (n > 1) err(b.fill.line, 'Only one ___ in the Fill: sentence. It stands for the whole answer.', 'Keep exactly one ___ in the Fill sentence, standing for the whole answer.');
      else if (words(f.replace(BLANK, ' ')) < 3) err(b.fill.line, 'Write a whole sentence around the ___, so it can be answered on its own.', 'Write the Fill sentence in full around the ___.');
      else if (a && shows(f.replace(BLANK, ' '), it)) err(b.fill.line, 'The Fill: sentence gives away the answer. Only the ___ should stand for it.', 'Rewrite the Fill sentence so the answer appears only as the ___.');
      if (f.length > MAX_QUESTION) err(b.fill.line, `The Fill: sentence is longer than ${MAX_QUESTION} characters.`, `Shorten the Fill sentence to at most ${MAX_QUESTION} characters.`);
    } else if (b.a && a && !trueFalse && !yesNo) {
      err(b.line, NO_FILL, 'Add a Fill: line: the same fact as a sentence, with ___ where the answer goes.', true);
    }

    // Wrong
    if (b.wrong) {
      const ws = b.wrong.v;
      const line = b.wrong.line;
      const kind = (s: string) => (/\p{L}/u.test(s) ? 'words' : 'a number');
      const isAnswer = ws.find((o) => [a, ...also].some((x) => x && sameAnswer(o, x)));
      const positional = ws.find((o) => POSITIONAL.test(o));
      if (trueFalse || yesNo) err(line, 'A True/False question has no Wrong: line. Remove it.', 'Remove the Wrong: line (a True/False question has none).');
      else if (ws.length === 1 && b.wrong.raw.split(',').length >= MIN_OPTIONS) err(line, 'Separate the wrong options with ";", not commas.', 'Separate the wrong options with ";", not commas.');
      else if (ws.length < MIN_OPTIONS) err(line, `Write ${MIN_OPTIONS} wrong options, separated by ";" (there ${ws.length === 1 ? 'is 1' : `are ${ws.length}`}).`, `Give ${MIN_OPTIONS} wrong options on the Wrong: line, separated by ";" (it has ${ws.length}).`);
      else if (ws.length > MAX_OPTIONS) err(line, `At most ${MAX_OPTIONS} wrong options.`, `Keep at most ${MAX_OPTIONS} wrong options.`);
      else if (ws.some((o) => o.length > MAX_ANSWER || words(o) > MAX_ANSWER_WORDS)) err(line, `A wrong option is too long: at most ${MAX_ANSWER_WORDS} words, like an answer.`, `Shorten the wrong options to at most ${MAX_ANSWER_WORDS} words each.`);
      else if (ws.some((o, i) => ws.slice(0, i).some((p) => sameAnswer(o, p)))) err(line, 'The same wrong option is written twice.', 'Replace the repeated wrong option with a different one.');
      else if (isAnswer) err(line, `"${isAnswer}" is a right answer, so it can't be a wrong option.`, `Replace the wrong option "${isAnswer}": it is a right answer.`);
      else if (positional) err(line, `"${positional}" doesn't work: the options are shuffled. Write a real wrong option.`, `Replace "${positional}" with a real wrong option.`);
      // the same kind as the answer, or as one of its other answers ("Zero", also "0", with numbers as options)
      else if (a && ws.some((o) => ![a, ...also].some((x) => kind(x) === kind(o)))) {
        err(line, `The wrong options must be the same kind as the answer: ${kind(a) === 'a number' ? 'numbers' : 'words, not numbers on their own'}.`, `Make every wrong option ${kind(a) === 'a number' ? 'a number, like the answer' : 'words, like the answer, not a number on its own'}.`);
      }
    } else if (b.a && a && !trueFalse && !yesNo) {
      err(b.line, NO_WRONG, `Add a Wrong: line with ${MIN_OPTIONS} wrong options, separated by ";".`, true);
    }

    // Level
    const level = b.level?.v.toLowerCase().replace(/[.!]+$/, '') as Difficulty | undefined;
    if (b.level && !DIFFICULTIES.includes(level!)) {
      err(b.level.line, 'The level must be easy, medium or hard.', `Change "Level: ${b.level.v}" to easy, medium or hard.`);
    }

    // twice, and how many
    if (b.q) {
      const key = sameKey(b.q);
      const first = seen.get(key);
      if (first) err(b.line, `The same question is on line ${first}. Remove one of them.`, 'Remove this question: it is written twice.');
      else seen.set(key, b.line);
    }
    if (q === MAX_PER_SEND) err(b.line, `At most ${MAX_PER_SEND} questions are sent at a time. This one and the ones after it go in the next send.`, `Send at most ${MAX_PER_SEND} questions at a time.`);
    else if (q > MAX_PER_SEND) err(b.line, `More than ${MAX_PER_SEND} questions: this one goes in the next send.`, `Send at most ${MAX_PER_SEND} questions at a time.`);

    drafts.push({
      question: b.q, answer: a, also, fill: b.fill?.v ?? null, wrong: b.wrong?.v ?? [],
      level: level && DIFFICULTIES.includes(level) ? level : null, line: b.line, end: b.end,
    });
  };

  const close = () => {
    if (block) finish(block);
    block = null;
  };
  const stray = (line: number, text: string, fix: string) => issues.push({ line, text, fix });

  raw.split(/\r?\n/).forEach((text, i) => {
    const line = i + 1;
    const t = text.trim();
    if (!t) { gap = true; return; }
    if (/^(```|~~~)/.test(t) || /^[-*_=]{3,}$/.test(t)) return; // a code fence, or a line of dashes

    const label = readLabel(t);
    if (label) {
      gap = false;
      if (label.key === 'q') {
        close();
        block = { line, end: line, q: label.value, also: [] };
        return;
      }
      if (!block) return stray(line, `This ${LABEL[label.key]} line has no Q: line above it. Each question starts with Q:.`, 'Give it the Q: line it belongs to, or remove it.');
      block.end = line;
      const v = label.value;
      // several answers on one Also: line, and several Wrong: lines, are what they look like
      if (label.key === 'also') return void block.also.push(...(split(v).length ? split(v) : ['']).map((x) => ({ v: x, line })));
      if (label.key === 'wrong') {
        block.wrong = block.wrong ? { ...block.wrong, v: [...block.wrong.v, ...split(v)] } : { v: split(v), line, raw: v };
        return;
      }
      if (block[label.key]) {
        return void issues.push({ line, text: `This question already has a ${LABEL[label.key]} line. Keep one.`, fix: `Keep one ${LABEL[label.key]} line.`, q: drafts.length });
      }
      if (label.key === 'a') block.a = { v, line };
      else if (label.key === 'fill') block.fill = { v, line };
      else block.level = { v, line };
      return;
    }

    // a heading is read for the detail it names, else left out
    const heading = /^#{1,6}\s/.test(t);
    const meta = readMeta(t);
    if (meta && meta.key !== 'difficulty') {
      close();
      headers.push({ key: meta.key, value: meta.value.trim(), line });
      return;
    }
    if (heading) return;

    // a loose line right under a question is part of it; after a blank line it stands on its own
    if (gap) close();
    if (block) block.end = line;
    const q = block ? drafts.length : undefined;
    const say = (text: string, fix: string) => issues.push(q === undefined ? { line, text, fix } : { line, text, fix, q });
    if (/^\(?[a-dA-D][.):]\s+\S/.test(t)) return say(`Don't list options as a), b), c). Put the ${MIN_OPTIONS} wrong options on one Wrong: line, separated by ";".`, `Replace the a), b), c) lines with one Wrong: line of ${MIN_OPTIONS} wrong options, separated by ";".`);
    if (/\s\|\s|\t/.test(t)) return say('Write each question as a block of lines (Q:, A:, Fill:, Wrong:), not on one line.', 'Write it as a block of lines: Q, A, Fill, Wrong and Level.');
    if (block) return say('This line isn\'t part of the question: every line starts with Q:, A:, Also:, Fill:, Wrong: or Level:. A question or answer must fit on one line.', `Remove the line "${t}", or start it with its label.`);
    say('This line isn\'t a question. Start each question with Q:, or remove the line.', 'Remove this line: write only the questions.');
  });
  close();

  issues.sort((x, y) => x.line - y.line);
  return { drafts, headers, issues };
}

/** How two questions are compared for "written twice": case, spaces and punctuation at the end don't matter. */
const sameKey = (q: string) => q.trim().replace(/[\s?.!:;,।]+$/u, '').replace(/\s+/g, ' ').toLowerCase();

/**
 * The Board, Class, Subject, Chapter and Topic lines against what is chosen above: a line that names something else is a
 * problem, as its questions would go somewhere the person didn't mean. A line that names the chosen one is fine, as is a
 * number left out or a name left out. A Topic line when "no topic" is chosen is a problem.
 */
export function checkPlace(headers: Header[], w: Where | null): Issue[] {
  if (!w) return [];
  const where = `${w.board} class ${w.class} ${w.subject}, chapter ${w.chapter_no}: ${w.chapter}${w.topic_no === null ? ', no topic' : `, topic: ${w.topic}`}`;
  const out: Issue[] = [];
  for (const h of headers) {
    let other: boolean;
    if (h.key === 'board') other = checkBoard(h.value).name !== w.board;
    else if (h.key === 'class') other = checkClass(h.value).value !== w.class;
    else if (h.key === 'subject') other = checkSubject(h.value).name !== w.subject;
    else {
      const { no, name } = parseNumbered(h.value, h.key);
      const [wNo, wName] = h.key === 'chapter' ? [w.chapter_no, w.chapter] : [w.topic_no, w.topic];
      other = h.key === 'topic' && w.topic_no === null ? true : name ? !sameName(name, wName) : no !== wNo;
    }
    if (other) {
      out.push({
        line: h.line,
        text: `This line names somewhere else. These questions go to ${where}, as chosen above. Remove the line, or choose the right ${h.key} above.`,
        fix: 'Remove this line: write only the questions.',
      });
    }
  }
  return out;
}

/** The problems to show right now: not on the line being typed, and not what a question is still missing while the
 * cursor is in it or just below it. They show once the cursor moves on. A fix clears at once. */
export function visibleIssues(issues: Issue[], caret: number | null, drafts: Draft[]): Issue[] {
  if (!caret) return issues;
  const writing = drafts.findIndex((d) => caret >= d.line && caret <= d.end + 1);
  return issues.filter((x) => x.line !== caret && !(x.missing && x.q === writing && writing >= 0));
}

/** The lines with a problem, for the underline in the box. */
export const problemLines = (issues: Issue[]) => new Set(issues.map((x) => x.line));

/** The questions as rows for the database, under the chosen chapter and topic, numbered from 1 in the order written. */
export function toRows(drafts: Draft[], w: Where): Row[] {
  return drafts.map((d, i) => ({
    chapter_id: w.chapter_id, topic_id: w.topic_no === null ? null : `${w.chapter_id}T${String(w.topic_no).padStart(2, '0')}`,
    board: w.board, class: w.class, subject: w.subject, chapter_no: w.chapter_no, chapter: w.chapter, topic_no: w.topic_no, topic: w.topic_no === null ? '' : w.topic,
    question_no: i + 1, question: d.question, answer: d.answer, also: d.also, fill: d.fill, wrong_options: d.wrong, difficulty: d.level,
    line: d.line, end: d.end,
  }));
}

type Written = Pick<Row, 'question' | 'answer' | 'difficulty'> & Partial<Pick<Row, 'also' | 'fill' | 'wrong_options'>>;

/** One question as its block of lines ("Fix it" puts a sent-back question back in the box this way). */
export function blockOf(r: Written): string {
  return [
    `Q: ${r.question}`,
    `A: ${r.answer}`,
    ...(r.also ?? []).map((x) => `Also: ${x}`),
    ...(r.fill ? [`Fill: ${r.fill}`] : []),
    ...(r.wrong_options?.length ? [`Wrong: ${r.wrong_options.join('; ')}`] : []),
    ...(r.difficulty ? [`Level: ${r.difficulty}`] : []),
  ].join('\n');
}

/** "Try an example": every part used, and two questions with mistakes to show how problems are marked. Its questions
 * are never sent while the example is loaded. */
export const EXAMPLE = `Q: Law which says that mass can neither be created nor destroyed in a chemical reaction
A: Law of conservation of mass
Fill: A chemical equation is balanced because of the ___.
Wrong: Law of definite proportions; Law of multiple proportions; Avogadro's law
Level: medium

Q: Gas given off when zinc reacts with dilute sulphuric acid
A: Hydrogen
Also: H2
Fill: Zinc reacts with dilute sulphuric acid to give off ___ gas.
Wrong: Oxygen; Chlorine; Nitrogen
Level: easy

Q: Rusting of iron is a chemical change
A: True

Q: Which of the following is a combination reaction?
A: Burning of magnesium
Fill: The ___ is a combination reaction.
Wrong: Electrolysis of water; Rusting
Level: medium
`;
