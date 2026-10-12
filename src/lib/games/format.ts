/**
 * Turns questions and answers pasted in almost any shape into flat rows for a database:
 * one row per question, tagged with board, class, subject, chapter and topic, and linked to its chapter and topic by ID.
 *
 * Accepted shapes, mixed freely: "Question | Answer" lines (an optional third part is the difficulty),
 * tab-separated cells copied from a spreadsheet, Markdown tables, CSV with a header row,
 * numbered or bulleted lists, "Q: ... Ans: ...", a question line followed by an answer line,
 * and "question? answer", "question = answer" or "question - answer".
 * Lines such as "Chapter 1: Acids" or "Topic 2: Indicators" set the details for the questions below them.
 *
 * Questions and answers are never reworded: only numbering, labels, bullets, Markdown markers and extra spaces go.
 * Names of boards, subjects, chapters and topics are written the standard way (CBSE, Chemistry, "Acids, Bases and Salts").
 * Every problem is reported with its line number: an error means the line was left out, a warning means "check this".
 */
import {
  boardClassProblem, chapterId, checkBoard, checkClass, checkNumbered, checkSubject, MAX_NO, plainLine, readMeta, topicId,
  tidy, type Level, type MetaKey, type Problem,
} from './details';
import { type Difficulty, type Row } from './rows';

export const MAX_QUESTION = 300;
export const MAX_ANSWER = 100;

export interface Issue { line: number; level: Level; text: string }

interface Context {
  board: string; boardCode: string | null;
  class: number | null;
  subject: string; subjectCode: string | null;
  chapter_no: number | null; chapter: string;
  topic_no: number | null; topic: string;
  difficulty: Difficulty | null;
  /** Lines that set the board, chapter and topic, for pointing at them in warnings. */
  boardLine: number; chapterLine: number; topicLine: number;
}

/** `extra`: a part after the answer that is the difficulty if it reads as one, else the wrong options. */
type Field = 'board' | 'class' | 'subject' | 'chapter' | 'chapter_no' | 'topic' | 'topic_no' | 'difficulty' | 'question' | 'answer' | 'options' | 'extra' | 'skip';

/** Multiple choice: at most this many wrong options, separated by ";". */
export const MAX_OPTIONS = 5;
/** Options that stop making sense once the options are shuffled. */
const POSITIONAL = /^(?:all|none|both|neither)\b.*\b(?:above|these|of them|a and b|options?)\b|^(?:both|neither)\s+\(?[a-d]\)?\s+(?:and|nor)\s+\(?[a-d]\)?$/i;

const DIFF: Record<string, Difficulty> = {
  easy: 'easy', e: 'easy', '1': 'easy', low: 'easy', simple: 'easy', basic: 'easy',
  medium: 'medium', med: 'medium', m: 'medium', '2': 'medium', moderate: 'medium', average: 'medium', intermediate: 'medium',
  hard: 'hard', h: 'hard', '3': 'hard', high: 'hard', difficult: 'hard', tough: 'hard', advanced: 'hard',
};

/** '' → null, a known word → the difficulty, anything else → undefined. */
function toDifficulty(s: string): Difficulty | null | undefined {
  const t = tidy(s).toLowerCase();
  return t ? DIFF[t] : null;
}

const HEADERS: Record<string, Field> = {
  question: 'question', questions: 'question', q: 'question', prompt: 'question', clue: 'question',
  answer: 'answer', answers: 'answer', a: 'answer', ans: 'answer',
  board: 'board', class: 'class', grade: 'class', std: 'class', standard: 'class', cls: 'class',
  subject: 'subject', chapter: 'chapter', 'chapter name': 'chapter', lesson: 'chapter',
  'chapter no': 'chapter_no', 'chapter number': 'chapter_no', 'ch no': 'chapter_no',
  topic: 'topic', 'topic name': 'topic', 'topic no': 'topic_no', 'topic number': 'topic_no',
  difficulty: 'difficulty', level: 'difficulty',
  options: 'options', 'wrong options': 'options', 'wrong answers': 'options', choices: 'options', distractors: 'options', 'incorrect options': 'options',
  '#': 'skip', no: 'skip', 'sl no': 'skip', 's no': 'skip', sr: 'skip', 'sr no': 'skip', 'question no': 'skip', 'q no': 'skip',
  'chapter id': 'skip', 'topic id': 'skip', id: 'skip',
};
const headerField = (cell: string): Field | undefined => HEADERS[tidy(cell).toLowerCase().replace(/[_.\s]+/g, ' ').trim()];

