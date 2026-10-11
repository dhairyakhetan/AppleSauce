/**
 * The whole PDF page, as scanned (owner, 2026-09-29: "Show as scanned"; every subject since 2026-10-03).
 *
 * When there is no trusted crop (checker-pictures.ts: no crop, or a crop
 * matched worse than DOUBTFUL_ALIGN_BELOW), a Maths question shows the whole
 * printed page it sits on, untouched, with a plain note telling the checker to
 * find the question on it. This overrides the 2026-09-28 "no trusted crop, no
 * picture" rule for Maths only. The old reason still holds for crops: a wrong
 * crop claims to BE the question, so a checker may "fix" correct words to
 * match it. A whole page claims nothing, so it cannot mislead that way.
 *
 * Page images live in the same private audit-figures bucket as the crops, at
 *
 *   pages/<audit_paper_id>/<page>.jpg
 *
 * `page` is 1-based, exactly as in audit_questions.source.page. They are read
 * the same way as crops: a short-lived signed URL, allowed by the existing
 * "paper checkers and admins can read audit figures" storage policy. Nothing
 * here is public and nothing is uploaded by the site.
 *
 * Everything in this file is pure so it can be tested without a browser.
 */

type Source = Record<string, unknown> | null | undefined;

/**
 * Subjects whose questions may show the whole page. Every subject now (owner,
 * 2026-10-03, PLAN_ROUND27 3.8: a student only checks with a picture). It was
 * Maths only. The gate that still holds is pageIsVerified: the pipeline
 * uploads a page image only for a page it checked against the PDF text, and
 * the database serves a question only when that image is registered in
 * audit_paper_pages (20261003160000). The function stays so a subject can be
 * excluded again in one place.
 */
export function isPageFallbackSubject(_subject?: string | null): boolean {
  return true;
}

/**
 * True only when the pipeline CHECKED the page against the PDF text
 * (locate_pages.py sets source.page_verified). An unverified page is the
 * aligner's guess and was wrong for about a third of questions, so it is
 * never shown: a wrong whole page is worse than none.
 */
export function pageIsVerified(source: Source): boolean {
  return source?.page_verified === true;
}

/** The 1-based page a question sits on, or null when the pipeline has not said. */
export function sourcePage(source: Source): number | null {
  const raw = source?.page;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Object path of one page image, or null when the paper id or page is not usable. */
export function pageObjectPath(auditPaperId: string | null | undefined, page: number | null): string | null {
  if (!auditPaperId || !UUID_RE.test(auditPaperId)) return null;
  if (page === null || !Number.isInteger(page) || page < 1) return null;
  return `pages/${auditPaperId}/${page}.jpg`;
}

export interface PagePlan {
  /** Object path inside the audit-figures bucket. */
  path: string;
  page: number;
  /** The plain note over the page: "Find question 6 on this page." */
  note: string;
}

/** "Find question 6 on this page." Uses the printed number only when it is short and plain. */
export function findQuestionNote(displayNumber: string | null | undefined): string {
  const n = (displayNumber ?? '').trim();
  if (n && n.length <= 12 && !/[\r\n]/.test(n)) return `Find question ${n} on this page.`;
  return 'Find this question on this page.';
}

/**
 * The whole-page fallback, or null. Only when the caller found no trusted crop
 * (`hasTrustedCrop` false), the subject may fall back, the pipeline
 * recorded which page the question is on, and it verified that page.
 */
export function planWholePage(
  question: {
    paper_id: string;
    display_number: string | null;
    subject: string | null;
    source: Source;
  },
  hasTrustedCrop: boolean,
): PagePlan | null {
  if (hasTrustedCrop) return null;
  if (!isPageFallbackSubject(question.subject)) return null;
  if (!pageIsVerified(question.source)) return null;
  const page = sourcePage(question.source);
  const path = pageObjectPath(question.paper_id, page);
  if (!path || page === null) return null;
  return { path, page, note: findQuestionNote(question.display_number) };
}

/**
 * Owner round 24 (2026-09-30): "students see the verified raw page always".
 * The verified page now sits beside every question that has one, crop or
 * not: the crop shows the question up close, the page shows where it sits
 * and what is printed around it. Same gates as before otherwise (any subject,
 * page_verified true, a usable page number).
 */
export function planVerifiedPage(question: {
  paper_id: string;
  display_number: string | null;
  subject: string | null;
  source: Source;
}): PagePlan | null {
  return planWholePage(question, false);
}

/** Zoom steps for the page viewer: 1 = the page fits the width of its panel. */
export const PAGE_ZOOM_STEPS = [1, 1.5, 2, 3] as const;

export function stepZoom(current: number, direction: 'in' | 'out'): number {
  const i = PAGE_ZOOM_STEPS.findIndex((z) => z >= current);
  const at = i === -1 ? PAGE_ZOOM_STEPS.length - 1 : i;
  const next = direction === 'in' ? Math.min(at + 1, PAGE_ZOOM_STEPS.length - 1) : Math.max(at - 1, 0);
  return PAGE_ZOOM_STEPS[next];
}

export const PAGE_HEADING = 'The printed page, as scanned';
