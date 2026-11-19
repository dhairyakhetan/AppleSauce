/**
 * Render text whose glyphs are correct and whose codepoints are not.
 *
 * WHAT THIS IS. Every character below is swapped for a different Unicode
 * codepoint that draws the same shape -- Latin "a" becomes Cyrillic "а"
 * (U+0430), "e" becomes "е" (U+0435), "P" becomes Greek "Ρ" (U+03A1). The page
 * looks identical. `element.textContent` and `element.innerText` both come
 * back as a mix of Cyrillic, Greek and Latin that is not the question.
 *
 * WHY THIS FORM RATHER THAN A SCRAMBLED FONT. The stronger technique ships a
 * custom font whose codepoints are deliberately mismapped, which is arbitrary
 * and cannot be undone without the font file. It is not reachable here:
 * Google Fonts serves woff2 only, opentype.js cannot read woff2, and
 * decompressing it needs a native dependency -- the same native dependency
 * this project deliberately avoids because nobody can read the Vercel build
 * logs to diagnose a failed install. Generating the font from a different
 * typeface instead would mean question text renders in a face the design
 * never chose. So: same idea, no font, no build step, no way for it to take
 * the reader's page down.
 *
 * HOW STRONG IT ACTUALLY IS, stated plainly so nobody over-trusts it:
 *   - a scraper doing textContent/innerText gets unusable text        YES
 *   - keyword matching and diffing against the real bank fails        YES
 *   - pasting it somewhere useful fails                               YES
 *   - someone who knows the trick can reverse it with a lookup table  ALSO YES
 * Homoglyph maps are public. This raises the cost and makes the theft obvious
 * and attributable; it does not make it impossible. Nothing at the DOM layer
 * can, because the browser has to be given something to draw.
 *
 * It is also irrelevant to the path that actually matters: a scraper calling
 * bank_paper_questions() over REST never renders anything and never sees this
 * code. That path is closed server-side, in supabase/migrations.
 *
 * WHAT IS DELIBERATELY NOT SUBSTITUTED:
 *   digits           a question's marks, numbering and mathematics have to
 *                    stay real digits; a homoglyph digit is a wrong answer
 *   maths spans      KaTeX parses LaTeX, and a Cyrillic "х" is not "x"
 *   headings and UI  so the page stays navigable and Ctrl+F still finds the
 *                    controls
 *   search input     the in-paper filter matches against the ORIGINAL text,
 *                    never the substituted output
 *
 * Accessibility: a screen reader announces these as the Cyrillic and Greek
 * letters they are, so protected prose is degraded for blind readers. That is
 * the owner's explicit decision, recorded here rather than left implicit,
 * because it is a real cost to a real group of students and the next person
 * reading this file should know it was chosen rather than overlooked.
 */

/* Only pairs that are visually identical in the faces this site ships (Geist,
   Archivo) and in the common fallbacks. Letters with no dependable lookalike
   -- b, d, f, g, etc. -- are left alone: a substitution that renders subtly
   wrong is worse than no substitution, because it makes the product look
   broken to the reader while barely inconveniencing a scraper. */
const HOMOGLYPHS: Record<string, string> = {
  // Latin -> Cyrillic
  a: 'а', c: 'с', e: 'е', i: 'і', j: 'ј',
  o: 'о', p: 'р', s: 'ѕ', x: 'х', y: 'у',
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н',
  K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т',
  X: 'Х', Y: 'У',
  // Latin -> Greek, for the capitals Cyrillic does not cover
  I: 'Ι', N: 'Ν', Z: 'Ζ',
};

/** True when substitution would change anything at all. */
export function hasSubstitutableChars(text: string): boolean {
  for (const ch of text) if (ch in HOMOGLYPHS) return true;
  return false;
}

/**
 * Substitute a plain text run.
 *
 * Call this on TEXT ONLY -- never on a string that still contains LaTeX,
 * markup or a URL. The maths renderer segments a question first and hands
 * only its prose segments here, so `$x^2$` reaches KaTeX with a real Latin x.
 */
export function substituteGlyphs(text: string): string {
  let out = '';
  for (const ch of text) out += HOMOGLYPHS[ch] ?? ch;
  return out;
}

/**
 * Undo it.
 *
 * Needed because the product itself has to read this text back: the in-paper
 * search filter and any future highlighting work on the original string, and
 * a bug where those quietly stopped matching would be hard to spot. Having the
 * inverse in the same file also makes the honest point visible -- this is a
 * substitution cipher, and a reversible one.
 */
const REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(HOMOGLYPHS).map(([latin, sub]) => [sub, latin]),
);

export function restoreGlyphs(text: string): string {
  let out = '';
  for (const ch of text) out += REVERSE[ch] ?? ch;
  return out;
}

/**
 * Substitute only the text between tags in an HTML string.
 *
 * The teacher bio arrives as sanitised HTML and is bound with
 * dangerouslySetInnerHTML, so running substituteGlyphs over the whole string
 * would rewrite the markup itself: `<p>` would become `<р>` with a Cyrillic
 * er, and the paragraph would stop being a paragraph. Every character inside
 * `<...>` is therefore left alone.
 *
 * HTML entities are skipped for the same reason -- `&amp;` with a Cyrillic "а"
 * is not an entity any more, it is the literal text "&аmp;" on the page.
 *
 * The input is already DOMPurify-sanitised before it reaches here, so this
 * only has to avoid corrupting well-formed markup, not defend against hostile
 * markup.
 */
export function substituteGlyphsInHtml(html: string): string {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const ch = html[i];

    if (ch === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) { out += html.slice(i); break; }
      out += html.slice(i, close + 1);
      i = close + 1;
      continue;
    }

    if (ch === '&') {
      const semi = html.indexOf(';', i);
      // A real entity is short and has no whitespace; anything else is a
      // literal ampersand and can be treated as ordinary text.
      if (semi !== -1 && semi - i <= 10 && !/\s/.test(html.slice(i, semi))) {
        out += html.slice(i, semi + 1);
        i = semi + 1;
        continue;
      }
    }

    out += HOMOGLYPHS[ch] ?? ch;
    i += 1;
  }
  return out;
}
