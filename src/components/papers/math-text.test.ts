import { describe, expect, it } from 'vitest';
import katex from 'katex';

import { buildPlaceholderString, parseEmphasis, parseHtmlTable, segment, type EmphNode } from './math-text';

/**
 * These tests exist because W8 (docs/GUARDRAILS.md, UnlimitedOCR/playbook/
 * RENDERER_TODO.md) ports markdown-ish emphasis, mhchem and merged-cell
 * tables into the live renderer for the first time. `segment()` already
 * shipped and is covered only incidentally here (its own math-vs-text split
 * must keep working exactly as before, since every new construct below is
 * built to run AFTER it, never instead of it). The real risk this file
 * guards against is the one the task spec calls out by name: a lone `*` or
 * `$` that happens to sit in ordinary prose ("2*3", "a * b", a currency
 * figure) must never be misread as markup.
 */

function flatten(nodes: EmphNode[]): string {
  return nodes
    .map((n) => (n.kind === 'text' ? n.value : `<${n.tag}>${flatten(n.children)}</${n.tag}>`))
    .join('');
}

describe('parseEmphasis', () => {
  it('renders **bold**, *italic*, ~~strike~~, <u>, <sub>, <sup> each alone', () => {
    expect(flatten(parseEmphasis('**bold**'))).toBe('<strong>bold</strong>');
    expect(flatten(parseEmphasis('*italic*'))).toBe('<em>italic</em>');
    expect(flatten(parseEmphasis('~~strike~~'))).toBe('<s>strike</s>');
    expect(flatten(parseEmphasis('<u>x</u>'))).toBe('<u>x</u>');
    expect(flatten(parseEmphasis('<sub>2</sub>'))).toBe('<sub>2</sub>');
    expect(flatten(parseEmphasis('<sup>2</sup>'))).toBe('<sup>2</sup>');
  });

  it('nests italic inside bold', () => {
    const out = parseEmphasis('**bold with *nested italic* inside**');
    expect(flatten(out)).toBe('<strong>bold with <em>nested italic</em> inside</strong>');
  });

  it('does not turn a lone multiplication asterisk into italics', () => {
    expect(flatten(parseEmphasis('2*3'))).toBe('2*3');
    expect(parseEmphasis('2*3')).toEqual([{ kind: 'text', value: '2*3' }]);
  });

  it('does not turn spaced asterisks used as a multiplication sign into italics', () => {
    // "a * b" has flanking whitespace on both sides of the star, so it can
    // never be read as an opening OR closing emphasis delimiter -- the
    // CommonMark flanking rule this file borrows specifically to keep
    // "costs $5 * 3 = $15" (etc.) from ever becoming markup.
    const text = 'a * b and c * d';
    expect(flatten(parseEmphasis(text))).toBe(text);
  });

  it('keeps a real word wrapped tightly in single stars as italic even with no spaces', () => {
    // Mirrors the auditor renderer's own edge case: no-space-required
    // markdown emphasis, not a word-boundary rule.
    expect(flatten(parseEmphasis('not*italic*because*no*spaces'))).toBe(
      'not<em>italic</em>because<em>no</em>spaces',
    );
  });

  it('handles bold and italic side by side without one eating the other', () => {
    expect(flatten(parseEmphasis('**bold** then *italic*'))).toBe(
      '<strong>bold</strong> then <em>italic</em>',
    );
  });

  it('leaves plain text with no markers untouched', () => {
    const text = 'Find the value of x in the given triangle ABC.';
    expect(parseEmphasis(text)).toEqual([{ kind: 'text', value: text }]);
  });
});

describe('segment + parseEmphasis together (math is never touched by emphasis)', () => {
  it('a body with $x^2$ math next to **bold** prose renders both correctly', () => {
    const segs = segment('The area is **shaded**: $x^2$ square units.');
    expect(segs.map((s) => s.kind)).toEqual(['text', 'math', 'text']);
    const textBefore = segs[0].value;
    expect(flatten(parseEmphasis(textBefore))).toBe('The area is <strong>shaded</strong>: ');
    expect(segs[1].value).toBe('x^2');
  });

  it('pairs bold delimiters that wrap an inline math span (real live data: paper 07eae7)', () => {
    // Found on the live bank while browser-verifying this change: "**1. The
    // equation ... $3x + 4y + 7 = 0$ is**" -- segment() splits this into
    // [text, math, text], so parsing each text Seg alone leaves an unpaired
    // opening "**" in the first and an unpaired closing "**" in the second.
    // `Inline` fixes this by parsing emphasis across the WHOLE Seg run using
    // a placeholder for the math Seg (see buildPlaceholderString); this test
    // locks in that the placeholder string pairs correctly.
    const body =
      '**1. The equation of the line passing through origin and parallel to the line $3x + 4y + 7 = 0$ is**';
    const segs = segment(body);
    expect(segs.map((s) => s.kind)).toEqual(['text', 'math', 'text']);
    const combined = buildPlaceholderString(segs);
    const tree = parseEmphasis(combined);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ kind: 'tag', tag: 'strong' });
    // The math placeholder survives inside the bold run's children, ready for
    // Inline to splice the rendered formula back in.
    const inner = tree[0].kind === 'tag' ? flatten(tree[0].children) : '';
    expect(inner).toContain('');
  });

  it('a lone star inside a math span is never seen by the emphasis parser', () => {
    // segment() extracts $2*3=6$ as a single math segment; parseEmphasis is
    // never even run on it, so the multiplication star inside LaTeX can't be
    // misread as emphasis regardless of the emphasis rules above.
    const segs = segment('Compute: $2*3=6$');
    expect(segs.some((s) => s.kind === 'math' && s.value === '2*3=6')).toBe(true);
  });

  it('a currency $ does not break a nearby **bold** run', () => {
    const segs = segment('It costs **more** than $10 today.');
    // Single unmatched $ falls through as plain text (existing documented
    // behaviour), and the bold markup on the other side of it is unaffected.
    const joinedText = segs.filter((s) => s.kind === 'text').map((s) => s.value).join('');
    expect(flatten(parseEmphasis(joinedText.split('$10')[0]))).toContain('<strong>more</strong>');
  });
});

