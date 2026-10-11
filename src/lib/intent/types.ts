/* The intent index — the shapes.
 *
 * ShikshAQ already decided what to show a visitor in five unrelated places,
 * each reading raw storage on its own terms: hero-copy.ts had a six-branch
 * precedence chain, auth-intent.ts its own sessionStorage handoff, Browse its
 * FilterState, SearchControl a hardcoded suggestion map. None of them could
 * see each other, so the site could only ever replay whichever fragment
 * happened to fire first.
 *
 * This module is the one model they all read instead. It is deterministic,
 * synchronous, local, and pure: no request, no model call, nothing that can
 * block a render or fail. When it knows nothing it says so, and the caller
 * renders exactly what the site renders today.
 *
 * Two departures from the brief that shaped this file, both deliberate:
 *
 * 1. PROVENANCE PER SLOT, not one global confidence number. The app can be
 *    certain about subject (the reader picked it from a dropdown) while
 *    knowing nothing at all about area. A single `confidence: 0.87` averages
 *    that away and every downstream check has to guess what it covered.
 *    Per-slot provenance lets a guardrail say exactly what it means:
 *    "adapt the headline only when subject.source === 'explicit'".
 *
 * 2. NO `urgency` FIELD. The brief lists one; nothing in ShikshAQ observes it.
 *    Board season is a fact about the calendar, not a signal from the person
 *    reading. Scoring urgency from that would be the "confidently wrong"
 *    failure the brief warns about, dressed up as a number. Omitted rather
 *    than faked. `priceSensitivity` is binary for the same reason: a fee
 *    filter being touched is a fact, "medium sensitivity" is a guess.
 */

import type { SearchMode } from '@/utils/searchFacets';

export type { SearchMode };

/** How we came to know a slot's value. Explicit always beats inferred. */
export type Provenance =
  /** The reader said so: a dropdown, a facet chip, a filter. */
  | 'explicit'
  /** Read off something they chose: a subject route, a viewed teacher's subject. */
  | 'derived'
  /** Guessed from behaviour. Never sufficient on its own to change the page. */
  | 'inferred';

export type JourneyStage =
  | 'discovery'
  | 'exploration'
  | 'specification'
  | 'evaluation'
  | 'decision';

/** Ordered, so a transition can be compared rather than pattern-matched. */
export const STAGE_ORDER: JourneyStage[] = [
  'discovery',
  'exploration',
  'specification',
  'evaluation',
  'decision',
];

