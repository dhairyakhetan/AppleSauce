/**
 * Boards, classes, subjects, chapter and topic names, IDs and detail lines (details.ts): what the Chapters page, Bulk
 * add and the Write questions page's check of Board/Chapter/Topic lines rely on.
 */
import { describe, expect, it } from 'vitest';
import { ALL_BOARDS, chapterId, checkBoard, checkClass, checkSubject, parseNumbered, readMeta, SUBJECTS, titleCase } from './details';

describe('capitalising names', () => {
  it('capitalises each word, keeps joining words small, and leaves acronyms, formulas and other scripts alone', () => {
    expect(titleCase('chemical reactions and equations')).toBe('Chemical Reactions and Equations');
    expect(titleCase('the french revolution')).toBe('The French Revolution');
    expect(titleCase('light: reflection and refraction')).toBe('Light: Reflection and Refraction');
    expect(titleCase('light – the nature of light')).toBe('Light – The Nature of Light');
    expect(titleCase('acid-base indicators')).toBe('Acid-Base Indicators');
    expect(titleCase('newton’s laws of motion')).toBe('Newton’s Laws of Motion');
    expect(titleCase('the pH scale and DNA')).toBe('The pH Scale and DNA');
    expect(titleCase('co2 in the air')).toBe('co2 in the Air');
    expect(titleCase('part ii: x-rays')).toBe('Part II: X-Rays');
    expect(titleCase('रासायनिक अभिक्रियाएँ')).toBe('रासायनिक अभिक्रियाएँ');
  });
});

describe('boards', () => {
  it('knows the national boards and their other names', () => {
    expect(['cbse', 'CBSE board', 'NCERT', 'Central Board of Secondary Education'].map((b) => checkBoard(b))).toEqual(Array(4).fill({ name: 'CBSE', code: 'CBSE' }));
    expect(checkBoard('cisce')).toEqual({ name: 'ICSE', code: 'ICSE' });
    expect(checkBoard('a levels')).toEqual({ name: 'Cambridge', code: 'CAIE' });
  });

  it('knows state boards by state or by the board’s own name', () => {
    for (const b of ['Maharashtra', 'maharashtra state board', 'MSBSHSE', 'State Board (Maharashtra)']) expect(checkBoard(b)).toEqual({ name: 'Maharashtra State Board', code: 'MH' });
    expect(checkBoard('UP Board')).toEqual({ name: 'Uttar Pradesh State Board', code: 'UP' });
    expect(checkBoard('Jammu & Kashmir')).toEqual({ name: 'Jammu and Kashmir State Board', code: 'JK' });
    expect(checkBoard('samacheer kalvi').code).toBe('TN');
  });

  it('knows a state\'s board written its own way, and its open school, madrasa and Sanskrit boards', () => {
    for (const b of ['Bihar School Examination Board', 'UP Board of High School & Intermediate Education', 'Kerala Board of Public Examination', 'Karnataka Pre-University Board', 'Kerala syllabus']) {
      expect(checkBoard(b).problem, b).toBeUndefined();
    }
    expect(checkBoard('Bihar madrasa board')).toEqual({ name: 'Bihar State Madrasa Education Board', code: 'BSMEB' });
    expect(checkBoard('UP Sanskrit board').code).toBe('UPSSP');
    expect(checkBoard('MP open school').code).toBe('MPSOS');
    expect(checkBoard('Edexcel IGCSE')).toEqual({ name: 'Edexcel', code: 'EDEX' });
  });

  it('refuses anything not on the list, with a message: typos, schools, made-up boards, a bare "state board"', () => {
    expect(checkBoard('cbsc').problem).toEqual({ level: 'error', text: 'Did you mean CBSE?' });
    expect(checkBoard('maharastra').problem?.text).toBe('Did you mean Maharashtra State Board?');
    expect(checkBoard('State board').problem).toEqual({ level: 'error', text: 'Which state? For example: Maharashtra State Board.' });
    expect(checkBoard('Sikkim').problem?.text).toBe('Sikkim has no school board of its own. Write the board the school follows, such as CBSE.');
    for (const b of ['Delhi Public School', 'Assam Rifles Public School', 'Indian Baccalaureate', 'Kendriya Vidyalaya', 'Xavier Board of Studies']) {
      expect(checkBoard(b), b).toMatchObject({ code: null, problem: { level: 'error', text: `"${b}" isn't a board on this site's list. Write the board the textbook is for, such as CBSE, ICSE or Maharashtra State Board. The guide lists them all.` } });
    }
    expect(checkBoard('').problem).toBeUndefined();
  });

  it('has unique codes and names', () => {
    const codes = ALL_BOARDS.map((b) => b.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^[A-Z]{2,5}$/.test(c))).toBe(true);
    const names = ALL_BOARDS.flatMap((b) => [b.name.toLowerCase(), ...b.also]);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
    for (const b of ALL_BOARDS) expect(checkBoard(b.name), b.name).toEqual({ name: b.name, code: b.code });
  });
});

