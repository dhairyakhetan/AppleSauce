/**
 * Chapters as an admin pastes them on the Chapters page (and as the starting list has them): one row per topic,
 *
 *   Board | Class | Subject | Chapter number | Chapter | Topic number | Topic
 *
 * separated by | or tabs (straight from a spreadsheet). A chapter with no topics is one row with the topic columns left
 * out or empty. A header row and lines starting with # are skipped. Each problem is on its line and says what to change;
 * nothing is added while any remains. The database checks it all again (games.admin_add_chapters).
 *
 * Pure: names are read the way the Write page reads them (details.ts), so "icse", "X" and "Maths" are ICSE, 10 and
 * Mathematics.
 */
import { checkBoard, checkClass, checkSubject } from './details';

export interface NewChapter { board: string; class: number; subject: string; chapter_no: number; name: string; topics: { topic_no: number; name: string }[] }
export interface ListProblem { line: number; text: string }

const DASH = /[–—]/;
const NUMBER = /^\d{1,2}$/;
const key = (s: string) => s.trim().replace(/[\s?.!:;,।]+$/u, '').replace(/\s+/g, ' ').toLowerCase();

export function parseList(text: string): { chapters: NewChapter[]; problems: ListProblem[] } {
  const problems: ListProblem[] = [];
  const say = (line: number, t: string) => problems.push({ line, text: t });
  const chapters = new Map<string, NewChapter & { line: number; withTopics: boolean; withoutTopics: boolean }>();

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const l = raw.trim();
    if (!l || l.startsWith('#') || /^board\s*[|\t]/i.test(l)) return;
    const cells = (l.includes('\t') ? l.split('\t') : l.split('|')).map((c) => c.trim());
    while (cells.length > 5 && !cells[cells.length - 1]) cells.pop();
    if (cells.length !== 5 && cells.length !== 7) {
      say(line, `This row has ${cells.length} columns. It needs 5 (board, class, subject, chapter number, chapter), or 7 with the topic number and topic.`);
      return;
    }
    const [b, c, s, no, name, tno, tname] = cells;
    const board = checkBoard(b);
    const cls = checkClass(c);
    const subject = checkSubject(s);
    const bad: string[] = [];
    if (!board.code) bad.push(board.problem?.text ?? `"${b}" isn't a board on the site's list.`);
    if (cls.value === null) bad.push(cls.problem?.text ?? `"${c}" isn't a class from 1 to 12.`);
    if (!subject.code) bad.push(subject.problem?.text ?? `"${s}" isn't a subject on the site's list.`);
    if (!NUMBER.test(no) || +no < 1) bad.push(`The chapter number "${no}" must be from 1 to 99.`);
    if (!name || name.length > 120) bad.push('The chapter name must be 1 to 120 characters.');
    if (DASH.test(name)) bad.push(`No dashes in a chapter name ("${name}"): use a colon or a comma.`);
    if (cells.length === 7) {
      if (!NUMBER.test(tno) || +tno < 1) bad.push(`The topic number "${tno}" must be from 1 to 99.`);
      if (!tname || tname.length > 120) bad.push('The topic name must be 1 to 120 characters.');
      if (DASH.test(tname ?? '')) bad.push(`No dashes in a topic name ("${tname}"): use a colon or a comma.`);
    }
    if (bad.length) {
      say(line, bad.join(' '));
      return;
    }

    // rows agree with each other: one name per chapter and topic, and a chapter has topics or doesn't
    const id = `${board.name}|${cls.value}|${subject.name}|${+no}`;
    let ch = chapters.get(id);
    if (ch && key(ch.name) !== key(name)) {
      say(line, `Chapter ${+no} is "${ch.name}" on line ${ch.line}, so it can't be "${name}" here.`);
      return;
    }
    const twin = [...chapters.values()].find((x) => x.board === board.name && x.class === cls.value && x.subject === subject.name && x.chapter_no !== +no && key(x.name) === key(name));
    if (twin) {
      say(line, `"${name}" is already chapter ${twin.chapter_no} (line ${twin.line}).`);
      return;
    }
    if (!ch) {
      ch = { board: board.name, class: cls.value!, subject: subject.name, chapter_no: +no, name, topics: [], line, withTopics: false, withoutTopics: false };
      chapters.set(id, ch);
    }
    if (cells.length === 5) {
      if (ch.withTopics) { say(line, `Chapter ${+no} has topics on other lines: give this row its topic too.`); return; }
      ch.withoutTopics = true;
      return;
    }
    if (ch.withoutTopics) { say(line, `Chapter ${+no} has a row without a topic: a chapter has topics on every row, or on none.`); return; }
    ch.withTopics = true;
    const same = ch.topics.find((t) => t.topic_no === +tno);
    if (same && key(same.name) !== key(tname)) { say(line, `Topic ${+tno} of chapter ${+no} is "${same.name}" above, so it can't be "${tname}" here.`); return; }
    const named = ch.topics.find((t) => t.topic_no !== +tno && key(t.name) === key(tname));
    if (named) { say(line, `"${tname}" is already topic ${named.topic_no} of chapter ${+no}.`); return; }
    if (!same) ch.topics.push({ topic_no: +tno, name: tname });
  });

  return { chapters: [...chapters.values()].map(({ line: _l, withTopics: _w, withoutTopics: _o, ...c }) => c), problems };
}
