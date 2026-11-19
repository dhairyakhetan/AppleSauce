/**
 * Splits a question body into ordered text / maths segments, for the
 * checker's "Fix it" visual maths editor (paper checker Step 2, "Fix it"
 * mode). D76: the saved body must stay byte-identical to the original
 * everywhere the checker did not edit, so this module's one job is a
 * reassembly guarantee -- `segments.map(toRaw).join('')` must equal the
 * input `body` exactly whenever `fallback` is false and no segment's
 * `inner` has been changed by the caller.
 *
 * Recognises the same four delimiter forms `MathText`'s own `segment()`
 * (src/components/papers/math-text.tsx) treats as maths -- `$$...$$`,
 * `\[...\]`, `$...$`, `\(...\)` -- so a body edited here renders identically
 * to how readers already see it. Unlike that renderer, this module must be
 * conservative about ever being WRONG about where maths starts and ends,
 * because a wrong guess here would let the checker "edit" characters that
 * are not really a formula, or silently drop characters on reassembly. So:
 *
 * - `\$` (escaped dollar) is never treated as a delimiter.
 * - A lone `$` that looks like currency ("$5 and $10") is left as plain
 *   text rather than guessed at as an inline formula -- see
 *   `looksLikeCurrency` below for the exact rule.
 * - Any delimiter that never finds its close (an odd, unmatched `$`, an
 *   unterminated `\[`/`\(`/`$$`) makes the WHOLE body one plain-text
 *   segment (`fallback: true`), so the editor falls back to today's plain
 *   textarea instead of guessing at a broken split.
 */

export interface TextSegment {
  kind: 'text';
  /** Free-form editable text, exactly as it appears in the body. */
  value: string;
}

export interface MathSegment {
  kind: 'math';
  /** Opening delimiter: '$', '$$', '\\(' or '\\['. */
  open: string;
  /** Closing delimiter, always the partner of `open`. */
  close: string;
  /** The LaTeX between the delimiters, unedited unless the caller changes it. */
  inner: string;
  /** True for '$$'/'\\[' (display), false for '$'/'\\(' (inline). */
  display: boolean;
}

export type BodySegment = TextSegment | MathSegment;

export interface SegmentResult {
  segments: BodySegment[];
  /** True when the body could not be safely segmented (unbalanced
   *  delimiter); `segments` is then a single text segment holding the
   *  whole, untouched body, and the editor should show the plain textarea. */
  fallback: boolean;
}

/** The exact bytes a segment contributes to the reassembled body. */
export function segmentToRaw(segment: BodySegment): string {
  return segment.kind === 'text' ? segment.value : segment.open + segment.inner + segment.close;
}

/** Reassembles segments back into one body string. Byte-identical to the
 *  original input whenever no segment's `inner`/`value` has been changed. */
export function reassemble(segments: BodySegment[]): string {
  return segments.map(segmentToRaw).join('');
}

/** Common English connective words that show up between two currency `$`
 *  signs ("$5 and $10", "$5 to $10 a month") but never inside real LaTeX. */
const PROSE_WORD_RE = /[a-zA-Z]{2,}/;

/**
 * Whether the text between a candidate pair of single `$` signs reads like
 * currency / ordinary prose rather than a formula. Conservative on purpose:
 * anything with a LaTeX command, an exponent/subscript, or a comparison
 * operator is treated as real maths; anything else with a space AND an
 * ordinary word is treated as prose. Genuinely ambiguous short content
 * (a bare number, a single symbol) defaults to "not currency" -- i.e. still
 * treated as maths -- because that is what `$x$`, `$5$`, `$n$` mean in this
 * question bank far more often than they mean two currency amounts.
 */
export function looksLikeCurrency(inner: string): boolean {
  const s = inner.trim();
  if (!s) return true; // "$$" with nothing between -- not a formula worth editing
  if (/\\[a-zA-Z]/.test(s)) return false; // \frac, \sqrt, \pi, \ce, ...
  if (/[\^_]/.test(s)) return false; // exponent / subscript
  if (/[=<>]/.test(s)) return false; // equation / inequality
  if (!/\s/.test(s)) return false; // one unbroken token ("2x+3", "x", "5") -- treat as maths
  // Contains a space: maths with a space ("x + y") is common too, so only
  // call it currency when an actual English word sits in there ("and", "to").
  return PROSE_WORD_RE.test(s);
}

