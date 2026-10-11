import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { substituteGlyphs } from '@/lib/glyph-substitution';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/* Renders a question exactly as the paper set it.

   The bank's `text` is reconstructed byte-exact from the OCR source and is
   never retyped, so nothing here edits a single character. What this does is
   decide how the source's OWN structure should be presented:

   - blank lines separate paragraphs (28 of 41 questions use them)
   - pipe rows are a table (4 questions — a histogram distribution, a frequency
     table; as raw text those were unreadable)
   - dash rows are a list (2 questions)
   - $…$ and $$…$$ are maths
   - `**bold**`, `*italic*`, `<u>`, `~~strike~~`, `<sub>`/`<sup>` are markup,
     recognised only OUTSIDE a math span (segment() below always runs first,
     so a bare `*` inside LaTeX is never mistaken for emphasis)
   - `<table>` with `colspan`/`rowspan` (Accounts ledgers, grouped headers)
   - `\ce{...}` inside a math span is mhchem chemistry notation

   The one subtle rule is the last. `$$` normally means "display maths on its
   own line", but in this source 9 of the 12 `$$` blocks sit MID-SENTENCE —
   "The given quadratic equation $$3x^2+\\sqrt{7}x+2=0$$ has:". Rendering those
   as display blocks split one sentence into three stacked pieces and left
   "has:" stranded on its own line. So a `$$` run is only given its own block
   when it genuinely occupies its own line; otherwise it renders inline and the
   sentence stays a sentence.

   `throwOnError: false` throughout: the LaTeX is whoever set the paper's, and
   one unsupported macro must degrade to raw source for that span rather than
   blank the question.

   SECURITY MODEL FOR THE NEW MARKUP (bold/italic/underline/strike/sub/sup and
   the `<table>` branch): this file never hands OCR-sourced text to
   dangerouslySetInnerHTML. Every one of those constructs is parsed into a
   small typed tree (see `parseEmphasis`/`parseHtmlTable` below) and rendered
   as real React elements built by this component — <strong>, <em>, <td> and
   so on are created directly, never through an HTML string. A `<script>` or
   `onclick=` sitting inside a table cell or emphasis span is therefore inert
   by construction: there is no HTML parser or innerHTML assignment anywhere
   in this path for it to run through. The ONLY dangerouslySetInnerHTML left
   in this file is KaTeX's own generated markup, which is trusted library
   output (throwOnError: false, strict: false, trust: false), not OCR input —
   the same trust boundary this file already relied on before this change.
   This is a deliberate alternative to running DOMPurify over the whole body:
   it keeps DOMPurify off this critical path (see git log "Craft round 5")
   while still whitelisting an explicit, narrow tag set — the tree walker
   below IS the whitelist, it just never touches the DOM to enforce it. */

/* KaTeX output is memoised on (tex, displayMode) because render() is called
   inline in the JSX below, on every render pass, for every maths span in
   every question -- and BankPaper renders an entire paper at once (186
   questions in the largest), each MCQ option carrying its own <MathText>.
   So typing one character into the paper's search filter, or opening a report
   form, re-parsed every formula on the page from scratch: hundreds of
   milliseconds of blocked main thread per keystroke on a mid-range Android.

   The cache is safe to keep forever and safe to share across components:
   renderToString is a pure function of these two arguments, and the input is
   question text, which is immutable by project rule. Module scope rather than
   useMemo because the same formula recurs across questions and across
   remounts, and a per-component memo would miss both.

   The cap is not about memory -- entries are small -- but about an unbounded
   Map in a long session; 5k comfortably covers the largest paper's spans
   several times over, and the reset is cheap because a re-parse is only ever
   as expensive as it was before this cache existed. */
const MAX_CACHE = 5000;
const katexCache = new Map<string, string>();

/* mhchem (`\ce{...}`) is a KaTeX contrib module, not part of core KaTeX, and
   is only needed the moment a Chemistry paper uses it (zero live rows do,
   today — see UnlimitedOCR/playbook/RENDERER_TODO.md item 1). Loading it
   eagerly on every page that renders ANY question text would tax, e.g., a
   Maths-only paper for a macro it will never use. So it is dynamic-imported
   the first time a body is seen that actually contains `\ce{` or `\pu{}`,
   exactly the same "pay only if used" shape as this file's existing KaTeX
   memoisation above. */