export function stageRank(stage: JourneyStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export type PrimaryIntent =
  | 'find_tutor'
  | 'find_papers'
  | 'join_as_teacher'
  | 'understand';

export interface Slot<T = string> {
  /**
   * The primary value, which is always `values[0]`. Kept as its own field
   * because almost every consumer wants exactly one thing to say ("Find
   * {subject} teachers"), and making each of them reach into an array and
   * pick would spread the same `?? null` dance across every surface.
   */
  value: T | null;
  /**
   * Everything the reader stated for this facet, primary first.
   *
   * Browse's filters are arrays — someone can be looking for Maths AND
   * Physics across Ballygunge AND Gariahat — and reading only the first of
   * each threw the rest away, so the index knew strictly less than the URL
   * it was built from. Copy still speaks about `value`; ranking, chips and
   * anything counting breadth of intent read `values`.
   */
  values: T[];
  source: Provenance;
  /** Epoch ms. Drives decay: a month-old subject is worth less than today's. */
  at: number;
}

export const EMPTY_SLOT: Slot<string> = { value: null, values: [], source: 'inferred', at: 0 };

/** Builds a slot from a list, keeping the primary and the full set in step so
 *  the two can never disagree about what the reader said. */
export function slotOf(values: string[], source: Provenance, at: number): Slot<string> {
  const clean = values.filter((v) => typeof v === 'string' && v.trim().length > 0);
  if (clean.length === 0) return { ...EMPTY_SLOT };
  return { value: clean[0], values: clean, source, at };
}

/** The facets the index tracks. Every one is a real filter or a real
 *  dropdown somewhere in the app — nothing here is modelled speculatively. */
export type FacetSlotKey =
  | 'subject'
  | 'classLevel'
  | 'area'
  | 'board'
  | 'classSize'
  | 'teachingMode'
  | 'placeOfTeaching'
  | 'school'
  | 'examType'
  | 'experience';

export const FACET_SLOT_KEYS: FacetSlotKey[] = [
  'subject',
  'classLevel',
  'area',
  'board',
  'classSize',
  'teachingMode',
  'placeOfTeaching',
  'school',
  'examType',
  'experience',
];

/** What the reader has told us about money. Deliberately not a Slot: it is a
 *  range of numbers, not a vocabulary value, and pretending otherwise would
 *  mean stringifying it just to fit a shape it does not have. */
export interface Budget {
  min: number | null;
  max: number | null;
  source: Provenance;
  at: number;
}

export const EMPTY_BUDGET: Budget = { min: null, max: null, source: 'inferred', at: 0 };

/* ------------------------------------------------------------------ signals */

/** What the app can actually observe. Grouped by how much each is worth. */
export type SignalKind =
  /* STRONG — the reader stated it. */
  | 'search_submitted'
  | 'filters_applied'
  | 'builder_submitted'
  /* MEDIUM — the reader did something that implies it. */
  | 'teacher_viewed'
  | 'paper_viewed'
  | 'teacher_saved'
  | 'contact_started'
  | 'contact_completed'
  | 'mode_changed'
  | 'subject_route_viewed'
  /* WEAK — recorded for debugging, weighted zero, can never move the stage. */
  | 'route_viewed'
  | 'section_dwell';

export type SignalStrength = 'strong' | 'medium' | 'weak';

export const SIGNAL_STRENGTH: Record<SignalKind, SignalStrength> = {
  search_submitted: 'strong',
  filters_applied: 'strong',
  builder_submitted: 'strong',

  teacher_viewed: 'medium',
  paper_viewed: 'medium',
  teacher_saved: 'medium',
  contact_started: 'medium',
  contact_completed: 'medium',
  mode_changed: 'medium',
  subject_route_viewed: 'medium',

  route_viewed: 'weak',
  section_dwell: 'weak',
};

/**
 * Signal payloads. Every field optional: a caller records what it has.
 *
 * Each facet takes either one value or a list, because the two real sources
 * disagree in shape and both are legitimate — a sentence-builder dropdown
 * yields exactly one subject, Browse's filters yield an array of them. The
 * recorder normalises both into the same slot rather than making every call
 * site wrap or unwrap to suit it.
 */
export type FacetInput = string | null | undefined | Array<string | null | undefined>;

export interface SignalPayload {
  subject?: FacetInput;
  classLevel?: FacetInput;
  area?: FacetInput;
  board?: FacetInput;
  classSize?: FacetInput;
  /** Online / Offline. Named to avoid colliding with `mode`, which is the
   *  teachers-vs-papers surface and a different question entirely. */
  teachingMode?: FacetInput;
  placeOfTeaching?: FacetInput;
  school?: FacetInput;
  examType?: FacetInput;
  /** Minimum years, as the filter states it ('1', '3', '5', '10', '15', '20'). */
  experience?: FacetInput;
  mode?: SearchMode | null;
  /** Free-text query. Never becomes a slot value; kept for recent-searches. */
  query?: string | null;
  /** A teacher slug, or a paper id. */
  id?: string | null;
  name?: string | null;
  title?: string | null;
  subtitle?: string | null;
  path?: string | null;
  imageUrl?: string | null;
  /** True when a fee filter was actually touched. The only price evidence. */
  feeTouched?: boolean;
  /** The actual range, when the reader set one. */
  minFees?: number | null;
  maxFees?: number | null;
  /** Set when a filter set was emptied, so the machine can step back. */
  cleared?: boolean;
  /**
   * True when this value was applied by accepting the model's own suggestion.
   *
   * The slot still updates — the reader really did choose it — but the
   * predictor must NOT learn from it, or it trains on its own output: it
   * suggests an area, the suggestion gets tapped because it was the easiest
   * thing on screen, and it reads that tap as independent confirmation of
   * the pattern it invented. Two or three rounds of that and a coincidence
   * has bootstrapped itself past MIN_SUPPORT into a confident prediction
   * with nothing behind it.
   */
  fromPrediction?: boolean;
}

export interface Signal {
  kind: SignalKind;
  payload: SignalPayload;
  at: number;
}

/* ---------------------------------------------------------------- evidence */

/** Why the index says what it says. Powers the debug panel, and keeps
 *  analytics honest: an inference and a stated fact must never be logged as
 *  the same thing. */
export interface Evidence {
  /** What contributed. */
  kind: SignalKind | 'auth' | 'likes' | 'url' | 'stage';
  strength: SignalStrength;
  /** Human-readable, for the debug panel only. Never rendered to a visitor. */
  note: string;
  /** How much this added to confidence. Zero for weak signals, always. */
  weight: number;
  at: number;
}

/* ------------------------------------------------------------------- index */

export interface IntentIndex {
  /* WHAT. Every value normalised against the app's own filter vocabulary. */
  subject: Slot<string>;
  classLevel: Slot<string>;
  area: Slot<string>;
  board: Slot<string>;
  /** Group or Solo. */
  classSize: Slot<string>;
  /** Online or Offline. */
  teachingMode: Slot<string>;
  /** Teacher's place or Student's Home. */
  placeOfTeaching: Slot<string>;
  /** Papers-side, and the sentence builder's fourth dropdown. */
  school: Slot<string>;
  examType: Slot<string>;
  /** Minimum years of experience asked for. */
  experience: Slot<string>;

  /** The fee range, when one was set. */
  budget: Budget;

  /* WHICH surface. */
  mode: SearchMode | null;
  primaryIntent: PrimaryIntent | null;

  /* HOW they are behaving. */
  stage: JourneyStage;
  priceSensitivity: 'unknown' | 'observed';
  familiarity: 'new' | 'returning' | 'known';

  /** Derived rollup of the slots' provenance and freshness. Not stored. */
  confidence: number;
  evidence: Evidence[];
}

/** What the site renders when it knows nothing, which is also what a crawler
 *  and a first-time visitor get. Every failure path returns exactly this. */
export const DEFAULT_INTENT: IntentIndex = {
  subject: EMPTY_SLOT,
  classLevel: EMPTY_SLOT,
  area: EMPTY_SLOT,
  board: EMPTY_SLOT,
  classSize: EMPTY_SLOT,
  teachingMode: EMPTY_SLOT,
  placeOfTeaching: EMPTY_SLOT,
  school: EMPTY_SLOT,
  examType: EMPTY_SLOT,
  experience: EMPTY_SLOT,
  budget: EMPTY_BUDGET,
  mode: null,
  primaryIntent: null,
  stage: 'discovery',
  priceSensitivity: 'unknown',
  familiarity: 'new',
  confidence: 0,
  evidence: [],
};
