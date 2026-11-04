import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { firstRowLooksLikeHeader, splitIntoTablePieces, decodeBasicEntities } from './question-tables';
import { MathText } from '@/components/papers/math-text';

/* Fixtures are REAL audit_questions.body values (Supabase project
   uvtifolnsneitetzohtn, read 2026-10-12), kept byte for byte, including the
   single-line shape the swarm Scribe leaves: sentence, then `<table>...`, then
   more sentence, with no blank line anywhere. */

// Accounts, display_number 11(i): sentence BEFORE the table and sentence AFTER it.
const GST =
  'Chaturvedi Food Court has following balances in its different GST accounts; <table><tr><td>Particular</td><td>IGST (Rs.)</td><td>CGST (Rs.)</td><td>SGST (Rs.)</td></tr><tr><td>Input GST</td><td>1,25,000</td><td>1,50,000</td><td>1,50,000</td></tr><tr><td>Output GST</td><td>2,00,000</td><td>1,00,000</td><td>1,00,000</td></tr></table> Show how Input GST will be adjusted against Output GST and which accounts will have the balances. Pass the Journal Entries for set-off of GST. (Show ur workings clearly). (6)';

// Accounts 12: a colspan footer row.
const ZOMATO =
  'Question 12 From the following Income Statement of Zomato Ltd. You are required to prepare the statement which enables a static/Common-size analysis of its income [3] Consolidated audited profit and loss account <table><tr><td>Particulars</td><td>FY24</td><td>INR crore</td></tr><tr><td>A. Income</td><td></td><td></td></tr><tr><td>Revenue from operations</td><td>12,114</td><td>7,079</td></tr><tr><td colspan="3">[Source: Annual Report of 2023-2024 of Zomato Ltd.]</td></tr></table>';

// ACCOUNTANCY 8: TWO adjacent tables (the ledger split by a page break), &amp; entity.
const RECEIPTS =
  'The following is the Receipts and Payments Account of Sunrise Cultural Club for the year ended 31st March 2025:\nReceipts and Payments Account <table><tr><td>Receipts</td><td>Amount (Rs.)</td><td>Payments</td><td>Amount (Rs.)</td></tr><tr><td>To Opening Balance (Cash &amp; Bank)</td><td>18,000</td><td>By Salaries</td><td>42,000</td></tr></table> <table><tr><td>Receipts</td><td>Amount (Rs.)</td><td>Payments</td><td>Amount (Rs.)</td></tr><tr><td>Total</td><td>1,44,000</td><td>Total</td><td>1,44,000</td></tr></table> Additional Information: Subscriptions outstanding on 1st April 2024 Rs. 8,000.';

// Accounts 8: &#x27; entities and a literal backslash-n inside a cell.
const ENTITY =
  "Anil, Sunil and Rajib are partners. Fill in the mis-figures below: [2] Page 2 of 3 <table><tr><td>Date</td><td>Particulars</td></tr><tr><td>31.12.24</td><td>Anil&#x27;s Capital A/c Dr\\nSunil&#x27;s Capital A/c Dr</td></tr></table>";

// Economics 4(d): a tiny two-column schedule.
const DEMAND =
  'Draw a demand curve with the help of a hypothetical individual demand schedule. Hypothetical Individual Demand Schedule.[2] <table><tr><td>Price (in rupees)</td><td>Quantity demanded (in units)</td></tr><tr><td>5</td><td>1</td></tr><tr><td>4</td><td>2</td></tr></table>';

// Accounts 13(ii): an <img> tag in a cell, and prose after.
const IMG =
  'From the following Trial Balance prepare Trading Account: {{fig:69}} <table><tr><td>Dr. Balances</td><td>Rs.</td></tr><tr><td>Sundry debtors</td><td><img src="imgs/img_in_image_box_990_1532_1110_1638.jpg" alt="Image" /></td></tr></table> Following further information is given: Wages for March 2025, Rs.2100 have not yet been paid.';

// Economics (GFM pipe table with a separator), real shape.
const PIPE =
  'On the basis of the given data, compare the workforce.\n\n| Sector      | Contribution to GVA              |\n| ----------- | -------------------------------- |\n| Agriculture | India: 16 China: 7 Pakistan: 24  |\n| Industry    | India: 30 China: 41 Pakistan: 19 |';

// Pipe table butted up against prose with NO blank line (the old renderer dropped the prose).
const PIPE_GLUED = 'Study the table.\n| Item | Qty |\n| --- | --- |\n| Pens | 12 |\n| Pads | 7 |\nFind the total.';

// Social Science 3: tab-separated Column I / Column II match list.
const TAB =
  'Match Column I with Column II and choose the correct option :\nColumn I (Role)\tColumn II (Scholar)\na. The song Vande Mataram\ti. Sardar Vallabhbhai Patel\nb. Picture of Bharat Mata with spiritual qualities\tii. Dr. B.R. Ambedkar\nc. Bardoli Satyagraha\tiii. Abanindranath Tagore';

