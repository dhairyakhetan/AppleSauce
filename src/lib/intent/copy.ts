/* The copy-variant registry.
 *
 * Small, guardrail-checked generators that turn an IntentIndex into
 * visitor-facing text — kept in one place so the search overlay's chips,
 * Browse's suggested filters and a handful of home CTAs share the same
 * "if the index knows X, offer X" logic instead of three separate copies of
 * it drifting apart.
 *
 * Every generator degrades to null (or an empty array) when it doesn't have
 * enough to work with. Callers are expected to fall back to whatever they
 * render today in that case — nothing here invents a worse "no adaptation"
 * than the existing default, and nothing here is called unless the caller's
 * own route/confidence checks already passed.
 */

import type { IntentIndex, SearchMode } from './types';
import { checkCopy, COPY_LIMITS } from './guardrails';
import { predictNextSlot, predictSlotValue } from './predict';
import { BROWSE_PATH } from '@/lib/nav-config';

/* --------------------------------------------------- search overlay chips */

/** The two classes an exam-year search clusters around. Not derived from any
 *  real popularity signal — there isn't one to read — so this is a plain,
 *  named default rather than a computed "top class", and it is only ever
 *  used to vary a subject the reader has already stated. */
const EXAM_CLASSES = ['10', '12'];

/** Used only when an area is known but no subject is — the three subjects a
 *  tuition search defaults to across the site's own copy (hero-copy.ts's
 *  pool leans on the same three). Not a ranking; a reasonable, fixed guess. */
const COMMON_SUBJECTS = ['Maths', 'English', 'Science'];

const MAX_SUGGESTIONS = 5;

/**
 * Resting-state chips for the search overlay. Returns null (not an empty
 * array) when the index has nothing specific, so the caller's existing
 * hardcoded POPULAR list stands — this only ever narrows toward something
 * the reader has already told the site, never invents a new default list.
 */
export function suggestedSearches(mode: SearchMode, intent: IntentIndex): string[] | null {
  // No papers-side slot data worth ranking yet (board/school aren't tracked
  // with the same confidence as subject/area) — leave the papers list alone.
  if (mode !== 'teachers') return null;

  const subject = intent.subject.value;
  const area = intent.area.value;
  const classLevel = intent.classLevel.value;
  if (!subject && !area) return null;

  const out: string[] = [];
  if (subject && area) out.push(`${subject} near ${area}`);
  if (subject && classLevel) out.push(`${subject} Class ${classLevel}`);

  /* Learned first, defaults after.
     Where the reader has a pattern the model can see (they keep pairing this
     subject with one area, or one class), that pairing leads — it is a fact
     about them, where EXAM_CLASSES and COMMON_SUBJECTS below are only a
     reasonable guess about people in general. predictSlotValue returns
     nothing until MIN_SUPPORT observations back it, so a first-time reader
     falls straight through to the guesses. */
  if (subject && !area) {
    const likelyArea = predictSlotValue(intent, 'area');
    if (likelyArea) out.push(`${subject} near ${likelyArea.value}`);
  }
  if (subject && !classLevel) {
    const likelyClass = predictSlotValue(intent, 'classLevel');
    if (likelyClass) out.push(`${subject} Class ${likelyClass.value}`);
  }
  if (area && !subject) {
    const likelySubject = predictSlotValue(intent, 'subject');
    if (likelySubject) out.push(`${likelySubject.value} near ${area}`);
  }

  if (subject) {
    for (const c of EXAM_CLASSES) {
      if (c !== classLevel) out.push(`${subject} Class ${c}`);
    }
  }
  if (area) {
    for (const s of COMMON_SUBJECTS) {
      if (s !== subject) out.push(`${s} near ${area}`);
    }
  }

  const seen = new Set<string>();
  const checked = out.filter((label) => {
    if (seen.has(label)) return false;
    seen.add(label);
    return checkCopy(label, COPY_LIMITS.chipChars).ok;
  });
  return checked.length > 0 ? checked.slice(0, MAX_SUGGESTIONS) : null;
}

/* ------------------------------------------------------- Browse's chips */

export type SuggestedFilterKind = 'subject' | 'area' | 'classLevel' | 'board';