let mhchemLoaded = false;
let mhchemPromise: Promise<void> | null = null;
function ensureMhchemLoaded(): Promise<void> {
  if (mhchemLoaded) return Promise.resolve();
  if (!mhchemPromise) {
    mhchemPromise = import('katex/contrib/mhchem').then(() => {
      mhchemLoaded = true;
    });
  }
  return mhchemPromise;
}
const NEEDS_MHCHEM_RE = /\\(ce|pu)\{/;

function render(tex: string, displayMode: boolean): string {
  const key = `${displayMode ? 'd' : 'i'}:${tex}`;
  /* A \ce span rendered before mhchem finishes loading throws inside KaTeX
     (undefined macro) and would otherwise cache that failure under this same
     key forever. So a tex string that still needs mhchem is never read from
     or written to the shared cache until the module is actually loaded --
     the caller (MathText, below) re-renders once loading finishes, and that
     second pass is what gets cached. */
  const pending = NEEDS_MHCHEM_RE.test(tex) && !mhchemLoaded;
  if (!pending) {
    const hit = katexCache.get(key);
    if (hit !== undefined) return hit;
  }

  let html: string;
  try {
    html = katex.renderToString(tex, { displayMode, throwOnError: false, strict: false, trust: false });
  } catch {
    html = '';
  }

  if (!pending) {
    if (katexCache.size >= MAX_CACHE) katexCache.clear();
    katexCache.set(key, html);
  }
  return html;
}

interface Seg {
  kind: 'text' | 'math';
  value: string;
  display: boolean;
}

/** Split one line-run into text and maths, deciding display vs inline by
 *  whether the maths stands alone on its line. */
export function segment(source: string): Seg[] {
  const out: Seg[] = [];
  // All four delimiter forms, because this source uses all four: `\(…\)` alone
  // appears 58 times against 12 `$$` and 6 `$`, so handling only the dollar
  // forms left most of the maths on the page — every matrix option in the
  // MCQs among it — rendering as raw LaTeX source.
  const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m.index > last) out.push({ kind: 'text', value: source.slice(last, m.index), display: false });
    // 1 = $$…$$, 2 = \[…\] (both display-capable); 3 = $…$, 4 = \(…\) (inline).
    const isDisplayForm = m[1] !== undefined || m[2] !== undefined;
    const body = m[1] ?? m[2] ?? m[3] ?? m[4];
    // Alone on its line? Look at what sits either side of it on that line.
    const before = source.slice(0, m.index).split('\n').pop() ?? '';
    const after = (source.slice(m.index + m[0].length).split('\n')[0] ?? '');
    const standsAlone = isDisplayForm && before.trim() === '' && after.trim() === '';
    out.push({ kind: 'math', value: body, display: standsAlone });
    last = re.lastIndex;
  }
  if (last < source.length) out.push({ kind: 'text', value: source.slice(last), display: false });
  return out;
}

/* ------------------------------------------------------------------------ *
 * Emphasis: **bold**, *italic*, ~~strike~~, <u>, <sub>, <sup> -- recognised
 * only inside a text Seg (i.e. after `segment()` has already pulled maths
 * out), and built as a small typed tree rather than an HTML string so no
 * dangerouslySetInnerHTML is ever needed for OCR-sourced text (see the
 * SECURITY MODEL note at the top of this file).
 * ------------------------------------------------------------------------ */
export type EmphTag = 'strong' | 'em' | 's' | 'u' | 'sub' | 'sup';
export type EmphNode =
  | { kind: 'text'; value: string }
  | { kind: 'tag'; tag: EmphTag; children: EmphNode[] };

/* Each pattern's own lookaround keeps it from firing on the OTHER patterns'
   delimiters (a "**" pair is never also read as two "*" italics) and on a
   single stray delimiter used as ordinary punctuation:
     - bold/italic delimiters may not open or close on whitespace, the same
       "flanking" rule CommonMark uses -- this is what keeps "2*3" and
       "a * b and c * d" as plain text: a `*` immediately followed by a space
       can never be read as an opening delimiter, so with no valid opener the
       whole thing is left alone as ordinary characters, exactly as before
       this change.
     - bold's content allows `[\s\S]` (including a lone inner `*`) so
       "**bold with *nested italic* inside**" recurses correctly; italic's
       content excludes `*` and `\n` so it can't accidentally swallow past a
       later bold run. */