/**
 * Splits `body` into ordered text/maths segments. See the module doc for the
 * exact rules. Pure and total: every input string produces some result,
 * never throws.
 */
export function segmentBody(body: string): SegmentResult {
  const segments: BodySegment[] = [];
  const n = body.length;
  let i = 0;
  let textStart = 0;
  let unbalanced = false;

  const flushText = (end: number) => {
    if (end > textStart) segments.push({ kind: 'text', value: body.slice(textStart, end) });
  };

  while (i < n) {
    const c = body[i];

    if (c === '\\' && i + 1 < n) {
      const next = body[i + 1];
      if (next === '$') {
        // Escaped dollar: never a delimiter, stays inside the text run.
        i += 2;
        continue;
      }
      if (next === '[') {
        const closeIdx = body.indexOf('\\]', i + 2);
        if (closeIdx === -1) {
          unbalanced = true;
          break;
        }
        flushText(i);
        segments.push({ kind: 'math', open: '\\[', close: '\\]', inner: body.slice(i + 2, closeIdx), display: true });
        i = closeIdx + 2;
        textStart = i;
        continue;
      }
      if (next === '(') {
        const closeIdx = body.indexOf('\\)', i + 2);
        if (closeIdx === -1) {
          unbalanced = true;
          break;
        }
        flushText(i);
        segments.push({ kind: 'math', open: '\\(', close: '\\)', inner: body.slice(i + 2, closeIdx), display: false });
        i = closeIdx + 2;
        textStart = i;
        continue;
      }
      // Any other backslash escape (\\, \%, a stray \ before a letter that
      // is not an opener we handle): leave both characters as plain text,
      // and skip past both so `\)` or `\]` on their own are never mistaken
      // for a closer of a math span that never opened.
      i += 2;
      continue;
    }

    if (c === '$') {
      if (body[i + 1] === '$') {
        const closeIdx = body.indexOf('$$', i + 2);
        if (closeIdx === -1) {
          unbalanced = true;
          break;
        }
        flushText(i);
        segments.push({ kind: 'math', open: '$$', close: '$$', inner: body.slice(i + 2, closeIdx), display: true });
        i = closeIdx + 2;
        textStart = i;
        continue;
      }

      // Inline `$...$`: matches MathText's own rule of never crossing a
      // newline, and never matching an escaped `\$` as the closer.
      let j = i + 1;
      let found = -1;
      while (j < n) {
        if (body[j] === '\n') break;
        if (body[j] === '$' && body[j - 1] !== '\\') {
          found = j;
          break;
        }
        j++;
      }
      if (found === -1) {
        unbalanced = true;
        break;
      }
      const inner = body.slice(i + 1, found);
      if (looksLikeCurrency(inner)) {
        // Ambiguous. Two shapes need different treatment:
        //  - "$5 and profit is $x^2$" -- a THIRD `$` sits further along the
        //    same line, so `found` (the middle `$`) may yet be the OPENER of
        //    a real formula. Only the leading `$` is consumed as literal, and
        //    scanning resumes right after it so `found` gets re-examined.
        //  - "$5 and $10" -- nothing follows `found` on this line, so `found`
        //    can never pair with anything; both dollar signs of this pair
        //    are consumed as literal text together, or `found` would be left
        //    dangling and wrongly reported as an unbalanced delimiter.
        let hasFurtherDollarOnLine = false;
        for (let k = found + 1; k < n && body[k] !== '\n'; k++) {
          if (body[k] === '$' && body[k - 1] !== '\\') {
            hasFurtherDollarOnLine = true;
            break;
          }
        }
        i = hasFurtherDollarOnLine ? i + 1 : found + 1;
        continue;
      }
      flushText(i);
      segments.push({ kind: 'math', open: '$', close: '$', inner, display: false });
      i = found + 1;
      textStart = i;
      continue;
    }

    i++;
  }

  if (unbalanced) {
    return { segments: [{ kind: 'text', value: body }], fallback: true };
  }
  flushText(n);
  return { segments, fallback: false };
}
