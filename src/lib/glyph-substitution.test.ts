import { describe, expect, it } from 'vitest';

import {
  hasSubstitutableChars,
  restoreGlyphs,
  substituteGlyphs,
  substituteGlyphsInHtml,
} from './glyph-substitution';

/**
 * These tests exist because this file sits directly on top of the one rule the
 * project does not bend: question-paper text is rendered byte-exact from
 * bank_questions.body. Substitution deliberately changes the codepoints a
 * scraper reads, so the product itself has to be able to get the original
 * string back -- the in-paper search filter matches against it. If the inverse
 * were ever lossy, search would quietly stop finding words that are visibly on
 * the page, which is close to unfindable by hand.
 */

const QUESTION_LIKE = [
  'Find the value of x in the given triangle ABC.',
  'A shopkeeper buys an article for Rs 2,400 and marks it up by 20%.',
  'Prove that the tangent at any point of a circle is perpendicular to the radius.',
  'State whether the following statement is true or false, and justify your answer.',
  'In the figure, O is the centre and PQ is a chord. Calculate angle OPQ.',
];

describe('round trip', () => {
  it.each(QUESTION_LIKE)('restores %s', (original) => {
    expect(restoreGlyphs(substituteGlyphs(original))).toBe(original);
  });

  it('restores every printable ASCII character', () => {
    let ascii = '';
    for (let code = 32; code < 127; code += 1) ascii += String.fromCharCode(code);
    expect(restoreGlyphs(substituteGlyphs(ascii))).toBe(ascii);
  });

  it('actually changes the codepoints, so the round trip is not passing trivially', () => {
    const original = QUESTION_LIKE[0];
    expect(substituteGlyphs(original)).not.toBe(original);
  });
});

describe('the substitution map', () => {
  /* Read the map back out through the public surface rather than exporting it
     purely for a test: one substituted character per key is enough to pin the
     invariants that matter. */
  const LATIN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const substitutedPairs = [...LATIN]
    .map((ch) => [ch, substituteGlyphs(ch)] as const)
    .filter(([ch, sub]) => ch !== sub);

  it('maps no digit, because a homoglyph digit is a wrong answer', () => {
    for (const digit of '0123456789') {
      expect(substituteGlyphs(digit)).toBe(digit);
    }
  });

  it('maps no character to itself', () => {
    for (const [ch, sub] of substitutedPairs) expect(sub).not.toBe(ch);
  });

  it('is injective, so restoring is never ambiguous', () => {
    /* If two Latin letters shared a substitute, restoreGlyphs would have to
       guess which one it came from and the round trip above would be a
       coin flip on real text. */
    const substitutes = substitutedPairs.map(([, sub]) => sub);
    expect(new Set(substitutes).size).toBe(substitutes.length);
  });

  it('never substitutes a character that is itself a substitute', () => {
    /* Otherwise substitution would not be idempotent-safe: running it twice,
       or over text that already contains one of these codepoints, would walk
       the character further away and break the inverse. */
    for (const [, sub] of substitutedPairs) {
      expect(substituteGlyphs(sub)).toBe(sub);
    }
  });

  it('leaves mathematical punctuation alone', () => {
    const maths = '+-*/=<>()[]{}^_$.,;:%';
    expect(substituteGlyphs(maths)).toBe(maths);
  });
});

describe('hasSubstitutableChars', () => {
  it('is true for ordinary prose', () => {
    expect(hasSubstitutableChars('Calculate the area')).toBe(true);
  });

  it('is false for a string with nothing to substitute', () => {
    expect(hasSubstitutableChars('1234 + 5678 = ?')).toBe(false);
  });

  it('agrees with substituteGlyphs on whether anything changes', () => {
    for (const text of [...QUESTION_LIKE, '1234', '', '$x^2$', '!!!']) {
      expect(hasSubstitutableChars(text)).toBe(substituteGlyphs(text) !== text);
    }
  });
});

describe('substituteGlyphsInHtml', () => {
  /* Teacher bios arrive as sanitised HTML and are bound with
     dangerouslySetInnerHTML. Substituting inside a tag turns <p> into <р> with
     a Cyrillic er, and the paragraph silently stops being a paragraph -- the
     bio would render as visible angle brackets on a live teacher profile. */

  it('leaves tag names untouched', () => {
    const out = substituteGlyphsInHtml('<p>Maths</p>');
    expect(out.startsWith('<p>')).toBe(true);
    expect(out.endsWith('</p>')).toBe(true);
  });

  it('substitutes the text between the tags', () => {
    const out = substituteGlyphsInHtml('<p>Maths</p>');
    expect(out).not.toBe('<p>Maths</p>');
    expect(restoreGlyphs(out)).toBe('<p>Maths</p>');
  });

  it('leaves attributes alone, including hrefs', () => {
    const html = '<a href="https://example.com/page" class="link">Read more</a>';
    const out = substituteGlyphsInHtml(html);
    expect(out).toContain('href="https://example.com/page"');
    expect(out).toContain('class="link"');
  });

  it('leaves HTML entities intact', () => {
    /* &amp; with a Cyrillic a is not an entity, it is the literal text
       "&аmp;" printed on the page. */
    const out = substituteGlyphsInHtml('<p>Physics &amp; Chemistry</p>');
    expect(out).toContain('&amp;');
  });

  it('treats a bare ampersand as ordinary text', () => {
    const out = substituteGlyphsInHtml('<p>you &amp; me, 5 & 6</p>');
    expect(out).toContain('&amp;');
    expect(restoreGlyphs(out)).toBe('<p>you &amp; me, 5 & 6</p>');
  });

  it('does not lose characters when a tag is unterminated', () => {
    /* Malformed input should degrade to "unsubstituted", never to "truncated".
       Dropping the tail would silently delete the end of a teacher's bio. */
    const html = '<p>Teaches maths<br';
    expect(restoreGlyphs(substituteGlyphsInHtml(html))).toBe(html);
  });

  it('round trips a realistic bio', () => {
    const bio =
      '<p>I have taught <strong>ICSE Mathematics</strong> for 12 years.</p>' +
      '<p>Classes are small &amp; focused. See <a href="/about">about</a>.</p>';
    expect(restoreGlyphs(substituteGlyphsInHtml(bio))).toBe(bio);
  });
});