const EMPHASIS_PATTERNS: Array<{ tag: EmphTag; regex: RegExp }> = [
  { tag: 's', regex: /~~(?!\s)([^~\n]+?)(?<!\s)~~/ },
  { tag: 'strong', regex: /(?<!\*)\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*(?!\*)/ },
  { tag: 'em', regex: /(?<!\*)\*(?!\*|\s)([^*\n]+?)(?<!\s)\*(?!\*)/ },
  { tag: 'u', regex: /<u>([\s\S]*?)<\/u>/i },
  { tag: 'sub', regex: /<sub>([\s\S]*?)<\/sub>/i },
  { tag: 'sup', regex: /<sup>([\s\S]*?)<\/sup>/i },
];

/** Recursive-descent parse of the emphasis constructs above. Picks the
 *  earliest match across every pattern (not the first pattern with any
 *  match) so overlapping candidates resolve by position, then recurses into
 *  both the matched content (nesting) and whatever follows. */
export function parseEmphasis(text: string): EmphNode[] {
  if (!text) return [];

  let bestIndex = Infinity;
  let bestMatch: RegExpMatchArray | null = null;
  let bestTag: EmphTag | null = null;

  for (const { tag, regex } of EMPHASIS_PATTERNS) {
    const m = text.match(regex);
    if (m && m.index !== undefined && m.index < bestIndex) {
      bestIndex = m.index;
      bestMatch = m;
      bestTag = tag;
    }
  }

  if (!bestMatch || bestTag === null || bestMatch.index === undefined) {
    return [{ kind: 'text', value: text }];
  }

  const nodes: EmphNode[] = [];
  const before = text.slice(0, bestMatch.index);
  // `before` cannot itself contain an earlier match of any pattern (that
  // would have been chosen instead), so it is always plain text.
  if (before) nodes.push({ kind: 'text', value: before });
  nodes.push({ kind: 'tag', tag: bestTag, children: parseEmphasis(bestMatch[1] ?? '') });
  const after = text.slice(bestMatch.index + bestMatch[0].length);
  nodes.push(...parseEmphasis(after));
  return nodes;
}

/* Real data caught a gap the synthetic test cases above did not: bold that
   WRAPS an inline maths span, e.g. "**...the line $3x+4y+7=0$ is**"
   (paper 07eae7, live). `segment()` already split this into three Segs
   (text, math, text) before emphasis parsing ever runs, so parsing each text
   Seg on its own left the opening "**" in the first Seg and the closing
   "**" in the second with no partner in either -- both stayed literal
   asterisks. The fix: parse emphasis across the WHOLE Seg run at once,
   standing a private-use-area placeholder in for each math Seg so the
   bold/italic scan can pair delimiters that sit on either side of a formula,
   then swap each placeholder back for its real (KaTeX-rendered) span when
   walking the resulting tree. PUA codepoints are used because they cannot
   occur in OCR'd question text -- nothing here can accidentally consume one
   as if it were content. */
const MATH_PLACEHOLDER_OPEN = '';
const MATH_PLACEHOLDER_CLOSE = '';
const MATH_PLACEHOLDER_RE = /(\d+)/g;

export function buildPlaceholderString(parts: Seg[]): string {
  return parts
    .map((p, i) => (p.kind === 'math' ? `${MATH_PLACEHOLDER_OPEN}${i}${MATH_PLACEHOLDER_CLOSE}` : p.value))
    .join('');
}

/** A text leaf from `parseEmphasis` may itself contain one or more math
 *  placeholders (when a bold/italic run spans across a formula). Splits it
 *  back into interleaved prose (glyph-substituted) and rendered maths. */
function renderLeafWithMath(value: string, parts: Seg[], keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  MATH_PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MATH_PLACEHOLDER_RE.exec(value)) !== null) {
    if (m.index > last) {
      out.push(<span key={`${keyPrefix}-t${n++}`}>{substituteGlyphs(value.slice(last, m.index))}</span>);
    }
    const seg = parts[parseInt(m[1], 10)];
    const html = seg ? render(seg.value, false) : '';
    out.push(
      html ? (
        <span
          key={`${keyPrefix}-m${n++}`}
          className="inline-block max-w-full align-middle"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <span key={`${keyPrefix}-m${n++}`}>{`$${seg?.value ?? ''}$`}</span>
      ),
    );
    last = MATH_PLACEHOLDER_RE.lastIndex;
  }
  if (last < value.length) out.push(<span key={`${keyPrefix}-t${n++}`}>{substituteGlyphs(value.slice(last))}</span>);
  return out;
}