export interface SuggestedFilterChip {
  key: string;
  label: string;
  kind: SuggestedFilterKind;
  value: string;
  /** True when this is the model's guess at the reader's next move rather
   *  than something they already stated. Callers may want to present it more
   *  quietly; nothing is allowed to label it as a prediction to the reader. */
  predicted?: boolean;
}

/**
 * Filter chips Browse can offer before the reader has touched a filter —
 * one per slot the index already knows, so a reader who searched Maths in
 * Ballygunge from the sentence builder, or arrived on the Maths subject page,
 * can apply it in one tap rather than re-selecting it from the sheet.
 *
 * Never invents a value: every one here is a fact the reader stated or a
 * route they arrived by, normalised through the same vocabulary the filters
 * themselves use, so a suggested chip is always a legal filter value.
 */
const CHIP_KINDS: SuggestedFilterKind[] = ['subject', 'area', 'classLevel', 'board'];

function chipLabel(kind: SuggestedFilterKind, value: string): string {
  return kind === 'classLevel' ? `Class ${value}` : value;
}

export function suggestedFilterChips(intent: IntentIndex): SuggestedFilterChip[] {
  const out: SuggestedFilterChip[] = [];

  /* What the reader has already said, offered back as one tap. */
  for (const kind of CHIP_KINDS) {
    const slot = kind === 'classLevel' ? intent.classLevel : intent[kind];
    if (slot.value) {
      out.push({ key: kind, label: chipLabel(kind, slot.value), kind, value: slot.value });
    }
  }

  /* Then the facet the model expects next, if it is confident enough and can
     name a likely value for it. This is the one place a chip offers
     something the reader has NOT stated, which is why it needs both a
     next-slot prediction AND a value prediction to agree before it appears:
     "you usually pick an area after a subject" plus "and it is usually this
     one". Either alone is not enough to put words in someone's mouth. */
  const filledKinds = new Set(out.map((c) => c.kind));
  for (const next of predictNextSlot(intent)) {
    if (!CHIP_KINDS.includes(next.value as SuggestedFilterKind)) continue;
    const kind = next.value as SuggestedFilterKind;
    if (filledKinds.has(kind)) continue;
    const likely = predictSlotValue(intent, next.value);
    if (!likely) continue;
    out.push({
      key: `predicted:${kind}`,
      label: chipLabel(kind, likely.value),
      kind,
      value: likely.value,
      predicted: true,
    });
    break; // one forward-looking chip at most; a row of guesses is noise
  }

  return out.filter((c) => checkCopy(c.label, COPY_LIMITS.chipChars).ok);
}

/* ------------------------------------------------------------------ CTAs */

export interface IntentCta {
  label: string;
  href: string;
}

/**
 * A CTA that follows intent: when a subject is known, both the label and the
 * destination change together — a known subject sends the reader to that
 * filtered list (narrowed further by area, when that is known too), not the
 * bare index, which is the whole point of an adaptive CTA over a static one
 * that just says "Find a teacher" and dumps everyone on the same unfiltered
 * page. Returns null when there is no subject to build one from, so the
 * caller keeps its own existing label and href untouched.
 *
 * Lands on the generic filtered Browse listing, not a subject's dedicated
 * SEO page (SubjectPage.tsx/BoardPage.tsx) — those stay reserved for search
 * traffic; a real click here gets the same filter applied on the faster,
 * already-shared page instead.
 */
export function intentCta(intent: IntentIndex): IntentCta | null {
  const subject = intent.subject.value;
  const area = intent.area.value;
  if (!subject) return null;

  const params = new URLSearchParams();
  params.set('filter_subjects', subject);
  if (area) params.set('filter_areas', area);
  const href = `${BROWSE_PATH}?${params.toString()}`;

  // The label stays a fixed shape ("Find {subject} teachers") regardless of
  // area — appending an area name risked overrunning ctaChars for the
  // longest subject/area combinations, and a CTA that occasionally grows a
  // clause and occasionally does not reads as unstable in a way a headline
  // does not. Area still narrows the destination; it just does not have to
  // be spoken to do that.
  const label = `Find ${subject} teachers`;
  if (!checkCopy(label, COPY_LIMITS.ctaChars).ok) return null;

  return { label, href };
}
