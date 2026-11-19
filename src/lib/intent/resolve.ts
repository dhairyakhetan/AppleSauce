/* Stored state plus live context, in, one IntentIndex out. Pure, synchronous,
 * no network. Given identical inputs it returns an identical index, which is
 * what makes the debug panel trustworthy and the whole thing testable.
 *
 * Confidence is DERIVED here, never stored. Storing it would let a stale
 * number outlive the evidence that justified it. It is a rollup of what each
 * slot is worth, discounted by how old that slot is, and the discount is the
 * point: a subject chosen a month ago should not drive today's headline with
 * the same force as one chosen a minute ago.
 */

import {
  DEFAULT_INTENT,
  FACET_SLOT_KEYS,
  type Evidence,
  type FacetSlotKey,
  type IntentIndex,
  type PrimaryIntent,
  type Provenance,
  type Slot,
} from './types';
import { isBrowseActive, isPapersActive } from '@/lib/nav-config';
import { readSession, readStore, THIRTY_DAYS_MS } from './store';
import { deriveStage } from './signals';

/* What a slot contributes at full freshness, by provenance. Explicit values
   carry most of the weight because they are the only ones the reader actually
   said. Subject and area carry most of the weight because they are what the
   product is actually organised around, and what copy can say something
   useful about. The rest corroborate: three of them together are worth about
   one stated subject, which is the right ratio — knowing someone wants Online
   group tuition is real information, but it does not tell you WHAT to teach
   them. */
const SLOT_WEIGHT: Record<FacetSlotKey, Record<Provenance, number>> = {
  subject: { explicit: 0.34, derived: 0.18, inferred: 0.06 },
  classLevel: { explicit: 0.2, derived: 0.1, inferred: 0.04 },
  area: { explicit: 0.2, derived: 0.1, inferred: 0.04 },
  board: { explicit: 0.12, derived: 0.06, inferred: 0.02 },
  school: { explicit: 0.12, derived: 0.06, inferred: 0.02 },
  teachingMode: { explicit: 0.08, derived: 0.04, inferred: 0.015 },
  classSize: { explicit: 0.06, derived: 0.03, inferred: 0.01 },
  placeOfTeaching: { explicit: 0.06, derived: 0.03, inferred: 0.01 },
  examType: { explicit: 0.06, derived: 0.03, inferred: 0.01 },
  experience: { explicit: 0.06, derived: 0.03, inferred: 0.01 },
};

/** What each slot is called in the debug panel's evidence list. */
const SLOT_LABEL: Record<FacetSlotKey, string> = {
  subject: 'subject',
  classLevel: 'class',
  area: 'area',
  board: 'board',
  classSize: 'class size',
  teachingMode: 'mode',
  placeOfTeaching: 'place',
  school: 'school',
  examType: 'exam',
  experience: 'experience',
};

/** Full value for a day, then a straight decline to nothing at thirty days.
 *  A slot past the window contributes zero rather than a small amount, so
 *  stale state cannot accumulate into confidence. */
const FULL_VALUE_MS = 24 * 60 * 60 * 1000;

export function freshness(at: number, now: number): number {
  if (at <= 0) return 0;
  const age = now - at;
  if (age < 0) return 1;
  if (age <= FULL_VALUE_MS) return 1;
  if (age >= THIRTY_DAYS_MS) return 0;
  return 1 - (age - FULL_VALUE_MS) / (THIRTY_DAYS_MS - FULL_VALUE_MS);
}

export interface LiveContext {
  /** From useAuth(). Signed in is the strongest familiarity signal there is. */
  signedIn: boolean;
  /** From useLikes().likedCount. Server-side, so it survives a new device. */
  likedCount: number;
  /** Current pathname, for primary-intent resolution only. */
  pathname: string;
}

function slotEvidence(
  name: string,
  slot: Slot<string>,
  weights: { explicit: number; derived: number; inferred: number },
  now: number,
): { weight: number; evidence: Evidence | null } {
  if (!slot.value) return { weight: 0, evidence: null };
  const f = freshness(slot.at, now);
  if (f === 0) return { weight: 0, evidence: null };
  const weight = weights[slot.source] * f;
  return {
    weight,
    evidence: {
      kind: 'url',
      strength: slot.source === 'explicit' ? 'strong' : 'medium',
      note: `${name} = ${slot.value} (${slot.source}, ${Math.round(f * 100)}% fresh)`,
      weight,
      at: slot.at,
    },
  };
}

/* Route to intent, using nav-config's predicates rather than a second copy of
 * them. This function used to match its own shorter prefix list, and had drifted
 * exactly the way the facet constants had: it knew '/all-tuition-teachers' and
 * '/tuition-teachers/', but not the ~30 hardcoded '<subject>-tuition-teachers-
 * in-kolkata' and '<board>-tuition-teachers-in-kolkata' landing routes, nor
 * '/subjects', '/schools' or '/school/:slug'.
 *
 * Those landing pages are the site's main organic entry points, so the reader
 * arriving with the clearest possible intent -- they searched for a maths tutor
 * in Kolkata and landed on the maths page -- was the one the index resolved as
 * `primaryIntent: null`, and every adaptive surface fell back to its generic
 * copy for them. isBrowseActive/isPapersActive already encode these route
 * families and are maintained alongside the routes themselves.
 */