function EmphasisNodes({ nodes, parts, keyPrefix }: { nodes: EmphNode[]; parts: Seg[]; keyPrefix: string }) {
  return (
    <>
      {nodes.map((n, i) => {
        const key = `${keyPrefix}-${i}`;
        if (n.kind === 'text') {
          // Glyph substitution (and math splice-back) runs on leaf text only,
          // same rule as before -- it must run on the CONTENT, never be
          // defeated by the markup now wrapping part of it.
          return <Fragment key={key}>{renderLeafWithMath(n.value, parts, key)}</Fragment>;
        }
        const children = <EmphasisNodes nodes={n.children} parts={parts} keyPrefix={key} />;
        switch (n.tag) {
          case 'strong':
            return <strong key={key}>{children}</strong>;
          case 'em':
            return <em key={key}>{children}</em>;
          case 's':
            return <s key={key}>{children}</s>;
          case 'u':
            return <u key={key}>{children}</u>;
          case 'sub':
            return <sub key={key}>{children}</sub>;
          case 'sup':
            return <sup key={key}>{children}</sup>;
          default:
            return children;
        }
      })}
    </>
  );
}

function Inline({ parts }: { parts: Seg[] }) {
  // A pure math Seg keeps its own dedicated wrapper span (inline-block,
  // align-middle) exactly as before when it ISN'T wrapped in emphasis --
  // only cross-segment emphasis needs the placeholder machinery, so a plain
  // "$x^2$ next to text" body renders through exactly the old path.
  const combined = buildPlaceholderString(parts);
  const tree = parseEmphasis(combined);
  return (
    <span className="whitespace-pre-wrap">
      <EmphasisNodes nodes={tree} parts={parts} keyPrefix="i" />
    </span>
  );
}

const isSeparator = (line: string) => /^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/.test(line);
const cells = (line: string) =>
  line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

/* ------------------------------------------------------------------------ *
 * HTML <table> with colspan/rowspan (Accounts ledgers, journal entries,
 * grouped-header frequency tables). GFM pipe tables (above) cover the simple
 * grid case; this covers the merged-cell case OCR emits as literal <table>
 * markup. Extracted with a narrow regex scan rather than a real HTML parser
 * or DOMPurify -- see the SECURITY MODEL note at the top of this file for
 * why that is the deliberate choice here: every cell's inner text is handed
 * to the SAME `segment()`/`Inline` pipeline as any other text, never to
 * dangerouslySetInnerHTML, so a `<script>` or `onclick=` inside a cell is
 * just inert visible text, not a parsed, executable tag.
 * ------------------------------------------------------------------------ */
interface HtmlTableCell {
  tag: 'td' | 'th';
  content: string;
  colSpan?: number;
  rowSpan?: number;
}
interface HtmlTableRow {
  cells: HtmlTableCell[];
}

const decodeBasicEntities = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');

function clampSpan(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 1) return undefined;
  return Math.min(50, n);
}

/** Parses a `<table>...</table>` string into rows of cells. Only ever reads
 *  `<tr>`, `<td>`/`<th>` and their `colspan`/`rowspan` attributes -- anything
 *  else in the markup (other tags, other attributes) is simply never looked
 *  at, which is the whitelist: nothing unrecognised gets a code path that
 *  could act on it. Returns null if the block doesn't actually contain a
 *  table with at least one row, so callers can fall through to the normal
 *  paragraph branch instead of rendering an empty table. */
