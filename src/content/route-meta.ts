/**
 * Title and description for the top-level routes that used to ship no
 * prerendered content: /past-papers, /schools, /faq, /blog and
 * /all-tuition-teachers-in-kolkata.
 *
 * The page components (what the browser sets) and scripts/prerender.ts (what a
 * crawler that does not run JavaScript reads) both import from here, so the two
 * can never disagree. Wording is the pages' own existing copy, moved, not
 * rewritten. The home page's copy lives in src/lib/seo-defaults.ts because it
 * doubles as the restore value for every other route.
 */

export interface RouteMeta {
  title: string;
  description: string;
}

export const ROUTE_META = {
  allTeachers: {
    title: 'All Tuition Teachers in Kolkata | Shikshaq',
    description:
      'Browse all verified tuition teachers in Kolkata. Filter by subject, class, board, area, mode of teaching, and fees. Free to use, connect directly with local teachers.',
  },
  pastPapers: {
    title: 'Free Past Year Question Papers - CBSE, ICSE, ISC | Shikshaq',
    description:
      'Read free past year question papers for CBSE, ICSE, ISC and West Bengal State Board exams. Practice previous year questions (PYQs) by subject, class and school.',
  },
  schools: {
    title: 'Past Papers by School | Shikshaq',
    description:
      'Browse free past papers grouped by the school that set them, ICSE, CBSE and ISC. Open any school to read its papers question by question.',
  },
  faq: {
    title: 'Tuition FAQs for Students and Parents in Kolkata | Shikshaq',
    description:
      'Common questions about finding a tuition teacher in Kolkata on Shikshaq: how matching works, fees, verification, and contacting teachers directly for free.',
  },
  blog: {
    title: 'The papers, counted | Shikshaq',
  },
} satisfies Record<string, Partial<RouteMeta>>;

/** The blog index description, from the real counted totals. */
export function blogDescription(questions: number, papers: number): string {
  const nf = new Intl.NumberFormat('en-IN');
  return `What ${nf.format(questions)} questions from ${nf.format(papers)} real school papers `
    + 'show about which topics actually carry the marks. Free to read.';
}