describe('classes', () => {
  it('reads numbers, ordinals, labels and Roman numerals', () => {
    expect(['10', '10th', '10 th', 'Class 10', 'X', 'x', 'Std. 8', 'Grade: 7', 'XII', 'i'].map((c) => checkClass(c).value)).toEqual([10, 10, 10, 10, 10, 10, 8, 7, 12, 1]);
  });

  it('rejects anything outside 1 to 12', () => {
    for (const c of ['0', '13', 'nursery', '11-12', '10.5']) expect(checkClass(c).problem?.level, c).toBe('error');
    expect(checkClass('')).toEqual({ value: null });
  });
});

describe('subjects', () => {
  it('knows subjects and short names, and gives each a unique three-letter code', () => {
    expect(checkSubject('maths')).toEqual({ name: 'Mathematics', code: 'MAT' });
    expect(checkSubject('Chem')).toEqual({ name: 'Chemistry', code: 'CHE' });
    expect(checkSubject('history & civics')).toEqual({ name: 'History & Civics', code: 'HCV' });
    const codes = SUBJECTS.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^[A-Z]{3}$/.test(c))).toBe(true);
  });

  it('refuses a subject not on the list, suggesting the one meant', () => {
    expect(checkSubject('Phisics').problem).toEqual({ level: 'error', text: 'Did you mean Physics?' });
    expect(checkSubject('Artificial Inteligence').problem?.text).toBe('Did you mean Artificial Intelligence?');
    for (const x of ['Astronomy', 'Biochemistry', 'Science (Physics)']) {
      expect(checkSubject(x), x).toMatchObject({ code: null, problem: { level: 'error', text: `"${x}" isn't a subject on this site's list. Write the textbook's subject, such as Science or Mathematics. The guide lists them all.` } });
    }
    expect(checkSubject('हिंदी')).toEqual({ name: 'Hindi', code: 'HIN' });
    expect(checkSubject('Hindi Course B').code).toBe('HIN');
    expect(checkSubject('Kathak').code).toBe('DAN');
    const names = SUBJECTS.flatMap((x) => [x.name.toLowerCase(), ...x.also]);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });
});

describe('chapters, topics and IDs', () => {
  it('reads a number and a name in any common style', () => {
    expect(['10: Light', 'Chapter 10 - Light', '10. Light', 'Ch. 10 Light', 'Light', '10'].map((c) => parseNumbered(c, 'chapter'))).toEqual([
      { no: 10, name: 'Light' }, { no: 10, name: 'Light' }, { no: 10, name: 'Light' }, { no: 10, name: 'Light' }, { no: null, name: 'Light' }, { no: 10, name: '' },
    ]);
    expect(parseNumbered('10.3 Lenses', 'topic')).toEqual({ no: 3, name: 'Lenses' });
    expect(parseNumbered('10.3 Lenses', 'chapter').no).toBe(10);
  });

  it('builds short IDs that sort by board, class, subject and chapter', () => {
    expect(chapterId('CBSE', 11, 'CHE', 1)).toBe('CBSE11CHE01');
    expect(chapterId('MH', 9, 'SCI', 12)).toBe('MH09SCI12');
    expect(chapterId('CBSE', null, 'CHE', 1)).toBeNull();
    const ids = [chapterId('CBSE', 9, 'SCI', 2), chapterId('CBSE', 10, 'SCI', 1), chapterId('CBSE', 9, 'SCI', 10)];
    expect([...ids].sort()).toEqual([chapterId('CBSE', 9, 'SCI', 2), chapterId('CBSE', 9, 'SCI', 10), chapterId('CBSE', 10, 'SCI', 1)]);
  });

  it('recognises detail lines but not sentences', () => {
    expect(readMeta('**Class:** 10')).toEqual({ key: 'class', value: '10' });
    expect(readMeta('## Topic 2 - Indicators')).toEqual({ key: 'topic', value: '2 - Indicators' });
    expect(readMeta('Ch. 3: Acids')).toEqual({ key: 'chapter', value: '3: Acids' });
    expect(readMeta('Class XI')).toEqual({ key: 'class', value: 'XI' });
    expect(readMeta('Board: Computer ')).toEqual({ key: 'board', value: 'Computer ' }); // spaces kept while typing
    for (const s of ['Class of compounds', 'Chapters are long', 'Topic', 'Board games | fun', 'Section of a cell']) expect(readMeta(s), s).toBeNull();
  });
});