export function parseHtmlTable(block: string): HtmlTableRow[] | null {
  const tableMatch = block.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return null;

  const rowMatches = [...tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (rowMatches.length === 0) return null;

  const rows: HtmlTableRow[] = rowMatches.map((rowMatch) => {
    const cellMatches = [...rowMatch[1].matchAll(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi)];
    const rowCells: HtmlTableCell[] = cellMatches.map((cellMatch) => {
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
    return { cells: rowCells };
  });

  return rows.some((r) => r.cells.length > 0) ? rows : null;
}

function HtmlTable({ rows }: { rows: HtmlTableRow[] }) {
  return (
    <div className="my-3 -mx-1 overflow-x-auto px-1">
      <table className="w-max min-w-full border-collapse text-[14px]">
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.cells.map((cell, ci) => {
                const className =
                  cell.tag === 'th'
                    ? 'whitespace-nowrap border border-warm-hairline bg-card px-3 py-2 text-left font-bold text-foreground align-top'
                    : 'border border-warm-hairline px-3 py-2 text-foreground align-top';
                const content = <Inline parts={segment(cell.content)} />;
                return cell.tag === 'th' ? (
                  <th key={ci} colSpan={cell.colSpan} rowSpan={cell.rowSpan} className={className}>
                    {content}
                  </th>
                ) : (
                  <td key={ci} colSpan={cell.colSpan} rowSpan={cell.rowSpan} className={className}>
                    {content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Block({ block }: { block: string }) {
  // Raw HTML <table>, checked before the pipe-table branch: OCR emits this
  // for merged-cell ledgers and grouped-header tables, which a pipe row can't
  // express at all (see UnlimitedOCR/playbook/RENDERER_TODO.md item 3).
  if (/^\s*<table[\s>]/i.test(block.trim())) {
    const rows = parseHtmlTable(block);
    if (rows) return <HtmlTable rows={rows} />;
    // Malformed/unrecognised table markup: fall through to the normal
    // paragraph path below rather than showing nothing.
  }

  const lines = block.split('\n');
  const pipeLines = lines.filter((l) => l.trim().startsWith('|'));

  /* A table: pipe rows plus a --- separator. Rendered as a real table because
     these carry the data the question is ABOUT (a frequency distribution is
     the whole question), and as raw pipes they were unreadable. */
  if (pipeLines.length >= 2 && lines.some(isSeparator)) {
    const rows = pipeLines.filter((l) => !isSeparator(l)).map(cells);
    const [head, ...body] = rows;
    return (
      <div className="my-3 -mx-1 overflow-x-auto px-1">
        <table className="w-max min-w-full border-collapse text-[14px]">
          <thead>
            <tr>
              {head.map((c, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap border border-warm-hairline bg-card px-3 py-2 text-left font-bold text-foreground"
                >
                  <Inline parts={segment(c)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td
                    key={ci}
                    className="whitespace-nowrap border border-warm-hairline px-3 py-2 text-foreground"
                  >
                    <Inline parts={segment(c)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  /* A list: every non-empty line starts with a dash or star. */
  const listItems = lines.filter((l) => l.trim());
  if (listItems.length > 0 && listItems.every((l) => /^\s*[-*]\s+/.test(l))) {
    return (
      <ul className="my-2 grid gap-1.5 pl-1">
        {listItems.map((l, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 flex-none rounded-full bg-warm-label" />
            <span className="min-w-0">
              <Inline parts={segment(l.replace(/^\s*[-*]\s+/, ''))} />
            </span>
          </li>
        ))}
      </ul>
    );
  }

  /* Otherwise a paragraph. Display maths inside it still gets its own
     scroller — a long equation is the one thing here that cannot wrap. */
  const parts = segment(block);
  const hasDisplay = parts.some((p) => p.kind === 'math' && p.display);
  if (!hasDisplay) {
    return (
      <p className="[&:not(:first-child)]:mt-2">
        <Inline parts={parts} />
      </p>
    );
  }
  return (
    <div className="[&:not(:first-child)]:mt-2">
      {parts.map((p, i) => {
        if (p.kind === 'math' && p.display) {
          const html = render(p.value, true);
          return html ? (
            <div key={i} className="-mx-1 my-3 overflow-x-auto px-1 py-1" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <div key={i} className="my-3 whitespace-pre-wrap font-mono text-[13px] text-warm-secondary">
              {p.value}
            </div>
          );
        }
        return <Inline key={i} parts={[p]} />;
      })}
    </div>
  );
}

export function MathText({ text, className = '' }: { text: string; className?: string }) {
  /* Blank lines are the source's own paragraph breaks. Splitting on them and
     spacing the blocks beats `whitespace-pre-wrap` over the whole string,
     which turned every one into a full empty line of dead space. */
  const blocks = useMemo(
    () => text.split(/\n\s*\n/).map((b) => b.replace(/\s+$/, '')).filter((b) => b.trim() !== ''),
    [text],
  );

  // One re-render trigger for the whole component once mhchem finishes
  // loading, so a `\ce` span that rendered blank on the first pass (module
  // not loaded yet) gets a second, correct pass. See `render()` above for
  // why the katexCache deliberately skips this tex until then.
  const [, forceRerender] = useState(0);
  const needsMhchem = useMemo(() => NEEDS_MHCHEM_RE.test(text), [text]);
  useEffect(() => {
    if (!needsMhchem || mhchemLoaded) return;
    let cancelled = false;
    ensureMhchemLoaded().then(() => {
      if (!cancelled) forceRerender((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [needsMhchem]);

  return (
    <div className={className}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}
