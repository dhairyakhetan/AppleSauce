/**
 * Papers kept out of the sitemap and out of prerendering.
 *
 * Their question bodies are extraction failures, not questions -- literal
 * "Question-3", and in one case "Questlon-1", which is an OCR misread of the
 * word itself. 99 such bodies exist across the bank, concentrated in these
 * papers; 1,222 bodies are under 15 characters in total (2.6% of 46,873).
 *
 * They matter because of what shipped around them. Each still has a real
 * bank_papers row, so each got a sitemap entry, a prerendered page, a meta
 * description advertising its question count, and LearningResource JSON-LD --
 * a page that promises 20 questions and contains nothing readable. That is
 * textbook thin content, pointed at by our own sitemap, at the exact moment
 * we are asking Google to crawl 1,857 URLs for the first time.
 *
 * WHY A HARDCODED LIST, WHICH IS OBVIOUSLY NOT THE RIGHT LONG-TERM ANSWER:
 * deciding this properly means reading bank_questions.body, and both scripts
 * authenticate with the anon key, which has no SELECT on that column. That
 * restriction is deliberate and worth keeping -- it is what makes the
 * prerenderer incapable of leaking question text.
 *
 * I checked for a signal on bank_papers that anon CAN read, and there isn't
 * one. `marks = 0` looked promising and is not: 235 published papers have it
 * and 218 of them are perfectly good, so excluding on marks would drop 218
 * real papers to remove 24. question_count mismatches catch exactly one.
 *
 * THE REAL FIX, when the database is writable: a generated boolean on
 * bank_papers (say `has_readable_body`), maintained at import time the way
 * `school` and `has_school` already are, and filtered in the query. Then this
 * file is deleted. Until then an explicit list of 24 ids is honest, reviewable
 * and immediate, where a proxy signal would be quietly wrong 218 times.
 *
 * Regenerate with:
 *
 *   with per_paper as (
 *     select q.paper_id, count(*) actual,
 *            count(*) filter (where length(trim(q.body)) < 15) short
 *     from public.bank_questions q group by q.paper_id
 *   )
 *   select p.id, p.school, p.subject, p.year, pp.short, pp.actual
 *   from public.bank_papers p join per_paper pp on pp.paper_id = p.id
 *   where p.is_published
 *     and (pp.short::numeric / pp.actual > 0.5
 *          or pp.actual < 3
 *          or p.question_count <> pp.actual);
 *
 * Generated 2026-09-17. Re-run after every bank import.
 */
export const EXCLUDED_PAPER_IDS: ReadonlySet<string> = new Set([
  'f82ae5', // ASC English 2023 - 5/5 placeholder
  '003ddd', // ASC English - 5/5 placeholder
  'a5f211', // Gokuldham High School English - 7/13 placeholder
  '01cd7b', // Gokuldham High School English - 7/13 placeholder
  '747f84', // ICSE board paper English - 17/20 placeholder
  '7524e9', // ICSE board paper Economics 2018 - 10/10 placeholder
  'd8c245', // ICSE board paper Economics 2017 - 11/11 placeholder
  '13626b', // ISC board paper Economics 2018 - 6/6 placeholder
  '321d5c', // ISC board paper English - 3/5 placeholder
  '7a5af6', // Loreto House English - 5/5 placeholder
  '5392af', // Loreto House Annual Examination English 2025-26 - 5/5 placeholder
  '0d5842', // Mahadevi Birla Shishu Vihar English - 5/5 placeholder
  '8ee195', // Mahadevi Birla Shishu Vihar IX Half Yearly English 2024-25 - 5/5 placeholder
  '1ae04d', // School not recorded English 2025 - 3/3 placeholder, and question_count says 15
  'e644e2', // School not recorded History & Civics 2022-23 - only 2 questions
  '81ae07', // School not recorded English - 17/30 placeholder
  'f5a9cc', // School not recorded English 2018 - 17/20 placeholder
  '2f7f25', // Sem Board EP I10 English 2022 - 17/30 placeholder
  '56b51d', // Sri Sri Academy English - 5/5 placeholder
  'aad38f', // Sri Sri Academy Annual Examination English 2025-26 - 5/5 placeholder
  '6b35f6', // St Xaviers Collegiate School English 2024 - 3/5 placeholder
  '54a81d', // St. Xaviers Collegiate School English - 3/5 placeholder
  '72bb47', // UHS English 21-22 - 7/13 placeholder
  '481195', // UHS English - 7/13 placeholder
]);

/**
 * Excluding a paper must not silently delete its school's page.
 *
 * A school whose only papers are all excluded has nothing to list, so its
 * /school/:slug page would render an empty hub -- swapping one thin page for
 * another. Callers filter papers first, then derive schools from what
 * survives, which drops such a school naturally.
 */
export function isExcludedPaper(id: string): boolean {
  return EXCLUDED_PAPER_IDS.has(id);
}
