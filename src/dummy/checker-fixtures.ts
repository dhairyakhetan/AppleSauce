/**
 * Dummy-mode fixtures for the paper checker (D75). Test builds only: reached
 * solely through the PREVIEW_TOOLS-gated lazy import in Checker.tsx, so none
 * of this reaches the live bundle (see src/lib/dummy-mode.ts).
 *
 * Every question here is MADE UP for the preview. None is copied from a real
 * paper, so nothing here is question-bank text. Each one exercises a case
 * the checker must handle: a trusted picture, no picture, a sub-part with a
 * whole-question picture, an English passage, scrambled text, a long
 * question with a table, maths, a split, and a blank row.
 */

import type { CheckerQuestion } from '@/lib/checker-api';
import type { ContextRow } from '@/lib/checker-context';

export const ENGLISH_PART_ID = 'd0000013-0000-4000-8000-000000000013';

const ENGLISH_PASSAGE = [
  'The road to the old house ran between two rows of eucalyptus trees, and Anil walked it slowly, as if the length of it might change his mind. He had last come here as a boy of nine, holding his grandfather\'s hand, and the gate had seemed as tall as a temple door. Now it came up only to his chest, its green paint peeling in long curls, one hinge rusted to the colour of tea.',
  'He stopped a few steps short and set his bag down. Somewhere behind the wall a radio was playing an old film song, thin and crackling, and a woman\'s voice was calling out the names of her hens. None of it was the silence he had rehearsed on the train. He had imagined an empty courtyard, dust, a lock. He had not imagined that anyone would still be living here.',
  'For a long time he did nothing at all. He read the faded name on the gatepost twice. He counted the crows on the wire. He thought of the letter in his pocket, soft now from being folded and unfolded, in which his aunt had written only: Come if you can, the mango tree has fruited again. It was not much of an invitation, and yet it had pulled him four hundred miles.',
  'At last a small girl appeared at the top of the steps, a plate of rice in her hands, and stared at him with perfect honesty. "Are you the one from the city?" she asked. Anil nodded, because his voice had gone somewhere he could not follow. "Then why are you standing outside?" she said. "Nobody stands outside here. Come in, the food is getting cold."',
].join('\n\n');

export const DUMMY_PAPER = '00000000-0000-4000-8000-00000000d0d0';

/** Made-up "printed page" crops, drawn as SVG so no image file ships. */
export const DUMMY_PICTURES: Record<string, string[]> = {
  'dummy/q-quadratic.png': ['4. (ii) Solve for x and verify your answer:', '        2x² − 7x + 3 = 0            [3]'],
  'dummy/q-trees_whole.png': [
    '5. Read the table and answer the questions that follow.',
    '   (a) Name the district with the most trees.      [1]',
    '   (b) Find the total number of trees planted.     [2]',
    '   (c) Which two districts planted the same number? [1]',
  ],
  // Question 5, part by part: one made-up crop per row of the whole question. Part (c) has none on purpose.
  'dummy/q-trees_stem.png': ['5. Read the table and answer the questions that follow.', '   District     Trees planted', '   North            120', '   South            120', '   East              85'],
  'dummy/q-trees_a.png': ['   (a) Name the district with the most trees.      [1]'],
  'dummy/q-trees_b.png': ['   (b) Find the total number of trees planted.     [2]'],
  // English question 2: stem, then the parts. Parts (d) and (g) have no crop of their own on purpose.
  'dummy/q-eng2_stem.png': ['2. Read the extract below carefully and answer the', '   questions that follow.'],
  'dummy/q-eng2_a.png': ['   (a) What was Anil carrying with him?             [1]'],
  'dummy/q-eng2_b.png': ['   (b) Why did the gate seem smaller now than when', '       he was nine?                                  [2]'],
  'dummy/q-eng2_c.png': ['   (c) Name two sounds Anil heard from behind the', '       wall.                                         [2]'],
  'dummy/q-eng2_e.png': ['   (e) What did the letter from his aunt say? Answer', '       in your own words.                            [2]'],
  'dummy/q-eng2_f.png': ['   (f) Why did the narrator wait at the gate for so', '       long before knocking?                         [2]'],
  'dummy/q-eng2_h.png': ['   (h) Pick out the phrase that shows how tired', '       Anil was after the long journey.              [1]'],
  'dummy/q-bank-lost.png': [
    '6. (a) State one difference between a Commercial Bank and',
    '       the Central Bank.                                [2]',
    '   (b) Name the bank that issues currency notes.        [1]',
  ],
  'dummy/q-factorise.png': ['8. Factorise compleetly: 3x^2 - 12                    [2]'],
  'dummy/q-split.png': [
    '7. State two uses of a lever in daily life.          [2]',
    '8. Define power. Give its unit.                      [2]',
  ],
  'dummy/q-long.png': [
    '9. Case study: a school garden club recorded the number of',
    '   saplings each class planted over one week.',
    '   (i) Draw a bar graph of the data.                 [2]',
    '   (ii) Which class planted the fewest?              [1]',
  ],
};