function resolvePrimaryIntent(pathname: string, mode: string | null): PrimaryIntent | null {
  if (pathname.startsWith('/join')) return 'join_as_teacher';
  /* '/more' is where '/help' redirects to, and both are the same explainer
     surface as /about and /faq. */
  if (
    pathname.startsWith('/about') ||
    pathname.startsWith('/faq') ||
    pathname === '/more' ||
    pathname === '/help'
  ) {
    return 'understand';
  }
  /* Papers first: isPapersActive owns '/past-papers', '/schools' and
     '/school/:slug', and a school page is a papers surface, not a teacher one
     (handoff SC-005). Checked before the teacher families so the two cannot
     both claim a path. */
  if (isPapersActive(pathname)) return 'find_papers';
  if (isBrowseActive(pathname)) return 'find_tutor';
  if (mode === 'papers') return 'find_papers';
  if (mode === 'teachers') return 'find_tutor';
  return null;
}

/**
 * Resolves the index. Never throws: if storage is unavailable or the envelope
 * is unreadable, every path lands on DEFAULT_INTENT, which is exactly what the
 * site renders today.
 */
export function resolveIntent(live: LiveContext): IntentIndex {
  let store;
  let session;
  try {
    store = readStore();
    session = readSession();
  } catch {
    return { ...DEFAULT_INTENT };
  }

  const now = Date.now();
  const evidence: Evidence[] = [];
  let confidence = 0;

  for (const key of FACET_SLOT_KEYS) {
    const { weight, evidence: e } = slotEvidence(
      SLOT_LABEL[key],
      store.slots[key],
      SLOT_WEIGHT[key],
      now,
    );
    confidence += weight;
    if (e) evidence.push(e);
  }

  if (store.budget.min !== null || store.budget.max !== null) {
    const weight = 0.08 * freshness(store.budget.at, now);
    confidence += weight;
    const { min, max } = store.budget;
    const range =
      min !== null && max !== null
        ? `${min} to ${max}`
        : min !== null
          ? `over ${min}`
          : `under ${max}`;
    evidence.push({
      kind: 'url',
      strength: 'strong',
      note: `budget ${range}`,
      weight,
      at: store.budget.at,
    });
  }

  const stage = deriveStage({ store, session });

  /* Behaviour corroborates the slots rather than standing in for them. A
     reader deep in a journey is more likely to be understood correctly, but
     depth alone never makes the page confident about WHAT they want. */
  if (stage === 'specification' || stage === 'evaluation' || stage === 'decision') {
    const weight = 0.1;
    confidence += weight;
    evidence.push({
      kind: 'stage',
      strength: 'medium',
      note: `journey stage is ${stage}`,
      weight,
      at: now,
    });
  }

  const familiarity: IntentIndex['familiarity'] = live.signedIn
    ? 'known'
    : store.visitCount > 1 || store.lastTeacher !== null || store.lastSearch !== null
      ? 'returning'
      : 'new';

  if (live.signedIn) {
    const weight = 0.05;
    confidence += weight;
    evidence.push({
      kind: 'auth',
      strength: 'strong',
      note: 'signed in',
      weight,
      at: now,
    });
  }

  if (live.likedCount > 0) {
    const weight = 0.05;
    confidence += weight;
    evidence.push({
      kind: 'likes',
      strength: 'medium',
      note: `${live.likedCount} saved teacher${live.likedCount === 1 ? '' : 's'}`,
      weight,
      at: now,
    });
  }

  /* Weak signals appear in the panel so a journey can be read in full, and
     contribute exactly nothing. */
  for (const s of session.signals) {
    if (s.kind === 'route_viewed' || s.kind === 'section_dwell') {
      evidence.push({
        kind: s.kind,
        strength: 'weak',
        note: s.payload.path ?? s.payload.id ?? 'observed',
        weight: 0,
        at: s.at,
      });
    }
  }

  return {
    subject: store.slots.subject,
    classLevel: store.slots.classLevel,
    area: store.slots.area,
    board: store.slots.board,
    classSize: store.slots.classSize,
    teachingMode: store.slots.teachingMode,
    placeOfTeaching: store.slots.placeOfTeaching,
    school: store.slots.school,
    examType: store.slots.examType,
    experience: store.slots.experience,
    budget: store.budget,
    mode: store.mode,
    primaryIntent: resolvePrimaryIntent(live.pathname, store.mode),
    stage,
    priceSensitivity: store.priceObserved ? 'observed' : 'unknown',
    familiarity,
    confidence: Math.min(1, Math.round(confidence * 1000) / 1000),
    evidence,
  };
}