const BULLET = /^[-*•▪◦·]\s+/;
const NUMBER = /^(?:\(\d{1,3}\)|\[\d{1,3}\]|\d{1,3}[.):\]]|\d{1,3}\s+[-–])\s+/;
const QPREFIX = /^q(?:ues(?:tion)?)?\s*(?:\.?\s*\d{1,3}\s*[.):\-–]?|[.):\-–])\s*/i;
const APREFIX = /^(?:ans(?:wer)?\s*(?:\.?\s*\d{1,3}\s*[.):\-–]?|[.):\-–])\s*|a\s*[.):\-–]\s+)/i;
const INLINE_ANS = /^(.*?\S)\s+(?:ans(?:wer)?\s*(?:[.):\-–—]\s*)|→|->|=>)\s*(.+)$/i;

/** Removes bullets, numbering and a "Q." label. */
function stripLead(s: string): { body: string; hadQ: boolean } {
  let t = s.replace(BULLET, '').replace(NUMBER, '').trim() || s.trim();
  const rest = t.replace(QPREFIX, '').trim();
  const hadQ = rest !== t && rest !== '';
  if (hadQ) t = rest;
  return { body: t, hadQ };
}

const stripAnswerLabel = (s: string) => s.replace(/^[-–—:=]\s*/, '').replace(APREFIX, '');

/** A question and an answer from one free-form line, or null. A line ending in "?" is a question on its own. */
function splitLoose(t: string): [string, string] | null {
  let m = t.match(INLINE_ANS);
  if (m) return [m[1], m[2]];
  m = t.match(/^(.*\?)\s*(.*)$/);
  if (m) {
    const a = stripAnswerLabel(m[2]).trim();
    return a ? [m[1], a] : null;
  }
  for (const sep of [' → ', ' -> ', ' => ', ' = ']) {
    const i = t.indexOf(sep);
    if (i > 0) return [t.slice(0, i), t.slice(i + sep.length)];
  }
  m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/) ?? t.match(/^(.+?):\s+(.+)$/);
  return m ? [m[1], stripAnswerLabel(m[2])] : null;
}

function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch !== '"') cur += ch;
      else if (line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = false;
    } else if (ch === '"' && !cur.trim()) { quoted = true; cur = ''; }
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function cellsOf(line: string, delim: string): string[] {
  if (delim === ',') return csvCells(line);
  if (delim === '|') return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|');
  return line.split('\t');
}

const DEFAULT_FIELDS: Field[] = ['question', 'answer', 'extra', 'extra'];
export const NO_ANSWER = 'This question has no answer.';
const CANNOT_READ = 'Couldn\'t find a question and an answer. Put " | " between them.';