// History & Civics (live bank): columns aligned with runs of spaces.
const SPACES =
  'The Ain is made up of five books, match these books with the given options:\nColumn I                          Column II\n(i) First book.               1. Sipah- abadi.\n(ii) Second book.             2. Mulk-abadi.\n(iii) Third book.             3. Manzil-abadi.\nCorrect option is:';

// ENGLISH LITERATURE 3: a tab-indented VERSE extract. Must NOT become a table.
const VERSE =
  'Read the extract given below and answer the questions that follow:\nBrutus\tOur course will seem too bloody, Caius Cassius,\n\tTo cut the head offand then hack the limbs,\n\tLike wrath in death and envy afterwards;\n\tFor Antony is but a limb of Caesar.';

const rejoin = (s: string) =>
  splitIntoTablePieces(s)
    .map((p) => p.raw)
    .join('');

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('splitIntoTablePieces: nothing is lost and nothing is added', () => {
  it.each([
    ['GST', GST],
    ['ZOMATO', ZOMATO],
    ['RECEIPTS', RECEIPTS],
    ['ENTITY', ENTITY],
    ['DEMAND', DEMAND],
    ['IMG', IMG],
    ['PIPE', PIPE],
    ['PIPE_GLUED', PIPE_GLUED],
    ['TAB', TAB],
    ['SPACES', SPACES],
    ['VERSE', VERSE],
    ['plain', 'Find the value of $x^2$ when x = 3.\n\nHence solve it.'],
    ['empty', ''],
  ])('%s: the pieces joined are the source, byte for byte', (_name, body) => {
    expect(rejoin(body)).toBe(body);
  });
});

