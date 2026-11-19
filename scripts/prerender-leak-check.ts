/**
 * Pure logic behind assertNoQuestionText() in prerender.ts, split out so it
 * is testable without a live Supabase call or a real dist/ directory. The
 * network fetch and filesystem reads stay in prerender.ts; this file only
 * has the part that decides what counts as a leak.
 */

/**
 * A distinctive run of words per question body, not the whole body: templates
 * wrap and truncate, so an exact full-string match would miss a partial leak.
 * Bodies under 30 chars after trimming to 8 words are dropped as too generic
 * to prove anything (a false match on common phrasing is worse than no check).
 */
export function extractLeakNeedles(bodies: string[]): string[] {
  return bodies
    .map((body) => (body || '').trim().split(/\s+/).slice(0, 8).join(' '))
    .filter((s) => s.length > 30);
}

/** The first (file, needle) pair where a needle's text appears in that file's HTML, or null if none leaked. */
export function findLeak(
  needles: string[],
  files: Array<{ path: string; html: string }>,
): { path: string; needle: string } | null {
  for (const file of files) {
    for (const needle of needles) {
      if (file.html.includes(needle)) return { path: file.path, needle };
    }
  }
  return null;
}
