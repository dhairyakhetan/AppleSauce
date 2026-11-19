/* What the adaptive layer is not allowed to do.
 *
 * These are enforced centrally rather than remembered at each call site,
 * because the failure mode of a forgotten guardrail is invisible: the page
 * still renders, it is just wrong for the person reading it.
 *
 * The design constraints here are not invented. They are the ones already
 * binding on this repo, restated in a form the engine can check:
 * DESIGN_SYSTEM.md for the accent budget and tap targets, CLAUDE.md for the
 * dash rule, and hero-copy.ts's own H-005a notes for tone.
 */

import type { IntentIndex } from './types';

/* ---------------------------------------------------------- confidence */

/** Below `copy`, the site renders exactly what it renders today. Boring is
 *  the correct output of an uncertain system, and it is never a failure. */
export const THRESHOLD = {
  /** Under this, adapt nothing at all. */
  copy: 0.4,
  /** Over this, emphasis and ordering may change too. */
  emphasis: 0.7,
  /** Over this, stronger composition is permitted. Unused in phases 1 to 3. */
  compose: 0.9,
} as const;

export type AdaptationLevel = 'none' | 'copy' | 'emphasis' | 'compose';

const LEVEL_RANK: Record<AdaptationLevel, number> = {
  none: 0,
  copy: 1,
  emphasis: 2,
  compose: 3,
};

function levelFromConfidence(intent: IntentIndex): AdaptationLevel {
  if (intent.confidence < THRESHOLD.copy) return 'none';
  if (intent.confidence < THRESHOLD.emphasis) return 'copy';
  if (intent.confidence < THRESHOLD.compose) return 'emphasis';
  return 'compose';
}

/** Confidence-only level, ignoring the route. Kept for the debug panel,
 *  which wants to show what the reader's own signals earned before the
 *  route cap is applied. */
export function adaptationLevel(intent: IntentIndex): AdaptationLevel {
  return levelFromConfidence(intent);
}

/* -------------------------------------------------------------- routes */

/**
 * Routes with no visitor scenario at all: admin tooling, the dev sandbox, and
 * the WhatsApp hand-off interstitial (a redirect, not a page anyone reads).
 * Adaptation is meaningless there, not merely unsafe, so these are excluded
 * outright rather than capped.
 */
const NEVER_ADAPTIVE_PREFIXES = ['/admin', '/__sandbox'];
const NEVER_ADAPTIVE_PATTERN = /^\/tuition-teachers\/[^/]+\/whatsapp-click\/?$/;

