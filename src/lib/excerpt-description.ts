/**
 * SEO/content audit finding: 66 of 147 stored teacher bios (teachers_list.bio
 * / Shikshaqmine.Description) have a large keyword-stuffed SEO block appended
 * after the genuine opening paragraph(s) — exactly the pattern Google's spam
 * policies penalize, and it also renders as the visible "About" section on
 * the profile page. The stuffing format varies per record (emoji section
 * headers, "---" dividers, a raw pipe-separated keyword dump at the end), so
 * rather than pattern-match each variant this keeps a fixed-length excerpt
 * from the start, cut at the nearest sentence boundary. Every sampled record
 * had its genuine opening intact well within a few hundred characters.
 *
 * Nothing in the stored data is modified — only what gets rendered/exposed.
 * A description already shorter than maxLength passes through unchanged.
 */
export function excerptDescription(text: string, maxLength: number): string {
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (plain.length <= maxLength) return text.trim();

  const slice = plain.slice(0, maxLength);
  const lastSentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  if (lastSentenceEnd > maxLength * 0.4) {
    return slice.slice(0, lastSentenceEnd + 1).trim();
  }
  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim()}…`;
}