function q(partial: Partial<CheckerQuestion> & Pick<CheckerQuestion, 'id' | 'body'>): CheckerQuestion {
  return {
    paper_id: DUMMY_PAPER,
    ord: 1,
    display_number: null,
    number_path: null,
    options: null,
    marks: null,
    instructions: null,
    flag_reasons: [],
    flag_detail: null,
    source: null,
    subject: 'Mathematics',
    school: 'Dummy School',
    cls: 'X',
    exam: 'Prelims',
    year: '2025',
    version: 1,
    ...partial,
  };
}

export function dummyQuestions(): CheckerQuestion[] {
  return [
    // No trusted crop (0.41), but the pipeline knows the page: the checker is
    // shown the whole printed page as scanned (checker-page.ts), path
    // pages/<DUMMY_PAPER>/3.jpg, drawn by dummyPageDataUrl below.
    q({
      id: 'd0000000-0000-4000-8000-000000000000',
      ord: 0,
      display_number: '6',
      marks: 3,
      body: '6. Find the value of $k$ if the points $(2, 3)$, $(4, k)$ and $(6, -3)$ are collinear.',
      flag_reasons: ['snippet_unaligned', 'display_number_missing'],
      // A doubtful match: the page is shown, but with no box drawn on it. It also
      // carries the new pipeline data: the computer's first reading and its change log.
      raw_ocr: '6. Find the value of k if the points (2, 3),\n(4, k) and (6, -3) are coll1near. [3]',
      source: {
        page: 3,
        page_verified: true,
        align_score: 0.41,
        snippet_object: 'dummy/q-not-shown.png',
        dpi: 72,
        bbox: [44, 134, 552, 180],
        edit_log: [
          { kind: 'joined_lines', from: '(2, 3),\n(4, k)', to: '(2, 3), (4, k)' },
          { kind: 'fixed_ocr_word', from: 'coll1near', to: 'collinear' },
          { kind: 'moved_marks', from: '[3]', to: '' },
          { kind: 'normalised_format', from: '', to: '' },
        ],
      },
    }),
    // Lost text (PLAN_ROUND27 3.9): the words were lost, the AI transcribed the
    // page into flag_detail ("| suggestion: {...}"). The student sees that text
    // beside the picture and confirms or corrects it. Made-up text.
    q({
      id: 'd0000020-0000-4000-8000-000000000020',
      ord: 0.2,
      subject: 'Economics',
      cls: 'X',
      display_number: '6',
      marks: 3,
      version: 2,
      body: '',
      flag_reasons: ['other'],
      flag_detail: JSON.stringify({
        other:
          'AI check: disagree (flag vs fix); Sonnet fix at 0.70 | suggestion: ' +
          JSON.stringify({
            body: '6. (a) State one difference between a Commercial Bank and the Central Bank. [2]\n(b) Name the bank that issues currency notes. [1]',
          }),
      }),
      source: { page: 3, page_verified: true, snippet_object: 'dummy/q-bank-lost.png' },
    }),
    // Not Maths, no crop: the verified page is the only picture (every subject
    // shows a page now, PLAN_ROUND27 3.8).
    q({
      id: 'd0000021-0000-4000-8000-000000000021',
      ord: 0.3,
      subject: 'Geography',
      cls: 'X',
      display_number: '7',
      marks: 2,
      body: '7. A bag holds 4 red and 6 blue marbles. One is drawn at random. (i) What is the chance it is red? [1] (ii) What is the chance it is not blue? [1]',
      flag_reasons: ['marks_mismatch', 'figure_missing', 'chapter_unresolved'],
      flag_detail: JSON.stringify({ marks_mismatch: 'The marks may not match the paper.' }),
      // An older row: no first reading and no change log. The page is shown with a box.
      source: { page: 3, page_verified: true, dpi: 72, bbox: [44, 206, 552, 274] },
    }),
    // A trusted crop AND a verified page (owner round 24: the verified page
    // sits beside every question that has one). The made-up "printed paper"
    // has a made-up typo ("compleetly"), so the typo box can be tried here.
    q({
      id: 'd00000ff-0000-4000-8000-0000000000ff',
      ord: 0.5,
      display_number: '8',
      marks: 2,
      version: 3,
      body: 'Factorise compleetly: $3x^2 - 12$ [2]',
      flag_reasons: ['spelling_suspect'],
      flag_detail: JSON.stringify({ spelling_suspect: 'Computer check: "compleetly" may be misspelt on the paper itself.' }),
      // The marks are still inside the text ("[2]"), so the screen offers Move marks out.
      raw_ocr: 'Factorise compleetly: 3x^2 - l2\n[2]',
      source: {
        page: 3,
        page_verified: true,
        align_score: 0.96,
        snippet_object: 'dummy/q-factorise.png',
        dpi: 72,
        bbox: [44, 300, 552, 324],
        edit_log: [
          { kind: 'fixed_ocr_word', from: 'l2', to: '12' },
          { kind: 'joined_lines', from: 'l2\n[2]', to: '12 [2]' },
        ],
      },
    }),
    q({
      id: 'd0000001-0000-4000-8000-000000000001',
      ord: 1,
      display_number: '4(ii)',
      marks: 3,
      body: '(ii) Solve for $x$ and verify your answer: $$2x^2 - 7x + 3 = 0$$ Answer: $x = 3$ or $x = \\frac{1}{2}$',
      flag_reasons: ['answer_in_question'],
      flag_detail: JSON.stringify({ answer_in_question: 'Computer check: the last line gives the answer.' }),
      source: { snippet_object: 'dummy/q-quadratic.png', align_score: 0.97 },
    }),
    q({
      id: 'd0000002-0000-4000-8000-000000000002',
      ord: 2,
      subject: 'Economics',
      cls: 'XII',
      body: 'With the help of a diagram, explain what happens to the price of a good when its supply falls and demand stays the same.',
      flag_reasons: ['chapter_unresolved', 'display_number_missing', 'figure_missing', 'missing_marks'],
      flag_detail: JSON.stringify({
        chapter_unresolved: "chapter is null -- ch= was '?' or did not resolve against the chapter list",
      }),
      // A doubtful crop (0.42): never shown, so the page says "no picture".
      source: { snippet_object: 'dummy/q-quadratic.png', align_score: 0.42 },
    }),
    q({
      id: 'd0000003-0000-4000-8000-000000000003',
      ord: 4,
      display_number: '(b)',
      marks: 2,
      body: '(b) Find the total number of trees planted.',
      flag_reasons: ['merged_subparts'],
      // Part (b) of question 5: its own crop is good, so the right pane shows one picture tile per part.
      source: { snippet_object: 'dummy/q-trees_b.png', align_score: 0.95 },
    }),
    q({
      id: 'd0000004-0000-4000-8000-000000000004',
      ord: 10,
      subject: 'English',
      cls: 'VII',
      display_number: '3',
      body: '3. Why does the girl in the story hide the letter under her pillow?\n(a) She is afraid her brother will read it.\n(b) She wants to keep it dry.\n(c) She forgot where her bag was.\n(d) She plans to post it later.',
      flag_reasons: ['hidden_on_site', 'gate_source'],
      flag_detail: JSON.stringify({
        hidden_on_site: 'Two computer checks read it and think it is fine. Please confirm.',
        gate_source: "Text printed just after it on the paper: 'Complete the following sentences'",
      }),
      source: {
        pipeline: 'english_w14',
        role: 'rescue',
        set_text: 'A made-up short story',
        stimulus: {
          id: 'dummy-passage-1',
          kind: 'prose_extract',
          title: null,
          text: 'Meera read the letter twice. Her brother was already at the door, calling her name, so she pushed the envelope under her pillow and smoothed the sheet flat. She would post it tomorrow, on the way to school, before anyone could ask what it said.',
        },
      },
    }),
    q({
      id: 'd0000005-0000-4000-8000-000000000005',
      ord: 11,
      subject: 'History & Civics',
      cls: 'X',
      display_number: '6',
      marks: 4,
      body: 'st te th fu ct ns o th Pr me M n st r nd h s c unc l f m n st rs wh ch ar e ls o r sp ns bl e t o th L k S bh a',
      flag_reasons: ['ocr_junk'],
    }),
    q({
      id: 'd0000006-0000-4000-8000-000000000006',
      ord: 12,
      display_number: '9',
      marks: 3,
      body:
        '9. Case study: a school garden club recorded the number of saplings each class planted over one week.\n\n' +
        '| Class | VI | VII | VIII | IX | X |\n| --- | --- | --- | --- | --- | --- |\n| Saplings | 14 | 22 | 9 | 17 | 22 |\n\n' +
        '(i) Draw a bar graph of the data. [2]\n(ii) Which class planted the fewest saplings? [1]\n' +
        '(iii) The club wants every class to plant at least 15 next week. How many more saplings must each class that fell short plant? Show your working clearly, and write your final answer in a sentence.',
      flag_reasons: ['figure_missing', 'marks_mismatch'],
      flag_detail: JSON.stringify({ marks_mismatch: 'questions sum to 100.0, paper.max_marks is 80.0' }),
      source: { snippet_object: 'dummy/q-long.png', align_score: 0.93 },
    }),
    q({
      id: 'd0000007-0000-4000-8000-000000000007',
      ord: 13,
      subject: 'Physics',
      display_number: '7',
      marks: 2,
      body: '7. State two uses of a lever in daily life. [2] 8. Define power. Give its unit. [2]',
      flag_reasons: ['ocr_fused'],
      flag_detail: JSON.stringify({
        ocr_fused: "shares one un-splittable OCR block with other question(s) in fused_group 'grpA' -- needs a human to split",
      }),
      source: { snippet_object: 'dummy/q-split.png' },
    }),
    q({
      id: 'd0000008-0000-4000-8000-000000000008',
      ord: 14,
      subject: 'Chemistry',
      display_number: '8',
      marks: 2,
      body: '',
      flag_reasons: ['ocr_fused'],
      flag_detail: JSON.stringify({ ocr_fused: "shares one un-splittable OCR block in fused_group 'grpA'" }),
      source: { snippet_object: 'dummy/q-split.png' },
    }),
    // The four rows below exist to preview the visual maths editor
    // (Fix it -> tap a formula) against the shapes it must handle: the
    // owner's own example (a fraction equation), a quadratic, chemistry
    // (\ce{}), and a matrix. Each starts unflagged so "Fix it" is one tap
    // away without first working through the flagged-question fixtures
    // above -- none of this text is copied from a real paper.
    q({
      id: 'd0000009-0000-4000-8000-000000000009',
      ord: 15,
      display_number: '15',
      marks: 3,
      body: '15. Solve and verify your answer: $$\\frac{2x}{3} + 6 = -4 + \\frac{x}{9}$$',
      flag_reasons: [],
      source: { snippet_object: 'dummy/q-quadratic.png' },
    }),
    q({
      id: 'd0000010-0000-4000-8000-000000000010',
      ord: 16,
      display_number: '16',
      marks: 3,
      body: 'Solve for $x$: $$2x^2 - 7x + 3 = 0$$',
      flag_reasons: [],
      source: { snippet_object: 'dummy/q-quadratic.png' },
    }),
    q({
      id: 'd0000011-0000-4000-8000-000000000011',
      ord: 17,
      subject: 'Chemistry',
      display_number: '17',
      marks: 2,
      body: 'Balance the equation $\\ce{2H2 + O2 -> 2H2O}$ and name the type of reaction.',
      flag_reasons: [],
    }),
    q({
      id: 'd0000012-0000-4000-8000-000000000012',
      ord: 18,
      display_number: '18',
      marks: 4,
      body:
        'Find the inverse of the matrix $$A = \\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}$$ and verify that $AA^{-1} = I$.',
      flag_reasons: [],
    }),
    // A long English passage with parts (a) to (h): this is part (f) of question 2 (see dummyContext).
    q({
      id: ENGLISH_PART_ID,
      ord: 19,
      subject: 'English',
      display_number: '2(f)',
      marks: 2,
      body: '(f) Why did the narrator wait at the gate for so long before knocking?',
      flag_reasons: [],
      source: {
        pipeline: 'english_w14',
        role: 'shown',
        set_text: 'A made-up extract from a novel',
        stimulus: { id: 'dummy-passage-2', kind: 'prose_extract', title: null, text: ENGLISH_PASSAGE },
      },
    }),
  ];
}