describe('parseHtmlTable', () => {
  it('parses a simple table with no colspan/rowspan', () => {
    const html =
      '<table><tr><td>dividend paid by the company.</td><td>[2]</td></tr>' +
      '<tr><td>Net profit before tax</td><td>Rs 20,00,000</td></tr></table>';
    const rows = parseHtmlTable(html);
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows?.[0].cells.map((c) => c.content)).toEqual(['dividend paid by the company.', '[2]']);
    expect(rows?.[0].cells[0].colSpan).toBeUndefined();
  });

  it('parses colspan and rowspan attributes', () => {
    const html =
      '<table><tr><td colspan="2">Total</td></tr>' +
      '<tr><th rowspan="2">Class</th><td>10</td></tr></table>';
    const rows = parseHtmlTable(html);
    expect(rows?.[0].cells[0]).toMatchObject({ tag: 'td', content: 'Total', colSpan: 2 });
    expect(rows?.[1].cells[0]).toMatchObject({ tag: 'th', content: 'Class', rowSpan: 2 });
  });

  it('never produces an executable tag from a malicious cell -- script text is inert content, not markup', () => {
    const html = '<table><tr><td><script>alert(1)</script></td><td onclick="evil()">x</td></tr></table>';
    // Malformed second cell (unterminated tag) aside, the point of this test
    // is structural: parseHtmlTable only ever extracts tag name + colspan/
    // rowspan + inner text via regex. There is no code path here that turns
    // that inner text into a real <script> element or copies an onclick
    // attribute onto anything -- HtmlTable (the React component) renders each
    // cell's `content` through segment()/Inline, which builds <strong>/<em>/
    // etc. React elements directly and never calls dangerouslySetInnerHTML on
    // untrusted text. This test locks in that the extracted content is a
    // plain string, not something that gets interpreted as HTML again.
    const rows = parseHtmlTable(html);
    expect(rows).not.toBeNull();
    // The cell's `content` is captured as an opaque string (here, literally
    // containing the characters "<script>alert(1)</script>"). That is fine
    // and expected: HtmlTable/Inline never interpret this string as HTML --
    // it goes through segment()/parseEmphasis and is rendered as React text
    // nodes, so the browser sees the literal characters "<script>...", never
    // a real <script> element. Confirmed via the emphasis pipeline below:
    // it produces a single plain-text node, not a `tag` node.
    const rendered = parseEmphasis(rows![0].cells[0].content);
    expect(rendered.every((n) => n.kind === 'text')).toBe(true);
  });

  it('returns null for a block with no real table markup, so callers fall back to a normal paragraph', () => {
    expect(parseHtmlTable('just some prose with <b>bold</b> in it')).toBeNull();
  });

  it('lets a table cell contain math, resolved the same way as any other text', () => {
    const html = '<table><tr><td>$x^2$</td></tr></table>';
    const rows = parseHtmlTable(html);
    const cellSegs = segment(rows![0].cells[0].content);
    expect(cellSegs.some((s) => s.kind === 'math' && s.value === 'x^2')).toBe(true);
  });
});

describe('mhchem (\\ce) support', () => {
  it('KaTeX renders \\ce{...} without throwing once katex/contrib/mhchem is loaded', async () => {
    await import('katex/contrib/mhchem');
    expect(() =>
      katex.renderToString('\\ce{2H2 + O2 -> 2H2O}', { throwOnError: true, strict: false }),
    ).not.toThrow();
    expect(() =>
      katex.renderToString('\\ce{Fe^{3+} + e- -> Fe^{2+}}', { throwOnError: true, strict: false }),
    ).not.toThrow();
  });

  it('display \\ce{...} works the same as inline', async () => {
    await import('katex/contrib/mhchem');
    expect(() =>
      katex.renderToString('\\ce{2H2 + O2 -> 2H2O}', { throwOnError: true, strict: false, displayMode: true }),
    ).not.toThrow();
  });

  it('an ordinary KaTeX macro next to \\ce still works (mhchem does not change core behaviour)', async () => {
    await import('katex/contrib/mhchem');
    const plain = katex.renderToString('x^2', { throwOnError: true, strict: false });
    expect(plain).toContain('katex');
    expect(() => katex.renderToString('\\ce{H2O}', { throwOnError: true, strict: false })).not.toThrow();
  });
});
