import { useMemo } from 'react';
import katex from 'katex';

/* A small, tappable "how it looks" preview for one maths segment in the
 * checker's visual editor (BodyEditor.tsx). Deliberately separate from
 * MathText (src/components/papers/math-text.tsx): that component renders a
 * whole question body (paragraphs, tables, emphasis); this one only ever
 * renders a single formula's LaTeX, so it needs none of that machinery.
 *
 * Same trust boundary as MathText's own KaTeX use: `throwOnError: false,
 * strict: false, trust: false`, and the only dangerouslySetInnerHTML here is
 * KaTeX's own generated markup, not the LaTeX source string itself. */
export function MathPreview({ latex, display, className = '' }: { latex: string; display: boolean; className?: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, { displayMode: display, throwOnError: false, strict: false, trust: false });
    } catch {
      return '';
    }
  }, [latex, display]);

  if (!html) {
    // Unrenderable LaTeX (mid-edit, or a macro KaTeX doesn't know): show the
    // raw source rather than a blank tappable box with nothing in it.
    return <span className={className}>{latex}</span>;
  }
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