/** The whole question 5 that fixture 3 is part (b) of, and the English question 2 that fixture 13 is part (f) of. */
export function dummyContext(questionId: string): ContextRow[] {
  if (questionId === ENGLISH_PART_ID) return englishContext();
  if (questionId !== 'd0000003-0000-4000-8000-000000000003') return [];
  const row = (r: Partial<ContextRow> & Pick<ContextRow, 'id' | 'ord' | 'body'>): ContextRow => ({
    display_number: null,
    number_path: null,
    options: null,
    source: null,
    is_current: false,
    is_parent: false,
    depth: 1,
    ...r,
  });
  return [
    row({
      id: 'd0000003-0000-4000-8000-0000000000ff',
      ord: 2,
      display_number: '5',
      body: '5. Read the table and answer the questions that follow.',
      is_parent: true,
      depth: 0,
      source: {
        snippet_object: 'dummy/q-trees_stem.png',
        whole_snippet_object: 'dummy/q-trees_whole.png',
        whole_snippet_members: { located: 3, members: 3, min_align: 0.95 },
      },
    }),
    row({ id: 'd0000003-0000-4000-8000-0000000000aa', ord: 3, display_number: '(a)', body: '(a) Name the district with the most trees.', source: { snippet_object: 'dummy/q-trees_a.png', align_score: 0.97 } }),
    row({ id: 'd0000003-0000-4000-8000-000000000003', ord: 4, display_number: '(b)', body: '(b) Find the total number of trees planted.', is_current: true, source: { snippet_object: 'dummy/q-trees_b.png', align_score: 0.95 } }),
    row({ id: 'd0000003-0000-4000-8000-0000000000cc', ord: 5, display_number: '(c)', body: '(c) Which two districts planted the same number?' }),
  ];
}