export function format(raw: string): { rows: Row[]; issues: Issue[] } {
  const rows: Row[] = [];
  const issues: Issue[] = [];
  const ctx: Context = {
    board: '', boardCode: null, class: null, subject: '', subjectCode: null,
    chapter_no: null, chapter: '', topic_no: null, topic: '', difficulty: null, boardLine: 0, chapterLine: 0, topicLine: 0,
  };
  const topicNos = new Map<string, number>(); // chapter + topic name → number, for topics written without one
  const topicMax = new Map<string, number>();
  const counts = new Map<string, number>();
  const seen = new Map<string, number>();
  const names = new Map<string, { name: string; line: number }>(); // chapter or topic ID → the name it was first given
  const once = new Set<string>();
  const headers: Record<string, Field[]> = {};
  const lastSet: Partial<Record<MetaKey, { line: number; used: boolean }>> = {};
  let pending: { q: string; line: number } | null = null;

  const issue = (line: number, level: Level, text: string) => { issues.push({ line, level, text }); };
  const warnOnce = (id: string, line: number, text: string, level: Level = 'warn') => {
    if (once.has(id)) return;
    once.add(id);
    issue(line, level, text);
  };
  const dropPending = () => {
    if (pending) issue(pending.line, 'error', NO_ANSWER);
    pending = null;
  };

  /**
   * Checks a detail and returns what it changes. A detail line reports its own problem; a table column reports each
   * distinct wrong value once (keyed by the value), not on every row.
   */
  const detail = (key: MetaKey, v: string, line: number, onceKey: string | number = line): Partial<Context> => {
    const say = (p?: Problem) => p && warnOnce(`${key}\u0000${onceKey}`, line, p.text, p.level);
    if (key === 'board') { const b = checkBoard(v); say(b.problem); return { board: b.name, boardCode: b.code, boardLine: line }; }
    if (key === 'class') { const c = checkClass(v); say(c.problem); return { class: c.value }; }
    if (key === 'subject') { const s = checkSubject(v); say(s.problem); return { subject: s.name, subjectCode: s.code }; }
    if (key === 'difficulty') {
      const d = toDifficulty(v);
      if (d !== undefined) return { difficulty: d };
      say({ level: 'warn', text: `"${tidy(v)}" is not easy, medium or hard, so no difficulty was set.` });
      return {};
    }
    const c = checkNumbered(v, key);
    say(c.problem);
    return key === 'chapter'
      ? { chapter_no: c.no, chapter: c.name, chapterLine: line, topic_no: null, topic: '', topicLine: 0 } // a new chapter starts with no topic
      : { topic_no: c.no, topic: c.name, topicLine: line };
  };

  const add = (line: number, q0: string, a0: string, over: Partial<Context> = {}, options0 = '') => {
    const q = tidy(q0);
    const a = tidy(a0);
    if (!q || !a) return issue(line, 'error', `The ${q ? 'answer' : 'question'} is empty.`);
    if (q.length > MAX_QUESTION) return issue(line, 'error', `The question is longer than ${MAX_QUESTION} characters.`);
    if (a.length > MAX_ANSWER) return issue(line, 'error', `The answer is longer than ${MAX_ANSWER} characters. Puzzles need short answers.`);
    // multiple choice: the wrong options, separated by ";"
    const wrong = options0.split(';').map(tidy).filter(Boolean);
    const plain = (s: string) => s.replace(/[[\]]/g, '').replace(/[\s.!?;:,]+$/, '').replace(/\s+/g, ' ').toLowerCase();
    if (wrong.length > MAX_OPTIONS) return issue(line, 'error', `At most ${MAX_OPTIONS} wrong options. Separate them with ";".`);
    if (wrong.some((o) => o.length > MAX_ANSWER)) return issue(line, 'error', `A wrong option is longer than ${MAX_ANSWER} characters.`);
    if (wrong.some((o) => plain(o) === plain(a))) return issue(line, 'error', 'A wrong option is the same as the answer.');
    if (new Set(wrong.map(plain)).size < wrong.length) return issue(line, 'error', 'The same wrong option is written twice.');
    const positional = wrong.find((o) => POSITIONAL.test(o));
    if (positional) return issue(line, 'error', `"${positional}" doesn't work: the options are shuffled. Write a real option instead.`);
    const c = { ...ctx, ...over };
    const cid = chapterId(c.boardCode, c.class, c.subjectCode, c.chapter_no);
    const chapterKey = cid ?? [c.board, c.class, c.subject, c.chapter_no, c.chapter].join('\u0000').toLowerCase();
    const dupKey = `${chapterKey}\u0001${q.toLowerCase()}`;
    const earlier = seen.get(dupKey);
    if (earlier) return issue(line, 'error', `Same question as line ${earlier}, skipped.`);
    seen.set(dupKey, line);
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
    for (const [id, name, at, what] of [[cid, c.chapter, c.chapterLine || line, 'Chapter'], [tid, c.topic, c.topicLine || line, 'Topic']] as const) {
      if (!id || !name) continue;
      const first = names.get(id);
      if (!first) names.set(id, { name, line: at });
      else if (first.name.toLowerCase() !== name.toLowerCase()) {
        warnOnce(`name\u0000${id}\u0000${name}`, at, `${what} ID ${id} is already "${first.name}" (line ${first.line}). Check the ${what.toLowerCase()} number.`);
      }
    }
    const bc = boardClassProblem(c.boardCode, c.class);
    if (bc) warnOnce(`bc\u0000${c.boardCode}\u0000${c.class}`, c.boardLine || line, bc);

    const countKey = `${chapterKey}\u0001${topicNo ?? ''}`;
    const n = (counts.get(countKey) ?? 0) + 1;
    counts.set(countKey, n);
    rows.push({
      chapter_id: cid, topic_id: tid, board: c.board, class: c.class, subject: c.subject, chapter_no: c.chapter_no, chapter: c.chapter,
      topic_no: topicNo, topic: c.topic, question_no: n, question: q, answer: a, wrong_options: wrong, difficulty: c.difficulty, line,
    });
  };

  const ORDER: MetaKey[] = ['board', 'class', 'subject', 'chapter', 'topic', 'difficulty'];
  const fromCells = (line: number, cells: string[], fields: Field[]) => {
    if (cells.slice(fields.length).some((c) => c.trim())) return issue(line, 'error', 'This line has more parts than expected. Add a header row such as "Topic | Question | Answer".');
    const v: Partial<Record<Field, string>> = {};
    fields.forEach((f, i) => {
      if (f === 'skip' || !cells[i]?.trim()) return;
      // after the answer: the difficulty if it reads as one, else the wrong options of a multiple-choice question
      const as: Field = f !== 'extra' ? f : toDifficulty(cells[i]) !== undefined && v.difficulty === undefined ? 'difficulty' : 'options';
      if (as === 'options' && v.options !== undefined) v.options += `;${cells[i]}`;
      else v[as] = cells[i];
    });
    const over: Partial<Context> = {};
    // in a fixed order, so a chapter column clears the topic before a topic column sets it
    for (const k of ORDER) if (v[k] !== undefined) Object.assign(over, detail(k, v[k], line, k === 'difficulty' ? line : v[k]));
    for (const k of ['chapter_no', 'topic_no'] as const) {
      if (v[k] === undefined) continue;
      const no = parseInt(v[k], 10);
      if (no >= 1 && no <= MAX_NO) over[k] = no;
      else warnOnce(`${k}\u0000${v[k]}`, line, `"${tidy(v[k])}" is not a ${k === 'chapter_no' ? 'chapter' : 'topic'} number from 1 to ${MAX_NO}.`);
    }
    if (v.chapter_no !== undefined && v.topic === undefined && v.topic_no === undefined) Object.assign(over, { topic: '', topic_no: null });
    add(line, v.question ?? '', v.answer ?? '', over, v.options ?? '');
  };

  const setMeta = (key: MetaKey, value: string, line: number) => {
    const prev = lastSet[key];
    if (prev && !prev.used) {
      issue(prev.line, 'warn', key === 'topic' ? 'No questions under this topic.' : `Not used: ${key[0].toUpperCase()}${key.slice(1)} is set again on line ${line} before any question.`);
    }
    if (key === 'chapter' && lastSet.topic && !lastSet.topic.used) issue(lastSet.topic.line, 'warn', 'No questions under this topic.');
    lastSet[key] = { line, used: false };
    if (key === 'chapter') delete lastSet.topic;
    Object.assign(ctx, detail(key, value, line));
  };

  /** The line after a question on its own: it is the answer. */
  const answerPending = (a: string) => {
    const p = pending!;
    pending = null;
    add(p.line, p.q, a);
  };

  raw.split(/\r?\n/).forEach((text, i) => {
    const line = i + 1;
    const t = text.trim();
    if (!t || /^(```|~~~)/.test(t) || (/^[\s|:\-–—=*_]+$/.test(t) && /[-–—=]/.test(t))) return; // blank, code fence, divider

    const delim = t.includes('\t') ? '\t' : t.includes('|') ? '|' : t.includes(',') && headers[','] ? ',' : '';

    // details: "Chapter 1: Acids", "## Topic 2 - Indicators", "**Class:** 10"
    if (!delim || delim === ',') {
      const meta = readMeta(t);
      if (meta) {
        dropPending();
        return setMeta(meta.key, meta.value, line);
      }
      if (/^#{1,6}\s/.test(t)) {
        dropPending();
        return issue(line, 'warn', `Heading ignored. Write it as "Topic: ${plainLine(t)}" or "Chapter: ${plainLine(t)}" to use it.`);
      }
    }

    // a header row such as "Topic | Question | Answer", or "question,answer" for CSV
    const hDelim = delim || (t.includes(',') ? ',' : '');
    if (hDelim) {
      const cells = cellsOf(t, hDelim).map((c) => c.trim());
      const fields = cells.map(headerField);
      if (cells.length >= 2 && fields.includes('question') && fields.includes('answer') && fields.every((f, k) => f || !cells[k])) {
        dropPending();
        headers[hDelim] = fields.map((f) => f ?? 'skip');
        // a difficulty or wrong options may follow the named columns even when the header doesn't name them
        if (!fields.includes('difficulty') || !fields.includes('options')) headers[hDelim].push('extra', 'extra');
        return;
      }
    }

    if (delim) {
      dropPending();
      let cells = cellsOf(t, delim);
      const fields = headers[delim] ?? DEFAULT_FIELDS;
      // an unlabelled numbering column copied from a spreadsheet: "1 <tab> question <tab> answer"
      if (!headers[delim] && cells.length >= 3 && /^\s*\d{1,4}[.)]?\s*$/.test(cells[0])) cells = cells.slice(1);
      if (!headers[delim] && cells.length >= 2) cells = [stripLead(cells[0]).body, ...cells.slice(1)];
      if (cells.length < 2) return issue(line, 'error', CANNOT_READ);
      return fromCells(line, cells, fields);
    }

    const { body, hadQ } = stripLead(t);
    if (APREFIX.test(body) && !hadQ) {
      return pending ? answerPending(body.replace(APREFIX, '')) : issue(line, 'error', 'This answer has no question above it.');
    }

    const pair = splitLoose(body);
    if (pair) {
      dropPending();
      return add(line, pair[0], pair[1]);
    }
    if (/\?\s*$/.test(body) || hadQ) {
      dropPending();
      pending = { q: body, line };
      return;
    }
    if (pending) return answerPending(body);
    issue(line, 'error', CANNOT_READ);
  });
  dropPending();

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

/**
 * The problems to show right now. People get to finish writing first: nothing is flagged on the line being typed,
 * nor "no answer" on the line just above it (its answer is probably being typed), nor on the line a detail box is
 * writing while someone types in that box. Those appear once the cursor moves on. A fix still clears at once.
 */
export function visibleIssues(issues: Issue[], quiet: { caret?: number | null; line?: number | null }): Issue[] {
  const { caret, line } = quiet;
  return issues.filter((x) => !(caret && (x.line === caret || (x.line === caret - 1 && x.text === NO_ANSWER))) && x.line !== line);
}

/** The worst problem on each line: what the editor underlines. */
export function lineLevels(issues: Issue[]): Map<number, Level> {
  const out = new Map<number, Level>();
  for (const x of issues) if (out.get(x.line) !== 'error') out.set(x.line, x.level);
  return out;
}

type Written = Pick<Row, 'board' | 'class' | 'subject' | 'chapter_no' | 'chapter' | 'topic_no' | 'topic' | 'question' | 'answer' | 'difficulty'> & { wrong_options?: string[] };

/**
 * Rows written back in the one format: a detail line whenever a detail changes, a Topic line for each topic, then
 * "Question | Answer" (and the difficulty). Reading the text again gives the same rows. "Fix in the formatter" uses it
 * to put a question that was sent back into the Questions box.
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
    const wrong = r.wrong_options ?? [];
    const sep = /[|\t]/.test(r.question + r.answer + wrong.join('')) ? '\t' : ' | '; // a bar inside a part: tabs keep the parts apart
    out.push([r.question, r.answer, ...(wrong.length ? [wrong.join('; ')] : []), ...(r.difficulty ? [r.difficulty] : [])].join(sep));
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

/**
 * "Try an example": the kind of mix people paste, with lower-case names to show they get capitalised,
 * and one question without an answer to show the red underline.
 */
export const EXAMPLE = `Board: CBSE
Class: 10
Subject: Science
Chapter 1: Chemical Reactions and Equations

Topic 1: Chemical Equations
Equation with the same number of atoms of each element on both sides | Balanced equation
Law that requires a chemical equation to be balanced | Law of conservation of mass | medium

Topic 2: Types of Chemical Reactions
Reaction in which two or more reactants form a single product | Combination reaction | easy
Reaction in which a single reactant breaks down into simpler products | Decomposition reaction
Gain of oxygen by a substance during a reaction | Oxidation

Topic 3: Effects of Oxidation in Everyday Life
Common name for the corrosion of iron | Rusting
Gas filled in chip packets to keep the chips from going rancid | Nitrogen | easy
`;
