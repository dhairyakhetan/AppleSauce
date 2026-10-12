/**
 * Reads the Questions box into rows for the database, and checks every question strictly.
 *
 * The box has detail lines (Board, Class, Subject, Chapter, Topic) and one block per question, each part on its own
 * labelled line:
 *
 *   Q: the question
 *   A: the answer
 *   Also: another answer that counts as right        (one per line, at most 5)
 *   Fill: the sentence with ___ where the answer goes
 *   Wrong: a wrong option; another; another          (multiple choice: 3 to 5, separated by ";")
 *   Level: easy, medium or hard
 *
 * Only the label at the start of a line has a meaning, so a question may contain any symbol (| [ ] ( ) ; : _ and so
 * on); only ";" inside a wrong option can't be written. Questions and answers are never reworded: only a bullet or a
 * number before a label, Markdown bold around a label, quotes or bold around a whole part, and extra spaces go.
 *
 * Every problem is reported on the line to fix, saying what to change. A question with any problem (red or amber) is
 * not sent: the page offers to leave those out, or to copy a prompt that asks the chatbot to fix them.
 */
import { hasContent, sameAnswer } from './engine/answers';
import { blanks, BLANK, isTrueFalse, shows } from './engine/shared';
import { boardClassProblem, chapterId, checkBoard, checkClass, checkNumbered, checkSubject, readMeta, topicId, type Level, type MetaKey, type Problem } from './details';
import { DIFFICULTIES, type Difficulty, type Row } from './rows';

export const MAX_QUESTION = 300;
export const MAX_ANSWER = 100;
export const MAX_ANSWER_WORDS = 6;
export const MAX_ALSO = 5;
export const MIN_OPTIONS = 3;
export const MAX_OPTIONS = 5;
export const MAX_PER_TOPIC = 30;
export const MAX_PER_CHAPTER = 80;

/**
 * A problem on a line. `text` is what the page shows the person; `fix` is the same thing as a short instruction for a
 * chatbot, used by the prompt that asks one to fix the questions (prompt.ts `fixPrompt`). `oneLine`: the line is a
 * question written on one line, not as a block.
 */
export interface Issue { line: number; level: Level; text: string; fix?: string; oneLine?: true }

type Key = 'q' | 'a' | 'also' | 'fill' | 'wrong' | 'level';
const LABEL_NAME: Record<Key, string> = { q: 'Q:', a: 'A:', also: 'Also:', fill: 'Fill:', wrong: 'Wrong:', level: 'Level:' };

export const NO_ANSWER = 'No A: line. Write the answer on the line after the question, as A: ...';
export const NO_FILL = "No Fill: line, so this question can't be used in fill in the blank. Add the sentence with ___ where the answer goes, as Fill: ...";

/** Options that stop making sense once the options are shuffled. */
const POSITIONAL = /^(?:all|none|both|neither)\b.*\b(?:above|these|of them|a and b|options?)\b|^(?:both|neither)\s+\(?[a-d]\)?\s+(?:and|nor)\s+\(?[a-d]\)?$/i;
/** A question that leans on options, a figure or text that games don't show. */
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

/** A label at the start of a line, after a bullet or a number and with Markdown bold around it if a chatbot added them. */
function readLabel(line: string): { key: Key; value: string } | null {
  const t = line.trim().replace(/^(?:[-*•▪◦·]\s+|\d{1,3}[.)]\s+)/, '').replace(/^\*\*([^*]{1,8}?)\*\*/, '$1');
  const m = t.match(/^(q|a|also|fill|wrong|level)\s*:\s*(.*)$/i);
  return m ? { key: m[1].toLowerCase() as Key, value: clean(m[2]) } : null;
}

