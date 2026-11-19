/* Experience profiles: behavioural configurations, not pages.
 *
 * All five render the same ShikshAQ, from the same components, under the same
 * design contract. What differs is which of those components leads, what the
 * copy leads with, and where the primary action points. A reader moving from
 * DISCOVERY to COMPARE should not feel the site change; they should feel it
 * keep up.
 *
 * The component metadata below is declarative on purpose. This is a
 * composition engine with a fixed vocabulary, not a freeform renderer: a
 * surface can be reordered, emphasised or hidden, and that is the whole of
 * what it can have done to it.
 */

import { effectiveAdaptationLevel, isSeoRoute, routeAllowsAdaptation } from './guardrails';
import type { IntentIndex } from './types';

export type ExperienceProfile =
  | 'DISCOVERY'
  | 'FIND'
  | 'COMPARE'
  | 'DECIDE'
  | 'RETURNING';

export interface ExperienceDecision {
  profile: ExperienceProfile;
  /** Why, in the panel's words. */
  reason: string;
  /** How far the guardrails let this one go, on this specific route. */
  level: ReturnType<typeof effectiveAdaptationLevel>;
  /** True on the 35 SEO routes, the school/subject index, and paper readers —
   *  the ones a copy-level cap protects. Surfaces use this to skip anything
   *  that is not itself in the copy-only registry, as a second check. */
  seoCapped: boolean;
}

/**
 * Picks the profile. Order matters: the later a reader is in the journey, the
 * more specific the profile, so the checks run from most to least committed.
 *
 * DECIDE deliberately outranks RETURNING. Someone who came back AND has
 * already opened a contact sheet is not being welcomed back, they are being
 * got out of the way of.
 */
export function resolveExperience(intent: IntentIndex, pathname: string): ExperienceDecision {
  const level = effectiveAdaptationLevel(intent, pathname);
  const seoCapped = isSeoRoute(pathname);
  const routeHasScenario = routeAllowsAdaptation(pathname);

  if (level === 'none') {
    const reason = !routeHasScenario
      ? 'route has no visitor scenario to adapt'
      : `confidence ${intent.confidence.toFixed(2)} is under the threshold`;
    return { profile: 'DISCOVERY', reason, level, seoCapped };
  }

  if (intent.stage === 'decision') {
    return { profile: 'DECIDE', reason: 'a contact was started this session', level, seoCapped };
  }

  if (intent.stage === 'evaluation') {
    return {
      profile: 'COMPARE',
      reason: 'more than one teacher seen, or one saved',
      level,
      seoCapped,
    };
  }

  if (intent.familiarity !== 'new' && (intent.subject.value || intent.area.value)) {
    return { profile: 'RETURNING', reason: 'known reader with a live trail', level, seoCapped };
  }

  if (intent.subject.source === 'explicit' || intent.area.source === 'explicit') {
    return { profile: 'FIND', reason: 'subject or area stated outright', level, seoCapped };
  }

  return { profile: 'DISCOVERY', reason: 'nothing specific stated yet', level, seoCapped };
}

/* ------------------------------------------------- component metadata */

/** The surfaces the engine is allowed to have an opinion about. Adding one
 *  here does not make it adaptive; a surface also has to read the index. */
export type SurfaceId =
  | 'hero'
  | 'search'
  | 'featured-teachers'
  | 'subjects'
  | 'how-it-works'
  | 'activity'
  | 'papers-fork'
  | 'teachers-fork';

export interface SurfaceMeta {
  id: SurfaceId;
  /** Profiles in which this surface may be shown at all. */
  allowedProfiles: ExperienceProfile[];
  /** Lower sorts earlier. Absent means "leave it where the page put it". */
  priority: Partial<Record<ExperienceProfile, number>>;
  /** Slots that must be filled before this surface can claim its priority. */
  requiredSlots?: Array<'subject' | 'classLevel' | 'area' | 'board'>;
}

const ALL: ExperienceProfile[] = ['DISCOVERY', 'FIND', 'COMPARE', 'DECIDE', 'RETURNING'];

/**
 * Declared now, consumed in a later phase. Phases 1 to 3 use the index for
 * copy and CTAs only; the homepage's sections live inside a 760-line inline
 * JSX return and reordering them means extracting them into components first.
 * Writing the metadata down early is free and keeps the model honest; acting
 * on it before that refactor would not be.
 */
export const SURFACES: Record<SurfaceId, SurfaceMeta> = {
  hero: { id: 'hero', allowedProfiles: ALL, priority: {} },
  search: {
    id: 'search',
    allowedProfiles: ALL,
    priority: { FIND: 1, COMPARE: 1, RETURNING: 2 },
  },
  activity: {
    id: 'activity',
    allowedProfiles: ['COMPARE', 'DECIDE', 'RETURNING'],
    priority: { RETURNING: 1, COMPARE: 2, DECIDE: 2 },
  },
  'featured-teachers': {
    id: 'featured-teachers',
    allowedProfiles: ALL,
    priority: { FIND: 2, COMPARE: 3, DISCOVERY: 4 },
  },
  subjects: {
    id: 'subjects',
    allowedProfiles: ALL,
    priority: { DISCOVERY: 3 },
  },
  'how-it-works': {
    id: 'how-it-works',
    allowedProfiles: ['DISCOVERY', 'FIND'],
    priority: { DISCOVERY: 5 },
  },
  'teachers-fork': { id: 'teachers-fork', allowedProfiles: ALL, priority: {} },
  'papers-fork': { id: 'papers-fork', allowedProfiles: ALL, priority: {} },
};

/** Whether a surface may render under this profile, given what is known. */
export function surfaceAllowed(
  id: SurfaceId,
  profile: ExperienceProfile,
  intent: IntentIndex,
): boolean {
  const meta = SURFACES[id];
  if (!meta.allowedProfiles.includes(profile)) return false;
  if (!meta.requiredSlots) return true;
  return meta.requiredSlots.every((slot) => intent[slot].value !== null);
}
