/**
 * Sends the funnel that already exists to the analytics that already exist.
 *
 * THE GAP THIS CLOSES. The product's purpose is a parent reaching a teacher,
 * and nobody could answer how many visitors reach a profile, how many press
 * message, or how many arrive at WhatsApp. That looked like missing
 * instrumentation. It was not: every step of that funnel is already recorded,
 * exactly once each, through recordSignal --
 *
 *     search_submitted / filters_applied / builder_submitted   discovery
 *     teacher_viewed                                           reached a profile
 *     contact_started                                          pressed message
 *     contact_completed                                        reached WhatsApp
 *
 * -- and all of it stops at the device. The intent store is localStorage: it
 * drives the reader's own trail and the stage predictor, and no one at the
 * company can see any of it. The whole funnel was being measured and then
 * thrown away.
 *
 * So this is a mirror, not new tracking. One chokepoint, recordSignal, already
 * sees every meaningful action; this forwards a curated subset to GA4 and
 * Clarity, which are both already loaded.
 *
 * WHY AN ALLOWLIST RATHER THAN EVERYTHING. `route_viewed` and `section_dwell`
 * are 'weak' signals and fire constantly -- section_dwell on scroll. Forwarding
 * those would bury the four events anyone actually wants in noise, and GA4
 * charges attention, not money, for that. Adding a kind here should be a
 * decision, so the list is explicit and a new SignalKind is mirrored only when
 * someone puts it in.
 *
 * WHAT THIS DELIBERATELY DOES NOT SEND. No free-text query, no name, no path,
 * no image URL, no identifier of any kind. Facet values (subject, area, board,
 * class) and a teacher slug are the analysis dimensions; everything else is
 * either personal, unbounded, or useless in aggregate. Account holders here
 * include minors, and read_events already carries the sensitive record under a
 * retention policy -- this path should stay boring.
 */

import type { SignalKind, SignalPayload } from './types';

/**
 * The kinds worth a GA4 event, and the event name each one sends under.
 *
 * Names match the signal kinds so the funnel reads the same in the code and in
 * GA4, and nobody has to hold a translation table in their head to build a
 * report.
 */
const MIRRORED: Partial<Record<SignalKind, string>> = {
  search_submitted: 'search_submitted',
  filters_applied: 'filters_applied',
  builder_submitted: 'builder_submitted',
  teacher_viewed: 'teacher_viewed',
  paper_viewed: 'paper_viewed',
  teacher_saved: 'teacher_saved',
  contact_started: 'contact_started',
  contact_completed: 'contact_completed',
};

/**
 * Kinds that describe arriving at one specific thing, and so should count once
 * per thing per page session rather than once per React mount.
 *
 * Without this, a remount, a filter change that reorders the tree, or a
 * back-navigation re-fires the signal and GA4 reads it as another visitor
 * reaching another profile. The funnel question is "how many visitors reach a
 * profile", so counting the same slug twice in one session makes the number
 * worse, not more detailed.
 */
const DEDUPED: ReadonlySet<SignalKind> = new Set<SignalKind>([
  'teacher_viewed',
  'paper_viewed',
]);

/* In-memory only, and deliberately so: it resets on reload, which is the
   correct granularity for "this visit", and it writes nothing to a device
   that is already storing more than enough. */
const seen = new Set<string>();

/** GA4 rejects a parameter value over 100 characters, silently. */
const MAX_PARAM = 100;

/**
 * Facets arrive as a string, a list, null or undefined, because the sentence
 * builder yields exactly one subject and Browse's filters yield an array. For
 * a report, the first value is the useful one: a breakdown by "Maths" is
 * readable, a breakdown by "Maths,Physics,Chemistry" is a long tail of
 * one-row combinations that answers nothing.
 */
function primary(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value.find((v) => typeof v === 'string' && v) : value;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_PARAM);
}

function paramsFor(payload: SignalPayload): Record<string, string> {
  const params: Record<string, string> = {};
  const add = (key: string, value: string | undefined) => {
    if (value) params[key] = value;
  };

  add('teacher_slug', primary(payload.id));
  add('subject', primary(payload.subject));
  add('area', primary(payload.area));
  add('board', primary(payload.board));
  add('class_level', primary(payload.classLevel));
  add('teaching_mode', primary(payload.teachingMode));

  return params;
}

/**
 * Forward one signal. Never throws, never blocks, never reports a failure.
 *
 * Analytics must not be able to break the contact flow -- the same rule the
 * existing WhatsApp helpers follow. If gtag has not loaded, if Clarity is
 * blocked, if an ad blocker removed both, the reader still reaches the
 * teacher and this returns quietly.
 */
export function mirrorSignal(kind: SignalKind, payload: SignalPayload = {}): void {
  try {
    if (typeof window === 'undefined') return;

    const eventName = MIRRORED[kind];
    if (!eventName) return;

    if (DEDUPED.has(kind)) {
      const id = primary(payload.id);
      /* No id means nothing to dedupe against. Send it: an undercounted
         funnel is a worse failure than a slightly overcounted one, because
         a missing step looks like a drop-off that never happened. */
      if (id) {
        const key = `${kind}:${id}`;
        if (seen.has(key)) return;
        seen.add(key);
      }
    }

    const params = paramsFor(payload);

    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, params);
    } else if (Array.isArray(window.dataLayer)) {
      /* GTM fallback for the window before the gtag shim initialises, which
         is exactly when the first teacher_viewed of a session fires. */
      window.dataLayer.push({ event: eventName, ...params });
    }

    /* Clarity gets the teacher as a filterable tag on the two contact steps
       only. Its custom tags are session-scoped, so setting one on every view
       would leave the tag showing whichever profile happened to be last --
       useful on the step where someone acted, misleading everywhere else. */
    if (
      (kind === 'contact_started' || kind === 'contact_completed') &&
      typeof window.clarity === 'function' &&
      params.teacher_slug
    ) {
      window.clarity('set', 'teacher_slug', params.teacher_slug);
      window.clarity('event', eventName);
    }
  } catch {
    /* Analytics must never break the product. */
  }
}

/** Test seam. Resets the per-session dedupe. */
export function __resetMirrorForTests(): void {
  seen.clear();
}
