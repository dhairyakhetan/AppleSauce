/* Table detection for question text. DISPLAY ONLY.

   Question text is never altered (CLAUDE.md). Nothing in this file rewrites,
   re-cases or trims a stored character. It looks at a body, decides where a
   table sits inside it, and hands the renderer a list of pieces:

       text | html-table | grid-table | text | ...

   Every piece carries `raw`, the exact slice of the source it came from, and
   the pieces joined back together are the source, byte for byte. A test
   asserts that for every real example. When a candidate table is not
   obviously a table, it stays a `text` piece and renders exactly as it did
   before this file existed.

   Why this exists: OCR emits merged-cell tables (Accounts ledgers, balance
   sheets, receipts and payments accounts, frequency tables) as literal
   `<table><tr><td>` markup, and the swarm's Scribe leaves that markup INSIDE
   `body` as one run with the question sentence around it ("...accounts;
   <table>...</table> Show how..."). The old renderer only recognised a table
   when the whole paragraph began with `<table`, so any table with a sentence
   before it printed as raw tags. 173 of the 215 audit questions with a table,
   and 17 of the 18 live bank ones, have a sentence before the table.

   Safety: cell text is returned as plain strings. The React side feeds each
   one through the same segment()/Inline pipeline as every other piece of
   text, so no cell is ever interpreted as HTML. */

export interface HtmlTableCell {
  tag: 'td' | 'th';
  content: string;
  colSpan?: number;
  rowSpan?: number;
}
export interface HtmlTableRow {
  cells: HtmlTableCell[];
}

export type TablePiece =
  | { kind: 'text'; raw: string }
  | { kind: 'html-table'; raw: string; rows: HtmlTableRow[] }
  | { kind: 'grid-table'; raw: string; rows: string[][]; source: 'pipe' | 'tab' | 'space' };

/* ------------------------------------------------------------------ *
 * HTML tables
 * ------------------------------------------------------------------ */

/** Decodes the entities OCR actually leaves in cells (`&#x27;`, `&amp;`,
 *  `&#39;`, `&nbsp;` ...). Display only; the stored text keeps them. `&amp;`
 *  goes last so `&amp;lt;` shows as `&lt;`, not `<`. */
export function decodeBasicEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, h) => safeCodePoint(parseInt(h, 16), m))
    .replace(/&#(\d{1,7});/g, (m, d) => safeCodePoint(parseInt(d, 10), m))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function safeCodePoint(n: number, fallback: string): string {
  if (!Number.isFinite(n) || n < 9 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return fallback;
  return String.fromCodePoint(n);
}

function clampSpan(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 1) return undefined;
  return Math.min(50, n);
}

