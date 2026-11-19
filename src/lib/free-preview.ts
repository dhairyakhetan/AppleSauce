/**
 * How many questions of a paper a signed-out reader gets.
 *
 * ⚠ THIS MUST MATCH THE DATABASE. The real gate is the `limit` inside
 * public.bank_paper_questions(), which decides from auth.uid() server-side --
 * this constant only exists so the copy that promises a number says the same
 * number. Changing one without the other makes the product lie to the reader.
 *
 * It was seven hardcoded "five"s across seven files: the papers announcement,
 * the browse nudge, the footer sentence, the product tour, About, a blog
 * aside, and BankPaper's own meta description. Each one is a promise made to
 * the reader before they open anything, so a stale number here is not a
 * cosmetic bug -- it is the page telling someone they will get five and then
 * withholding three of them.
 *
 * The gate moved to 2 when 20260918100000 was applied on 2026-09-18, so these
 * values moved with it. Nothing else should hardcode the number: import from
 * here, and the copy can never drift from the database again.
 */
export const FREE_PREVIEW_QUESTIONS = 2;

/** The same number as a word, for running prose. */
export const FREE_PREVIEW_WORD = 'two';