describe('html tables that sit INSIDE a sentence (the Accounts bug)', () => {
  it('finds the table after a sentence and keeps the sentence after it', () => {
    const pieces = splitIntoTablePieces(GST);
    expect(pieces.map((p) => p.kind)).toEqual(['text', 'html-table', 'text']);
    expect(pieces[0].raw.startsWith('Chaturvedi Food Court')).toBe(true);
    expect(pieces[2].raw.trim().startsWith('Show how Input GST')).toBe(true);
  });

  it('finds two adjacent tables', () => {
    const kinds = splitIntoTablePieces(RECEIPTS).map((p) => p.kind);
    expect(kinds.filter((k) => k === 'html-table')).toHaveLength(2);
  });

  it('leaves a table with loose text between cells as text (rendering the cells alone would hide it)', () => {
    const lossy = 'See <table><tr><td>a</td> stray words <td>b</td></tr></table> end';
    expect(splitIntoTablePieces(lossy).map((p) => p.kind)).toEqual(['text']);
  });

  it('leaves an unclosed table as text', () => {
    const open = 'See <table><tr><td>a</td></tr> and no end';
    expect(splitIntoTablePieces(open).map((p) => p.kind)).toEqual(['text']);
  });

  it('tolerates a missing </tr>', () => {
    const pieces = splitIntoTablePieces('<table><tr><td>a</td><td>b</td><tr><td>c</td><td>d</td></tr></table>');
    const t = pieces[0];
    expect(t.kind).toBe('html-table');
    if (t.kind === 'html-table') expect(t.rows.map((r) => r.cells.map((c) => c.content))).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('decodeBasicEntities', () => {
  it('turns the entities OCR leaves in cells into characters (display only)', () => {
    expect(decodeBasicEntities('Anil&#x27;s &amp; Co &#39;x&#39; a&nbsp;b')).toBe("Anil's & Co 'x' a b");
    expect(decodeBasicEntities('&amp;lt;')).toBe('&lt;');
  });
});

describe('firstRowLooksLikeHeader', () => {
  const rowsOf = (body: string) => {
    const t = splitIntoTablePieces(body).find((p) => p.kind === 'html-table');
    return t && t.kind === 'html-table' ? t.rows : [];
  };
  it('treats Particulars / IGST / CGST as a header', () => {
    expect(firstRowLooksLikeHeader(rowsOf(GST))).toBe(true);
  });
  it('does not treat a row of amounts as a header', () => {
    const rows = rowsOf('<table><tr><td>General Reserve</td><td>₹1,20,000</td></tr><tr><td>Investments</td><td>₹2,00,000</td></tr></table>');
    expect(firstRowLooksLikeHeader(rows)).toBe(false);
  });
  it('does not treat a frequency row (label then numbers) as a header', () => {
    const rows = rowsOf('<table><tr><td>Height in cm</td><td>150</td><td>152</td></tr><tr><td>No. of students</td><td>28</td><td>40</td></tr></table>');
    expect(firstRowLooksLikeHeader(rows)).toBe(false);
  });
});

describe('text-grid tables', () => {
  it('pipe table: header, separator dropped, prose either side kept', () => {
    const pieces = splitIntoTablePieces(PIPE_GLUED);
    expect(pieces.map((p) => p.kind)).toEqual(['text', 'grid-table', 'text']);
    const g = pieces[1];
    if (g.kind === 'grid-table') {
      expect(g.source).toBe('pipe');
      expect(g.rows).toEqual([['Item', 'Qty'], ['Pens', '12'], ['Pads', '7']]);
    }
    expect(pieces[2].raw).toBe('\nFind the total.');
  });

  it('tab-separated columns become a grid', () => {
    const g = splitIntoTablePieces(TAB).find((p) => p.kind === 'grid-table');
    expect(g && g.kind === 'grid-table' ? g.source : null).toBe('tab');
    if (g && g.kind === 'grid-table') {
      expect(g.rows[0]).toEqual(['Column I (Role)', 'Column II (Scholar)']);
      expect(g.rows).toHaveLength(4);
    }
  });

  it('columns aligned with runs of spaces become a grid', () => {
    const g = splitIntoTablePieces(SPACES).find((p) => p.kind === 'grid-table');
    expect(g && g.kind === 'grid-table' ? g.source : null).toBe('space');
    if (g && g.kind === 'grid-table') expect(g.rows[1]).toEqual(['(i) First book.', '1. Sipah- abadi.']);
  });

  it('a tab-indented verse extract is NOT a table', () => {
    expect(splitIntoTablePieces(VERSE).map((p) => p.kind)).toEqual(['text']);
  });

  it('prose with one double space is NOT a table', () => {
    expect(splitIntoTablePieces('The Rajput style of   painting continued in the Sultanate period.').map((p) => p.kind)).toEqual(['text']);
  });
});

describe('MathText renders real tables', () => {
  it('Accounts GST question: a real <table> with a header row, sentence before and after', () => {
    const html = renderToStaticMarkup(<MathText text={GST} />);
    expect(html).not.toContain('&lt;table');
    expect(html).not.toContain('&lt;td');
    expect(count(html, /<table\b/g)).toBe(1);
    expect(count(html, /<thead>/g)).toBe(1);
    expect(count(html, /<th\b/g)).toBe(4);
    expect(count(html, /<tr\b/g)).toBe(3);
    expect(html).toContain('1,25,000');
    expect(html).toContain('overflow-x-auto'); // horizontal scroll lives inside the wrapper
    // text on both sides survived (digits are left alone by glyph substitution)
    expect(html).toContain('(6)');
  });

  it('colspan is kept', () => {
    const html = renderToStaticMarkup(<MathText text={ZOMATO} />);
    expect(html).toContain('colSpan="3"');
    expect(html).toContain('12,114');
  });

  it('two tables render as two tables', () => {
    const html = renderToStaticMarkup(<MathText text={RECEIPTS} />);
    expect(count(html, /<table\b/g)).toBe(2);
  });

  it('entities in a cell show as the character, not as &#x27;', () => {
    const html = renderToStaticMarkup(<MathText text={ENTITY} />);
    // React serialises a real apostrophe as &#x27;; an UNDECODED entity would
    // show up double-escaped as &amp;#x27;.
    expect(html).not.toContain('&amp;#x27');
    expect(html).toContain('&#x27;');
  });

  it('an <img> tag in a cell becomes a figure chip, never raw markup', () => {
    const html = renderToStaticMarkup(<MathText text={IMG} />);
    expect(html).not.toContain('imgs/img_in_image_box');
    expect(html).not.toContain('<img');
    expect(html).toContain('figure');
    expect(html).toContain('2100'); // the prose after the table survived
  });

  it('a pipe table glued to prose keeps the prose (it used to be dropped)', () => {
    const html = renderToStaticMarkup(<MathText text={PIPE_GLUED} />);
    expect(count(html, /<table\b/g)).toBe(1);
    expect(html).toContain('12');
    expect(html.length).toBeGreaterThan(0);
    // "Study the table." / "Find the total." go through glyph substitution, so count paragraphs instead
    expect(count(html, /<p\b/g)).toBe(2);
  });

  it('a script in a cell stays inert text', () => {
    const html = renderToStaticMarkup(<MathText text={'x <table><tr><td><script>alert(1)</script></td></tr></table>'} />);
    expect(html).not.toContain('<script');
  });

  it('text with no table renders with no <table>', () => {
    const html = renderToStaticMarkup(<MathText text={'Solve 2 + 3.\n\nThen 4 + 5.'} />);
    expect(html).not.toContain('<table');
    expect(count(html, /<p\b/g)).toBe(2);
  });
});