function parseRowCells(rowInner: string): HtmlTableCell[] {
  const cellMatches = [...rowInner.matchAll(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi)];
  return cellMatches.map((cellMatch) => {
    const tag = cellMatch[1].toLowerCase() as 'td' | 'th';
    const attrs = cellMatch[2] ?? '';
    const colspanMatch = attrs.match(/colspan\s*=\s*"?'?(\d+)"?'?/i);
    const rowspanMatch = attrs.match(/rowspan\s*=\s*"?'?(\d+)"?'?/i);
    return {
      tag,
      content: decodeBasicEntities(cellMatch[3]).trim(),
      colSpan: clampSpan(colspanMatch?.[1]),
      rowSpan: clampSpan(rowspanMatch?.[1]),
    };
  });
}

/** Parses the first `<table>...</table>` in `block` into rows of cells. Only
 *  `<tr>`, `<td>`/`<th>` and their colspan/rowspan are ever read. A `<tr>`
 *  whose `</tr>` is missing (OCR does that) still ends where the next `<tr>`
 *  begins. Returns null when there is no table with at least one row. */
export function parseHtmlTable(block: string): HtmlTableRow[] | null {
  const tableMatch = block.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return null;
  const rowInners = tableMatch[1].split(/<tr\b[^>]*>/i).slice(1);
  if (rowInners.length === 0) return null;
  const rows = rowInners.map((inner) => ({ cells: parseRowCells(inner) }));
  return rows.some((r) => r.cells.length > 0) ? rows : null;
}

/** True when nothing inside the table is outside a cell. If a table holds
 *  loose text between cells, rendering only the cells would hide it, so such a
 *  table is left as text. This is what lets the renderer promise it never
 *  drops a character. */
function tableLosesNothing(inner: string): boolean {
  const rest = inner
    .replace(/<(td|th)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(?:thead|tbody|tfoot|tr|colgroup|col|caption)\b[^>]*>/gi, '');
  return rest.trim() === '';
}

/** Cells that read as a number or an amount ("1,25,000", "Rs. 20,000",
 *  "10 - 20", "[2]", a lone dash). */
const NUMERIC_CELL = /^[\s\d.,\-–—−()%/:+[\]]+$/;

function isNumericLike(text: string): boolean {
  const stripped = text.replace(/(?:rs\.?|inr|₹|\$|£|`)/gi, '').trim();
  return stripped !== '' && /\d/.test(stripped) && NUMERIC_CELL.test(stripped);
}

/** Whether row 0 of a `<td>`-only table is a header row. OCR writes headers as
 *  plain `<td>`, so without this the table has no header styling. Confident
 *  only when every cell of the first row has words and none is a bare number. */
export function firstRowLooksLikeHeader(rows: HtmlTableRow[]): boolean {
  if (rows.length < 2) return false;
  if (rows.some((r) => r.cells.some((c) => c.tag === 'th'))) return false;
  const first = rows[0].cells;
  if (first.length === 0) return false;
  return first.every((c) => c.content.trim() !== '' && !isNumericLike(c.content));
}

/* ------------------------------------------------------------------ *
 * Line-based grids: pipes, tabs, runs of spaces
 * ------------------------------------------------------------------ */

const isPipeSeparator = (line: string) => /^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/.test(line) && line.includes('-');
const pipeCells = (line: string) =>
  line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

interface LineSpan {
  start: number; // offset of first char of the line
  end: number; // offset just past the line's last char (before the \n)
  text: string;
}

function splitLines(text: string): LineSpan[] {
  const out: LineSpan[] = [];
  let pos = 0;
  for (const text_ of text.split('\n')) {
    out.push({ start: pos, end: pos + text_.length, text: text_ });
    pos += text_.length + 1;
  }
  return out;
}

interface GridRun {
  from: number; // first line index
  to: number; // last line index (inclusive)
  rows: string[][];
  source: 'pipe' | 'tab' | 'space';
}

function findGridRuns(text: string): GridRun[] {
  const lines = splitLines(text);
  const runs: GridRun[] = [];
  let i = 0;
  while (i < lines.length) {
    // Pipe table: >= 2 consecutive lines opening with `|` and a --- separator among them.
    if (lines[i].text.trim().startsWith('|')) {
      let j = i;
      while (j + 1 < lines.length && lines[j + 1].text.trim().startsWith('|')) j++;
      const slice = lines.slice(i, j + 1);
      if (slice.length >= 2 && slice.some((l) => isPipeSeparator(l.text))) {
        runs.push({ from: i, to: j, rows: slice.filter((l) => !isPipeSeparator(l.text)).map((l) => pipeCells(l.text)), source: 'pipe' });
        i = j + 1;
        continue;
      }
    }
    // Tab or space-aligned columns: >= 3 consecutive lines, same column count,
    // first column filled on every line, header cells all filled.
    const tabRun = alignedRun(lines, i, (t) => (t.includes('\t') ? t.split('\t').map((c) => c.trim()) : null));
    if (tabRun) {
      runs.push({ from: i, to: tabRun.to, rows: tabRun.rows, source: 'tab' });
      i = tabRun.to + 1;
      continue;
    }
    const spaceRun = alignedRun(lines, i, (t) => (/\S {3,}\S/.test(t) ? t.trim().split(/ {3,}/).map((c) => c.trim()) : null));
    if (spaceRun) {
      runs.push({ from: i, to: spaceRun.to, rows: spaceRun.rows, source: 'space' });
      i = spaceRun.to + 1;
      continue;
    }
    i++;
  }
  return runs;
}

function alignedRun(
  lines: LineSpan[],
  from: number,
  split: (line: string) => string[] | null,
): { to: number; rows: string[][] } | null {
  const first = split(lines[from].text);
  if (!first || first.length < 2 || first.length > 8) return null;
  const rows: string[][] = [first];
  let j = from;
  while (j + 1 < lines.length) {
    const next = split(lines[j + 1].text);
    if (!next || next.length !== first.length) break;
    rows.push(next);
    j++;
  }
  if (rows.length < 3) return null;
  if (rows[0].some((c) => c === '')) return null;
  if (rows.some((r) => r[0] === '')) return null;
  return { to: j, rows };
}

/* ------------------------------------------------------------------ *
 * Public: split a body into pieces
 * ------------------------------------------------------------------ */

function textPieces(text: string, out: TablePiece[]) {
  if (text === '') return;
  const lines = splitLines(text);
  const runs = findGridRuns(text);
  if (runs.length === 0) {
    out.push({ kind: 'text', raw: text });
    return;
  }
  let cursor = 0;
  for (const run of runs) {
    const runStart = lines[run.from].start;
    const runEnd = lines[run.to].end;
    if (runStart > cursor) out.push({ kind: 'text', raw: text.slice(cursor, runStart) });
    out.push({ kind: 'grid-table', raw: text.slice(runStart, runEnd), rows: run.rows, source: run.source });
    cursor = runEnd;
  }
  if (cursor < text.length) out.push({ kind: 'text', raw: text.slice(cursor) });
}

/** Cuts `text` into text and table pieces. `pieces.map(p => p.raw).join('')`
 *  always equals `text`. */
export function splitIntoTablePieces(text: string): TablePiece[] {
  const out: TablePiece[] = [];
  let cursor = 0;
  const re = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!tableLosesNothing(m[1])) continue;
    const rows = parseHtmlTable(m[0]);
    if (!rows) continue;
    textPieces(text.slice(cursor, m.index), out);
    out.push({ kind: 'html-table', raw: m[0], rows });
    cursor = m.index + m[0].length;
  }
  textPieces(text.slice(cursor), out);
  return out;
}
