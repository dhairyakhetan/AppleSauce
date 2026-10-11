/**
 * The one definition of what a page's meta tags fall back to.
 *
 * There were three, and they had already drifted: index.html, usePageMeta.ts
 * and SEOHead.tsx each hardcoded a different default description. That matters
 * more than it looks, because these are RESTORE values -- when a page unmounts
 * and the next route sets nothing of its own, whichever copy ran last decides
 * what the document says. Three copies meant the answer depended on which
 * component happened to unmount.
 *
 * DEFAULT_DESCRIPTION is index.html's wording verbatim, deliberately: that file
 * is the pre-JavaScript state of every route and the template
 * scripts/prerender.ts builds from, so it is the only copy a crawler can see
 * before React runs. Restoring to anything else would mean the document said
 * one thing on arrival and another after a client-side navigation back to a
 * page with no meta of its own.
 *
 * Keep this in sync with index.html by hand -- it cannot import from there.
 */
export const SITE_URL = 'https://www.shikshaq.in';

export const DEFAULT_TITLE = 'Home Tutor in Kolkata: Verified Tuition Teachers, Free | Shikshaq';

export const DEFAULT_DESCRIPTION =
  'Find a home tutor or tuition teacher in Kolkata for free. Filter by subject, class, board and area, then message them on WhatsApp. Plus free ICSE, ISC and CBSE past papers.';

export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image-default.jpg`;