export function routeAllowsAdaptation(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (NEVER_ADAPTIVE_PATTERN.test(path)) return false;
  return !NEVER_ADAPTIVE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Every genuine visitor scenario is eligible to adapt. What used to be a
 * short allowlist is now a cap instead: the 35 subject and board routes, the
 * school and subject index pages, and the individual paper pages carry 458
 * sitemap URLs and a soft-gate that only works because every visitor,
 * crawler included, sees the same DOM. Those routes stay eligible — a
 * returning reader's chip suggestions and CTA destination may still follow
 * their intent there — but the cap below stops anything from touching a
 * heading, meta tag, canonical prose block, or the page's structure.
 *
 * `/school/:slug` is matched by prefix; the SEO subject/board routes share
 * one suffix (`-tuition-teachers-in-kolkata`), which is more durable than
 * enumerating all 35 by hand and breaks the same way App.tsx's route table
 * would if a slug were renamed.
 */
const SEO_ROUTE_PREFIXES = ['/school/', '/schools', '/subjects'];
const SEO_ROUTE_SUFFIX = '-tuition-teachers-in-kolkata';
/* The one path that wears the SEO suffix without being an SEO landing page:
   this is Browse itself, the main teachers list and the most important
   adaptive surface on the site. Matching it by suffix capped it to
   copy-level, which is the opposite of what it should be. */
const BROWSE_LANDING = '/all-tuition-teachers-in-kolkata';
/** `/past-papers/:id` — the individual paper reader, not the results list. */
const SEO_PAPER_READER = /^\/past-papers\/(?!results$)[^/]+\/?$/;

export function isSeoRoute(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return false;
  if (path === BROWSE_LANDING) return false;
  if (path.endsWith(SEO_ROUTE_SUFFIX)) return true;
  if (SEO_ROUTE_PREFIXES.some((p) => path === p.replace(/\/$/, '') || path.startsWith(p))) {
    return true;
  }
  return SEO_PAPER_READER.test(path);
}

/** SEO routes cap out at 'copy': CTA label/destination and chip suggestions
 *  may follow intent, nothing about layout, ordering or emphasis may. This is
 *  the mechanism, not the whole guarantee — the other half is that the
 *  headline, H1, meta tags and SEO intro prose are never in the adaptable-copy
 *  registry at all (see copy.ts), on any route, so the cap here is a second,
 *  redundant line of defence rather than the only one. */
function routeCap(pathname: string): AdaptationLevel {
  return isSeoRoute(pathname) ? 'copy' : 'compose';
}

/** What the engine is actually allowed to do on this route, right now: the
 *  lesser of what the reader's signals earned and what the route permits.
 *  This is what every surface should call — `adaptationLevel` alone ignores
 *  the route, and is exposed only for the panel's "what confidence alone
 *  would allow" comparison. */
export function effectiveAdaptationLevel(
  intent: IntentIndex,
  pathname: string,
): AdaptationLevel {
  if (!routeAllowsAdaptation(pathname)) return 'none';
  const earned = levelFromConfidence(intent);
  const cap = routeCap(pathname);
  return LEVEL_RANK[earned] <= LEVEL_RANK[cap] ? earned : cap;
}

/* ---------------------------------------------------------------- copy */

export const COPY_LIMITS = {
  /** Three lines at 375px, which is the design target. */
  headlineChars: 78,
  /* 28 fit the site's existing short CTAs ("Message on WhatsApp" is 20), but
     "Find {subject} teachers" needs room for the longest subject name
     ("Environmental Science", 21 chars) plus the fixed wrapper — 36 is the
     smallest limit that still fits every entry in searchFacets.ts's SUBJECTS
     list without truncating a real one. */
  ctaChars: 36,
  eyebrowChars: 32,
  /** A suggested chip runs a bit longer than a CTA — it carries a subject
   *  name plus an area name in one label ("Maths near Ballygunge"). */
  chipChars: 40,
} as const;

/* CLAUDE.md: no em or en dashes in site copy. The bios were normalised once
   already; nothing generated here may reintroduce them. */
const FORBIDDEN_CHARS = /[–—]/;

/* Never name the machinery. The reader should experience relevance, not
   surveillance, and hero-copy.ts records where this went wrong before: a
   line that told a visitor it knew what they had been looking at read as
   being watched rather than as a greeting. */
const SURVEILLANCE_PHRASES = [
  'based on your',
  'we noticed',
  'because you',
  'our ai',
  'we detected',
  'your activity',
  'we see that',
  'personalised for you',
  'personalized for you',
];

export interface CopyRejection {
  ok: false;
  rule: string;
}
export type CopyVerdict = { ok: true } | CopyRejection;

/** Checks one piece of visitor-facing copy. Returns the rule that failed by
 *  name, so the debug panel can say why a variant was not used. */
export function checkCopy(text: string, limit: number): CopyVerdict {
  const value = text.trim();
  if (!value) return { ok: false, rule: 'empty' };
  if (value.length > limit) return { ok: false, rule: `over ${limit} chars` };
  if (FORBIDDEN_CHARS.test(value)) return { ok: false, rule: 'em or en dash' };
  const lower = value.toLowerCase();
  for (const phrase of SURVEILLANCE_PHRASES) {
    if (lower.includes(phrase)) return { ok: false, rule: `names the machinery: "${phrase}"` };
  }
  /* A blank left by a missing interpolation is worse than no adaptation:
     "Find your  tutor" reads as broken rather than as personal. */
  if (/\s{2,}/.test(value) || /\bundefined\b|\bnull\b|\bNaN\b/.test(value)) {
    return { ok: false, rule: 'unfilled slot' };
  }
  return { ok: true };
}

/* --------------------------------------------------------------- brand */

/** DESIGN_SYSTEM.md section 2: at most two accented elements per viewport.
 *  A page with five orange things has no hierarchy, so an adaptive CTA that
 *  takes the accent has to be given it by something else giving it up. */
export const ACCENT_BUDGET = 2;

/** Surfaces that must never be touched by adaptation, at any confidence, on
 *  any route — including the crawler-critical text on SEO routes, which is
 *  why this list is what actually makes routeCap's 'copy' cap safe rather
 *  than merely conservative. */
export const NEVER_ADAPT = [
  'navigation',
  'auth availability',
  'search availability',
  'the papers soft-gate',
  'security and consent copy',
  'legal and policy text',
  'page <title> and <meta>',
  'the H1 and any SEO intro prose (subject-seo.ts)',
  'canonical structure a crawler indexes',
] as const;