/** A made-up whole A4 page (595 x 842), for the whole-page fallback preview. */
export function dummyPageDataUrl(path: string): string | null {
  const generic = /^pages\/([^/]+)\/(\d+)\.jpg$/.exec(path);
  if (!generic) return null;
  if (path !== `pages/${DUMMY_PAPER}/3.jpg`) return dummyGenericPage(Number(generic[2]));
  const rows: [number, string][] = [
    [70, 'Section B'],
    [110, '5. Find the mean of the first five prime numbers.                    [2]'],
    [150, '6. Find the value of k if the points (2, 3), (4, k) and (6, -3)'],
    [172, '   are collinear.                                                              [3]'],
    [222, '7. A bag holds 4 red and 6 blue marbles. One is drawn at random.'],
    [244, '   (i) What is the chance it is red?                                       [1]'],
    [266, '   (ii) What is the chance it is not blue?                                [1]'],
    [316, '8. Factorise compleetly: 3x^2 - 12                                        [2]'],
    [366, '9. The sum of two numbers is 25 and their product is 144.'],
    [388, '   Find the numbers.                                                            [4]'],
    [800, 'Page 3 of 8'],
  ];
  const text = rows
    .map(([y, l]) => `<text x="48" y="${y}" font-family="Times New Roman, serif" font-size="15" fill="#1c1c1c" xml:space="preserve">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="595" height="842" viewBox="0 0 595 842"><rect width="100%" height="100%" fill="#fbfaf6"/><rect x="24" y="24" width="547" height="794" fill="none" stroke="#bbb"/>${text}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** An SVG "photo" of the printed lines, as a data URL. */
export function dummyPictureDataUrl(path: string): string | null {
  const lines = DUMMY_PICTURES[path];
  if (!lines) return null;
  const width = 560;
  const height = 28 + lines.length * 26;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const text = lines
    .map((l, i) => `<text x="16" y="${34 + i * 26}" font-family="Times New Roman, serif" font-size="17" fill="#222" xml:space="preserve">${esc(l)}</text>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fbfaf6"/>${text}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** A made-up page N of any made-up paper, for the whole-paper page-flip preview. */
function dummyGenericPage(n: number): string {
  const lines = [
    `Made-up printed page ${n}`,
    `${n * 3 - 2}. State two properties of a rectangle.                              [2]`,
    `${n * 3 - 1}. Find the value of x if 3x + 4 = 19.                              [2]`,
    `${n * 3}. Name the process by which plants make food.                     [1]`,
  ];
  const text = lines
    .map(
      (l, i) =>
        `<text x="48" y="${70 + i * 46}" font-family="Times New Roman, serif" font-size="15" fill="#1c1c1c" xml:space="preserve">${l
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')}</text>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="595" height="842" viewBox="0 0 595 842"><rect width="100%" height="100%" fill="#fbfaf6"/><rect x="24" y="24" width="547" height="794" fill="none" stroke="#bbb"/>${text}<text x="48" y="800" font-family="serif" font-size="13" fill="#666">Page ${n}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** The whole English question 2: its stem and parts (a) to (h), part (f) being checked. */
function englishContext(): ContextRow[] {
  const row = (r: Partial<ContextRow> & Pick<ContextRow, 'id' | 'ord' | 'body'>): ContextRow => ({
    display_number: null,
    number_path: null,
    options: null,
    source: null,
    is_current: false,
    is_parent: false,
    depth: 1,
    ...r,
  });
  // `crop`: this part has a crop of its own (d and g do not).
  const part = (letter: string, ord: number, body: string, crop = true): ContextRow =>
    row({
      id: `d0000013-0000-4000-8000-0000000000${letter.charCodeAt(0).toString(16)}`,
      ord,
      display_number: `(${letter})`,
      body: `(${letter}) ${body}`,
      source: crop ? { snippet_object: `dummy/q-eng2_${letter}.png` } : null,
    });
  return [
    row({
      id: 'd0000013-0000-4000-8000-0000000000ff',
      ord: 10,
      display_number: '2',
      body: '2. Read the extract below carefully and answer the questions that follow.',
      is_parent: true,
      depth: 0,
      source: { snippet_object: 'dummy/q-eng2_stem.png' },
    }),
    part('a', 11, 'What was Anil carrying with him? [1]'),
    part('b', 12, 'Why did the gate seem smaller now than when he was nine? [2]'),
    part('c', 13, 'Name two sounds Anil heard from behind the wall. [2]'),
    part('d', 14, 'What had Anil rehearsed on the train, and how was the real scene different? [2]', false),
    part('e', 15, 'What did the letter from his aunt say? Answer in your own words. [2]'),
    row({ id: ENGLISH_PART_ID, ord: 16, display_number: '(f)', body: '(f) Why did the narrator wait at the gate for so long before knocking?', is_current: true, source: { snippet_object: 'dummy/q-eng2_f.png' } }),
    part('g', 17, 'How does the little girl behave towards Anil? Give one example. [2]', false),
    part('h', 18, 'Pick out the phrase that shows how tired Anil was after the long journey. [1]'),
  ];
}
