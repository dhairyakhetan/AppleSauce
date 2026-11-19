/**
 * Chapter names carry no em or en dashes. Mirrors the SQL in
 * supabase/migrations/20261005120000_chapter_names_no_dashes.sql exactly:
 * the first dash (with any surrounding whitespace) becomes ": ", every later
 * one becomes ", ". The data/question-bank*.json files are re-import sources
 * and stay untouched; this runs at generation time instead.
 */
export function chapterNameNoDashes(name: string): string {
  return name.replace(/\s*[—–]\s*/, ': ').replace(/\s*[—–]\s*/g, ', ');
}