/** Labels written another way, and the one to use instead. */
const NEAR: [RegExp, Key][] = [
  [/^(?:q|ques|question)\s*(?:no\.?\s*)?\d*\s*[.):\-–]/i, 'q'],
  [/^(?:ans|answer|correct answer|right answer)\s*[.):\-–]/i, 'a'],
  [/^(?:also|also accepted|accepted|alternatives?|alternative answers?|other answers?|or)\s*[.):\-–]/i, 'also'],
  [/^(?:fill|fill in|fill in the blanks?|blank|sentence|fill-in)\s*[.):\-–]/i, 'fill'],
  [/^(?:wrong|wrong options?|wrong answers?|options?|choices?|distractors?|incorrect options?)\s*[.):\-–]/i, 'wrong'],
  [/^(?:difficulty|level of difficulty)\s*[.):\-–]/i, 'level'],
];
function nearLabel(line: string): Key | null {
  const t = line.trim().replace(/^(?:[-*•▪◦·]\s+|\d{1,3}[.)]\s+)/, '').replace(/\*\*/g, '');
  return NEAR.find(([re]) => re.test(t))?.[1] ?? null;
}

/** Extra spaces, and quotes or bold around the whole part, go. Nothing inside is changed. */
function clean(v: string): string {
  let t = v.replace(/\s+/g, ' ').trim();
  const m = t.match(/^(\*\*|`|"|“)(.+)(\*\*|`|"|”)$/);
  if (m && (m[1] === '“' ? '”' : m[1]) === m[3] && !m[2].includes(m[1])) t = m[2].trim();
  return t;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

interface Context {
  board: string; boardCode: string | null;
  class: number | null;
  subject: string; subjectCode: string | null;
  chapter_no: number | null; chapter: string;
  topic_no: number | null; topic: string;
  /** The lines that set each detail, so a problem there is a problem for the questions under it. */
  boardLine: number; classLine: number; subjectLine: number; chapterLine: number; topicLine: number;
}

interface Block {
  line: number;
  end: number;
  q: string;
  a?: { v: string; line: number };
  also: { v: string; line: number }[];
  fill?: { v: string; line: number };
  wrong?: { v: string[]; line: number };
  level?: { v: string; line: number };
  ctx: Context;
}

export function format(raw: string): { rows: Row[]; issues: Issue[] } {
  const rows: Row[] = [];
  const issues: Issue[] = [];
  const ctx: Context = {
    board: '', boardCode: null, class: null, subject: '', subjectCode: null, chapter_no: null, chapter: '', topic_no: null, topic: '',
    boardLine: 0, classLine: 0, subjectLine: 0, chapterLine: 0, topicLine: 0,
  };
  const topicNos = new Map<string, number>(); // chapter + topic name → number, for topics written without one
  const topicMax = new Map<string, number>();
  const perTopic = new Map<string, number>();
  const perChapter = new Map<string, number>();
  const seen = new Map<string, number>();
  const names = new Map<string, { name: string; line: number }>(); // chapter or topic ID → the name it was first given
  const once = new Set<string>();
  const lastSet: Partial<Record<MetaKey, { line: number; used: boolean }>> = {};
  let block: Block | null = null;
  /** A blank line since the block's last line: a loose line after it is not part of that question. */
  let gap = false;

  const issue = (line: number, level: Level, text: string, fix?: string) => { issues.push(fix ? { line, level, text, fix } : { line, level, text }); };
  const err = (line: number, text: string, fix?: string) => issue(line, 'error', text, fix);
  const warnOnce = (id: string, line: number, text: string, level: Level = 'warn') => {
    if (once.has(id)) return;
    once.add(id);
    issue(line, level, text);
  };

  /** Checks a detail line and returns what it changes. */
  const detail = (key: Exclude<MetaKey, 'difficulty'>, v: string, line: number): Partial<Context> => {
    const say = (p?: Problem) => p && warnOnce(`${key}\u0000${line}`, line, p.text, p.level);
    if (key === 'board') { const b = checkBoard(v); say(b.problem); return { board: b.name, boardCode: b.code, boardLine: line }; }
    if (key === 'class') { const c = checkClass(v); say(c.problem); return { class: c.value, classLine: line }; }
    if (key === 'subject') { const s = checkSubject(v); say(s.problem); return { subject: s.name, subjectCode: s.code, subjectLine: line }; }
    const c = checkNumbered(v, key);
    say(c.problem);
    return key === 'chapter'
      ? { chapter_no: c.no, chapter: c.name, chapterLine: line, topic_no: null, topic: '', topicLine: 0 } // a new chapter starts with no topic
      : { topic_no: c.no, topic: c.name, topicLine: line };
  };

  const setMeta = (key: Exclude<MetaKey, 'difficulty'>, value: string, line: number) => {
    const prev = lastSet[key];
    if (prev && !prev.used) {
      issue(prev.line, 'warn', key === 'topic' ? 'No questions under this topic.' : `Not used: ${key[0].toUpperCase()}${key.slice(1)} is set again on line ${line} before any question.`);
    }
    if (key === 'chapter' && lastSet.topic && !lastSet.topic.used) issue(lastSet.topic.line, 'warn', 'No questions under this topic.');
    lastSet[key] = { line, used: false };
    if (key === 'chapter') delete lastSet.topic;
    Object.assign(ctx, detail(key, value, line));
  };

  /** Every check of one question; then its row. */
  const finish = (b: Block) => {
    const c = b.ctx;
    const q = b.q;
    const a = b.a?.v ?? '';
    const aLine = b.a?.line ?? b.line;
    const also = b.also.map((x) => x.v);
    const it = { answer: a, also };
    const trueFalse = isTrueFalse(a);

    // the question
    if (!q) err(b.line, 'The question is empty. Write it after Q:.', 'Write the question after Q:.');
    if (q.length > MAX_QUESTION) err(b.line, `The question is longer than ${MAX_QUESTION} characters. Make it shorter.`, `Shorten the question to at most ${MAX_QUESTION} characters.`);
    for (const [text, line, what] of [[q, b.line, 'question'], [b.fill?.v ?? '', b.fill?.line ?? 0, 'Fill: sentence']] as const) {
      if (!text) continue;
      const which = what === 'question' ? 'Ask it' : 'Write the Fill sentence';
      const leans = text.match(NEEDS_MORE)?.[0];
      if (leans) err(line, `The ${what} must make sense on its own: no "of the following", "which of these", "the above" or "given below". The options appear only in multiple choice, so ask it directly.`, `${which} directly, without "${leans}".`);
      if (NEEDS_PICTURE.test(text)) err(line, `The ${what} can't use a figure, diagram, map, table or passage: the games show only text.`, `${which} so that it needs no figure, diagram, map, table or passage.`);
    }
    if (TRUE_FALSE_ASK.test(q)) err(b.line, 'Write only the statement after Q:. "A: True" or "A: False" says the rest.', 'Write only the statement after Q:, without "True or false".');
    if (blanks(q) > 1) err(b.line, 'Only one ___ in a question.', 'Keep at most one ___ in the question.');

    // the answer
    const yesNo = /^(yes|no)$/i.test(a);
    if (!b.a) err(b.line, NO_ANSWER, 'Add the A: line with the answer.');
    else if (!a) err(aLine, 'The answer is empty. Write it after A:.', 'Write the answer after A:.');
    else if (!hasContent(a)) err(aLine, 'The answer has no letters or digits.', 'Write the answer in letters or digits.');
    else {
      if (a.length > MAX_ANSWER) err(aLine, `The answer is longer than ${MAX_ANSWER} characters. Answers must be short.`, `Shorten the answer to at most ${MAX_ANSWER_WORDS} words, and put the rest in the question.`);
      else if (words(a) > MAX_ANSWER_WORDS) err(aLine, `The answer has ${words(a)} words. Answers must be short: at most ${MAX_ANSWER_WORDS} words. Put the rest in the question.`, `Shorten the answer to at most ${MAX_ANSWER_WORDS} words, and put the rest in the question.`);
      if (yesNo) err(aLine, 'Yes or No can\'t be an answer. Write a statement after Q: and "A: True" or "A: False".', 'Turn it into a statement, with A: True or A: False (and no Also, Fill or Wrong lines).');
      if (/\s\/\s/.test(a)) {
        const [first, ...rest] = a.split(/\s\/\s/);
        err(aLine, 'Write one answer after A:, and each other answer that counts on its own Also: line.', `Keep "${first}" on the A: line and put ${rest.map((x) => `"${x}"`).join(', ')} on ${rest.length > 1 ? 'their own Also: lines' : 'an Also: line'}.`);
      }
      const bracket = a.match(BRACKETED)?.[1];
      if (bracket) {
        const note = /^[([]\s*(approx|about|nearly|roughly|e\.\s?g|i\.\s?e|etc|in\s|see\s|note)/i.test(bracket);
        err(aLine, "Students would have to type the brackets too. If what's in the brackets is another answer that counts, move it to an Also: line; if it is a note, leave it out.",
          note ? `Drop "${bracket}" from the answer.` : `Take "${bracket}" out of the answer: put it on an Also: line if it is another right answer, or drop it if it is a note.`);
      }
      if (blanks(a)) err(aLine, 'No ___ in the answer. The ___ goes in the Fill: sentence.', 'Take the ___ out of the answer.');
      if (!TYPEABLE.test(a) && !also.some((x) => TYPEABLE.test(x))) {
        if (NUMBER_AND_UNIT.test(a.replace(BRACKETED, '').trim())) {
          const unit = /²/.test(a) ? 'square metres' : /³/.test(a) ? 'cubic centimetres' : /[°℃℉]/.test(a) ? 'degrees Celsius' : 'ohms';
          err(aLine, `Students can't type "${untypeable(a)}" on most keyboards. Put the unit in the question ("…, in ${unit}") and write the answer as the number alone.`, `Put the unit in the question (for example "…, in ${unit}") and make the answer the number alone.`);
        } else {
          err(aLine, `Students can't type "${untypeable(a)}" on most keyboards. Add an Also: line with the answer written using ordinary keys, such as x^2 for x² or sqrt 3 for √3.`, `Add an Also: line with the answer typed with ordinary keys (it has "${untypeable(a)}"; for example x^2 for x², sqrt 3 for √3).`);
        }
      }
      if (q && shows(q, it)) {
        const x = [a, ...also].find((s) => shows(q, { answer: s }));
        err(b.line, `The question shows the answer ("${x}"), so it would give it away. Rewrite the question without it.`, `Rewrite the question so that it doesn't contain "${x}".`);
      }
    }

    // other answers that count
    b.also.forEach((x, i) => {
      if (i === MAX_ALSO) err(x.line, `At most ${MAX_ALSO} Also: lines.`, `Keep at most ${MAX_ALSO} Also: lines.`);
      if (!x.v) return err(x.line, 'This Also: line is empty.', 'Remove the empty Also: line.');
      if (x.v.includes(';')) return err(x.line, 'One answer per Also: line. Put each one on its own line.', `Split "Also: ${x.v}" into one Also: line per answer.`);
      if (x.v.length > MAX_ANSWER || words(x.v) > MAX_ANSWER_WORDS) return err(x.line, `This answer is too long: at most ${MAX_ANSWER_WORDS} words.`, `Shorten "Also: ${x.v}" to at most ${MAX_ANSWER_WORDS} words.`);
      if (blanks(x.v)) return err(x.line, 'No ___ in an answer.', `Take the ___ out of "Also: ${x.v}".`);
      if (a && sameAnswer(x.v, a)) return err(x.line, 'This is the same as the answer on the A: line (case, spaces and punctuation don\'t matter). Leave it out.', `Remove "Also: ${x.v}": it is the answer again (capitals, spaces and hyphens already don't count).`);
      if (also.slice(0, i).some((y) => sameAnswer(x.v, y))) return err(x.line, 'This answer is written twice.', `Remove the second "Also: ${x.v}".`);
    });

    // the fill-in sentence
    if (b.fill) {
      const f = b.fill.v;
      const n = blanks(f);
      if (trueFalse) err(b.fill.line, 'A True/False question has no Fill: line.', 'Remove the Fill: line (a True/False question has none).');
      else if (!n) err(b.fill.line, 'The Fill: sentence needs ___ (three underscores) where the answer goes.', 'Put ___ (three underscores) in the Fill sentence where the answer goes.');
      else if (n > 1) err(b.fill.line, 'Only one ___ in the Fill: sentence: it stands for the whole answer.', 'Keep exactly one ___ in the Fill sentence, standing for the whole answer.');
      else if (words(f.replace(BLANK, ' ')) < 3) err(b.fill.line, 'Write the whole sentence around the ___, so it can be answered on its own.', 'Write the Fill sentence in full around the ___.');
      else if (a && shows(f.replace(BLANK, ' '), it)) err(b.fill.line, 'The Fill: sentence shows the answer. The ___ should stand for the whole answer, and the rest of the sentence shouldn\'t repeat it.', 'Rewrite the Fill sentence so the answer appears only as the ___.');
      if (f.length > MAX_QUESTION) err(b.fill.line, `The Fill: sentence is longer than ${MAX_QUESTION} characters.`, `Shorten the Fill sentence to at most ${MAX_QUESTION} characters.`);
    } else if (q && b.a && !trueFalse && !yesNo && blanks(q) !== 1) {
      // (a Yes/No answer is to become True/False, which has no Fill line)
      issue(b.line, 'warn', NO_FILL, 'Add a Fill: line: the same fact as a sentence, with ___ where the answer goes.');
    }

    // wrong options
    if (b.wrong) {
      const ws = b.wrong.v;
      const line = b.wrong.line;
      const kind = (s: string) => (/\p{L}/u.test(s) ? 'words' : 'a number');
      const positional = ws.find((o) => POSITIONAL.test(o));
      const isAnswer = ws.find((o) => [a, ...also].some((x) => x && sameAnswer(o, x)));
      if (trueFalse) err(line, 'A True/False question needs no Wrong: line: the other of True and False is its option.', 'Remove the Wrong: line (a True/False question has none).');
      else if (ws.length < MIN_OPTIONS) err(line, `Write at least ${MIN_OPTIONS} wrong options, separated by ";".`, `Give ${MIN_OPTIONS} wrong options on the Wrong: line (it has ${ws.length}).`);
      else if (ws.length > MAX_OPTIONS) err(line, `At most ${MAX_OPTIONS} wrong options.`, `Keep at most ${MAX_OPTIONS} wrong options.`);
      else if (ws.some((o) => o.length > MAX_ANSWER || words(o) > MAX_ANSWER_WORDS)) err(line, `A wrong option is too long: at most ${MAX_ANSWER_WORDS} words, like an answer.`, `Shorten the wrong options to at most ${MAX_ANSWER_WORDS} words each.`);
      else if (ws.some((o, i) => ws.slice(0, i).some((p) => sameAnswer(o, p)))) err(line, 'The same wrong option is written twice.', 'Replace the repeated wrong option with a different one.');
      else if (isAnswer) err(line, `"${isAnswer}" counts as the answer, so it can't be a wrong option.`, `Replace the wrong option "${isAnswer}": it is a right answer.`);
      else if (positional) err(line, `"${positional}" doesn't work: the options are shuffled. Write a real option instead.`, `Replace "${positional}" with a real wrong option.`);
      // the same kind as the answer, or as one of its other answers ("Zero", also "0", with numbers as options)
      else if (a && ws.some((o) => ![a, ...also].some((x) => kind(x) === kind(o)))) err(line, `The wrong options must be the same kind as the answer: ${kind(a) === 'a number' ? 'numbers, like it' : 'words, not numbers on their own'}.`, `Make every wrong option ${kind(a) === 'a number' ? 'a number, like the answer' : 'words, like the answer, not a number on its own'}.`);
    }
    if (trueFalse && b.also.length) err(b.also[0].line, 'A True/False question has no Also: line.', 'Remove the Also: line (a True/False question has none).');

    // the level
    if (b.level && !DIFFICULTIES.includes(b.level.v.toLowerCase() as Difficulty)) err(b.level.line, 'The level must be easy, medium or hard.', `Change "Level: ${b.level.v}" to easy, medium or hard.`);

    // where it goes, how many, and repeats
    const cid = chapterId(c.boardCode, c.class, c.subjectCode, c.chapter_no);
    const chapterKey = cid ?? [c.board, c.class, c.subject, c.chapter_no, c.chapter].join('\u0000').toLowerCase();
    if (q) {
      const dupKey = `${chapterKey}\u0001${q.toLowerCase()}`;
      const earlier = seen.get(dupKey);
      if (earlier) err(b.line, `Same question as line ${earlier}. Leave one of them out.`, 'Remove this question: it is written twice in the chapter.');
      else seen.set(dupKey, b.line);
    }
    for (const k of Object.keys(lastSet) as MetaKey[]) lastSet[k]!.used = true;

    let topicNo = c.topic_no;
    if (topicNo === null && c.topic) {
      const nameKey = `${chapterKey}\u0001${c.topic.toLowerCase()}`;
      topicNo = topicNos.get(nameKey) ?? (topicMax.get(chapterKey) ?? 0) + 1;
      topicNos.set(nameKey, topicNo);
    }
    if (topicNo !== null) topicMax.set(chapterKey, Math.max(topicMax.get(chapterKey) ?? 0, topicNo));
    const tid = topicId(cid, topicNo);

    // the same ID must not mean two different chapters or topics
    for (const [id, name, at, what] of [[cid, c.chapter, c.chapterLine || b.line, 'Chapter'], [tid, c.topic, c.topicLine || b.line, 'Topic']] as const) {
      if (!id || !name) continue;
      const first = names.get(id);
      if (!first) names.set(id, { name, line: at });
      else if (first.name.toLowerCase() !== name.toLowerCase()) {
        warnOnce(`name\u0000${id}\u0000${name}`, at, `${what} ID ${id} is already "${first.name}" (line ${first.line}). Check the ${what.toLowerCase()} number.`);
      }
    }
    const bc = boardClassProblem(c.boardCode, c.class);
    if (bc) warnOnce(`bc\u0000${c.boardCode}\u0000${c.class}`, c.boardLine || b.line, bc);

    const topicKey = `${chapterKey}\u0001${topicNo ?? ''}`;
    const n = (perTopic.get(topicKey) ?? 0) + 1;
    perTopic.set(topicKey, n);
    const inChapter = (perChapter.get(chapterKey) ?? 0) + 1;
    perChapter.set(chapterKey, inChapter);
    const over = (what: string, most: number) => `Remove this question: ${what} can have at most ${most} questions.`;
    if (topicNo !== null && n === MAX_PER_TOPIC + 1) err(b.line, `Topic ${topicNo} has more than ${MAX_PER_TOPIC} questions from here on: at most ${MAX_PER_TOPIC} per topic.`, over(`topic ${topicNo}`, MAX_PER_TOPIC));
    else if (topicNo !== null && n > MAX_PER_TOPIC) err(b.line, `More than ${MAX_PER_TOPIC} questions in topic ${topicNo}.`, over(`topic ${topicNo}`, MAX_PER_TOPIC));
    if (inChapter === MAX_PER_CHAPTER + 1) err(b.line, `The chapter has more than ${MAX_PER_CHAPTER} questions from here on: at most ${MAX_PER_CHAPTER} per chapter.`, over('the chapter', MAX_PER_CHAPTER));
    else if (inChapter > MAX_PER_CHAPTER) err(b.line, `More than ${MAX_PER_CHAPTER} questions in this chapter.`, over('the chapter', MAX_PER_CHAPTER));

    const level = b.level?.v.toLowerCase() as Difficulty | undefined;
    rows.push({
      chapter_id: cid, topic_id: tid, board: c.board, class: c.class, subject: c.subject, chapter_no: c.chapter_no, chapter: c.chapter,
      topic_no: topicNo, topic: c.topic, question_no: n, question: q, answer: a, also, fill: b.fill?.v ?? null,
      wrong_options: b.wrong?.v ?? [], difficulty: level && DIFFICULTIES.includes(level) ? level : null,
      line: b.line, end: b.end, under: [c.boardLine, c.classLine, c.subjectLine, c.chapterLine, c.topicLine].filter(Boolean),
    });
  };

  const close = () => {
    if (block) finish(block);
    block = null;
  };

  raw.split(/\r?\n/).forEach((text, i) => {
    const line = i + 1;
    const t = text.trim();
    if (!t) { gap = true; return; }
    if (/^(```|~~~)/.test(t)) return; // a chatbot's code fence

    const label = readLabel(t);
    if (label) {
      gap = false;
      if (label.key === 'q') {
        close();
        block = { line, end: line, q: label.value, also: [], ctx: { ...ctx } };
        return;
      }
      if (!block) return err(line, `This ${LABEL_NAME[label.key]} line has no Q: line above it. Each question starts with Q:.`, 'Give it the Q: line it belongs to, or remove it.');
      block.end = line;
      const v = label.value;
      if (label.key === 'also') return void block.also.push({ v, line });
      if (block[label.key]) {
        return err(line, `This question already has a ${LABEL_NAME[label.key]} line${label.key === 'wrong' ? ': put all the wrong options on one line, separated by ";"' : ''}. Leave one out.`,
          label.key === 'wrong' ? 'Put all the wrong options on one Wrong: line, separated by ";".' : `Keep one ${LABEL_NAME[label.key]} line.`);
      }
      if (label.key === 'a') block.a = { v, line };
      else if (label.key === 'fill') block.fill = { v, line };
      else if (label.key === 'level') block.level = { v, line };
      else block.wrong = { v: v.split(';').map(clean).filter(Boolean), line };
      return;
    }

    const meta = readMeta(t);
    if (meta && meta.key !== 'difficulty') {
      close();
      return setMeta(meta.key, meta.value, line);
    }
    const near = nearLabel(t);
    // a loose line right under a question is part of it; after a blank line it stands on its own
    if (gap) close();
    if (block) block.end = line;
    if (meta?.key === 'difficulty' || near === 'level') return err(line, 'Write the level under each question, as Level: easy (or medium, or hard).', 'Remove this line, and put a Level: line in each question instead.');
    if (near) return err(line, `Write this label as ${LABEL_NAME[near]} (with a colon).`, `Write the label as ${LABEL_NAME[near]}`);
    if (/^\(?[a-dA-D][.)]\s+\S/.test(t)) {
      return err(line, 'Don\'t list options as a), b), c). Write the wrong options on one Wrong: line, separated by ";" (the answer is on the A: line).',
        `Replace "${t}" with one Wrong: line of ${MIN_OPTIONS} wrong options, separated by ";".`);
    }
    if (/^#{1,6}\s/.test(t)) return err(line, 'Headings aren\'t read. Write it as "Topic 2: Name" or "Chapter 1: Name", or leave it out.', 'Remove the heading, or write it as "Topic 2: Name".');
    if (/\s\|\s|\t/.test(t)) {
      issues.push({ line, level: 'error', text: 'Write each question as a block: Q: and the question on one line, A: and the answer on the next, then its Fill:, Wrong: and Level: lines.', fix: 'Write it as a full block: Q, A, Fill, Wrong and Level lines.', oneLine: true });
      return;
    }
    if (block) return err(line, 'This line isn\'t part of the question. Start it with A:, Also:, Fill:, Wrong: or Level:, or start a new question with Q:. A question or answer must fit on one line.', `Remove the line "${t}", or start it with its label (A:, Also:, Fill:, Wrong: or Level:).`);
    err(line, 'Start each question with Q:, and its answer on the next line with A:.', 'Remove this line, or write it as a question block.');
  });
  close();

  issues.sort((x, y) => x.line - y.line);
  return { rows, issues };
}

/** Questions missing a detail the question bank needs. */
export function missing(rows: Row[]): { board: number; class: number; subject: number; chapter: number; topic: number; id: number } {
  return {
    board: rows.filter((r) => !r.board).length,
    class: rows.filter((r) => r.class === null).length,
    subject: rows.filter((r) => !r.subject).length,
    chapter: rows.filter((r) => r.chapter_no === null).length,
    topic: rows.filter((r) => !r.topic && r.topic_no === null).length,
    id: rows.filter((r) => !r.chapter_id).length,
  };
}

/** The lines a question covers, from its Q: line to its last line. */
const span = (r: Row) => [r.line, r.end ?? r.line] as const;

/**
 * The problems to show right now. People get to finish writing first: nothing is flagged on the line being typed, nor
 * what a question is still missing (its A: or Fill: line) while the cursor is in it or just below it, nor on the line a
 * detail box is writing while someone types in that box. Those appear once the cursor moves on. A fix still clears at once.
 */
export function visibleIssues(issues: Issue[], quiet: { caret?: number | null; line?: number | null }, rows: Row[] = []): Issue[] {
  const { caret, line } = quiet;
  const writing = caret ? rows.find((r) => caret >= span(r)[0] && caret <= span(r)[1] + 1) : undefined;
  return issues.filter((x) => !(caret && x.line === caret) && x.line !== line
    && !(writing && x.line === writing.line && (x.text === NO_ANSWER || x.text === NO_FILL)));
}

/** The worst problem on each line: what the editor underlines. */
export function lineLevels(issues: Issue[]): Map<number, Level> {
  const out = new Map<number, Level>();
  for (const x of issues) if (out.get(x.line) !== 'error') out.set(x.line, x.level);
  return out;
}

/**
 * Each question's problems: those on its own lines, and those on the detail lines it is under. Questions not in the map
 * have none. `general`: problems on no question's lines (a stray line, a topic with no questions).
 */
export function problemsByRow(rows: Row[], issues: Issue[]): { byRow: Map<number, Issue[]>; general: Issue[] } {
  const byRow = new Map<number, Issue[]>();
  const used = new Set<Issue>();
  rows.forEach((r, i) => {
    const [from, to] = span(r);
    const mine = issues.filter((x) => (x.line >= from && x.line <= to) || r.under?.includes(x.line));
    mine.forEach((x) => used.add(x));
    if (mine.length) byRow.set(i, mine);
  });
  return { byRow, general: issues.filter((x) => !used.has(x)) };
}

type Written = Pick<Row, 'board' | 'class' | 'subject' | 'chapter_no' | 'chapter' | 'topic_no' | 'topic' | 'question' | 'answer' | 'difficulty'> & Partial<Pick<Row, 'also' | 'fill' | 'wrong_options'>>;

/** One question as its block of lines. */
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

/**
 * Rows written back in the one format: a detail line whenever a detail changes, a Topic line for each topic, then each
 * question's block, with a blank line between. Reading the text again gives the same rows. "Fix it" uses it to put a
 * question that was sent back into the Questions box.
 */
export function asText(rows: Written[]): string {
  const out: string[] = [];
  const last: Partial<Record<'board' | 'class' | 'subject' | 'chapter' | 'topic', string>> = {};
  const put = (k: keyof typeof last, line: string, force = false) => {
    if (!force && last[k] === line) return;
    out.push(line);
    last[k] = line;
  };
  for (const r of rows) {
    if (r.board) put('board', `Board: ${r.board}`);
    if (r.class !== null) put('class', `Class: ${r.class}`);
    if (r.subject) put('subject', `Subject: ${r.subject}`);
    const topic = r.topic ? (r.topic_no !== null ? `Topic ${r.topic_no}: ${r.topic}` : `Topic: ${r.topic}`) : '';
    // a Chapter line also ends the topic above it, so it is written again for a question without a topic
    const chapter = r.chapter_no !== null ? `Chapter ${r.chapter_no}: ${r.chapter}` : `Chapter: ${r.chapter}`;
    if (last.chapter !== chapter || (!topic && last.topic)) { put('chapter', chapter, true); delete last.topic; }
    if (topic) put('topic', topic);
    out.push('', blockOf(r));
  }
  return out.join('\n') + '\n';
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** File name: the chapter ID and name when everything is one chapter ("CBSE10SCI01-chemical-reactions"), else the subject. */
export function baseName(rows: Row[]): string {
  const first = rows[0];
  if (!first) return 'questions';
  const one = rows.every((r) => r.chapter_id === first.chapter_id && r.chapter === first.chapter);
  const name = one && first.chapter_id ? [first.chapter_id, slug(first.chapter)].filter(Boolean).join('-') : [slug(first.subject), 'questions'].filter(Boolean).join('-');
  return name.slice(0, 80).replace(/-$/, '');
}

/** "Try an example": a short chapter in the format, every part used, and one mistake of each colour to show the marks. */
export const EXAMPLE = `Board: CBSE
Class: 10
Subject: Science
Chapter 1: Chemical Reactions and Equations

Topic 1: Chemical Equations

Q: Law which says that mass can neither be created nor destroyed in a chemical reaction
A: Law of conservation of mass
Fill: A chemical equation is balanced because of the ___.
Wrong: Law of definite proportions; Law of multiple proportions; Avogadro's law
Level: medium

Q: An equation with the same number of atoms of each element on both sides
A: Balanced equation
Fill: An equation with the same number of atoms of each element on both sides is called a ___.
Wrong: Skeletal equation; Word equation; Ionic equation

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
Wrong: Oxygen; Chlorine; Nitrogen

Q: Rusting of iron is a chemical change
A: True

Q: Which of the following is a combination reaction?
A: Burning of magnesium
`;
