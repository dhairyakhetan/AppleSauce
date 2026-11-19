/* The only write path into the intent store, and the journey state machine.
 *
 * Two rules hold this file together, and both are structural rather than
 * matters of discipline:
 *
 * 1. A WEAK SIGNAL CAN NEVER MOVE THE STAGE. Scroll depth, dwell time and
 *    hover are recorded so the debug panel can show them, and then weighted
 *    zero. Eight seconds on a section means the reader spent eight seconds
 *    there; it does not mean they are interested. `advanceStage` refuses to
 *    look at anything whose SIGNAL_STRENGTH is 'weak', so a future call site
 *    cannot accidentally promote one.
 *
 * 2. EXPLICIT BEATS DERIVED BEATS INFERRED. A slot is only overwritten by a
 *    source at least as strong as the one already there, unless the existing
 *    value has gone stale. So a subject read off a route never displaces a
 *    subject the reader picked from a dropdown.
 *
 * Regression is first class. Clearing filters steps the stage back, changing
 * subject replaces the slot and drops what depended on it, and navigating
 * backwards never overwrites anything.
 */

import { mirrorSignal } from './analytics-mirror';
import {
  EMPTY_BUDGET,
  EMPTY_SLOT,
  FACET_SLOT_KEYS,
  SIGNAL_STRENGTH,
  stageRank,
  type JourneyStage,
  type Provenance,
  type SearchMode,
  type Signal,
  type SignalKind,
  type SignalPayload,
  type Slot,
  type FacetSlotKey,
} from './types';
import {
  CAPS,
  emptySlots,
  readSession,
  readStore,
  updateSession,
  updateStore,
  THIRTY_DAYS_MS,
  type IntentStore,
  type SessionState,
} from './store';
import { filledSignature, observeStep } from './predict';
import {
  normaliseArea,
  normaliseBoard,
  normaliseClass,
  normaliseClassSize,
  normaliseExamType,
  normaliseExperience,
  normaliseMany,
  normalisePlaceOfTeaching,
  normaliseSchool,
  normaliseSubject,
  normaliseTeachingMode,
} from './vocabulary';

/** Teacher profiles opened in one session before the reader is comparing
 *  rather than browsing. Two is the smallest number that means "comparing". */
const EVALUATION_PROFILE_COUNT = 2;

const RANK: Record<Provenance, number> = { inferred: 0, derived: 1, explicit: 2 };

function fresh(at: number): boolean {
  return at > 0 && Date.now() - at < THIRTY_DAYS_MS;
}

/** Writes a slot only when the new evidence is at least as good as what is
 *  already there, or what is there has expired. Takes the whole list, so a
 *  multi-select filter replaces the slot wholesale rather than merging into
 *  it — someone who changes Maths+Physics to just Physics has deselected
 *  Maths, and merging would quietly keep it. */
function considerSlot(
  current: Slot<string>,
  values: string[],
  source: Provenance,
): Slot<string> {
  if (values.length === 0) return current;
  const held = current.value !== null && fresh(current.at);
  if (held && RANK[source] < RANK[current.source]) return current;
  return { value: values[0], values, source, at: Date.now() };
}

/** Every facet the recorder knows how to read, paired with the normaliser
 *  that guards it. Adding a facet is one entry here plus one field on
 *  SignalPayload, rather than another hand-written pair of lines below. */
const FACET_NORMALISERS: Record<
  FacetSlotKey,
  (v: string | null | undefined) => string | null
> = {
  subject: normaliseSubject,
  classLevel: normaliseClass,
  area: normaliseArea,
  board: normaliseBoard,
  classSize: normaliseClassSize,
  teachingMode: normaliseTeachingMode,
  placeOfTeaching: normalisePlaceOfTeaching,
  school: normaliseSchool,
  examType: normaliseExamType,
  experience: normaliseExperience,
};

/* --------------------------------------------------------- state machine */

interface StageInputs {
  store: IntentStore;
  session: SessionState;
}

/** Derives the stage from facts, rather than mutating it per event. Making
 *  this a pure function of the accumulated state is what lets it step
 *  backwards as cleanly as it steps forwards. */
export function deriveStage({ store, session }: StageInputs): JourneyStage {
  if (session.contactStarted || session.contactCompleted) return 'decision';

  if (session.saved || session.teacherSlugs.length >= EVALUATION_PROFILE_COUNT) {
    return 'evaluation';
  }

  /* Every facet counts, not just the original four: someone who set Online +
     Solo + a fee ceiling has specified their search every bit as precisely as
     someone who named a subject and an area, and the stage should say so. */
  const explicitSlots = FACET_SLOT_KEYS.map((key) => store.slots[key]).filter(
    (s) => s.value !== null && s.source === 'explicit' && fresh(s.at),
  );

  if (explicitSlots.length >= 2) return 'specification';

  if (explicitSlots.length === 1 || store.mode !== null || session.teacherSlugs.length > 0) {
    return 'exploration';
  }

  return 'discovery';
}

/* ------------------------------------------------------------- recording */

function pushSignal(session: SessionState, kind: SignalKind, payload: SignalPayload): void {
  const signal: Signal = { kind, payload, at: Date.now() };
  session.signals = [...session.signals, signal];
}

/** Applies the vocabulary-checked facets a payload carries. Values outside
 *  the app's own facet lists are dropped here, never stored. */
function applyFacets(store: IntentStore, payload: SignalPayload, source: Provenance): void {
  const incoming = {} as Record<FacetSlotKey, string[]>;
  for (const key of FACET_SLOT_KEYS) {
    incoming[key] = normaliseMany(payload[key], FACET_NORMALISERS[key]);
  }

  /* A new subject invalidates what was chosen for the old one. Someone moving
     from Maths to Physics has not kept their Maths class level on purpose, and
     carrying it over is how a page ends up confidently describing a search
     nobody made. The reader can re-state it in one tap; guessing wrong costs
     more than asking again. */
  const nextSubject = incoming.subject[0] ?? null;
  const changingSubject =
    nextSubject !== null &&
    store.slots.subject.value !== null &&
    store.slots.subject.value !== nextSubject;

  if (changingSubject) {
    /* Everything below subject describes HOW to teach that subject, so it
       goes with it unless this same signal restates it. Board survives: it
       is a property of the student, not of the subject, and someone on the
       ICSE syllabus stays on it when they switch from Maths to Physics. */
    for (const key of ['classLevel', 'classSize', 'teachingMode', 'placeOfTeaching', 'examType'] as const) {
      if (incoming[key].length === 0) store.slots[key] = { ...EMPTY_SLOT };
    }
  }

  for (const key of FACET_SLOT_KEYS) {
    store.slots[key] = considerSlot(store.slots[key], incoming[key], source);
  }

  if (payload.mode === 'teachers' || payload.mode === 'papers') {
    store.mode = payload.mode;
  }

  const min = typeof payload.minFees === 'number' ? payload.minFees : null;
  const max = typeof payload.maxFees === 'number' ? payload.maxFees : null;
  if (payload.feeTouched === true || min !== null || max !== null) {
    store.priceObserved = true;
    store.budget = { min, max, source, at: Date.now() };
  }
}

/** Empties the facet slots. Used when the reader clears their filters, which
 *  is an explicit statement that the old specification no longer applies. */
function clearFacets(store: IntentStore): void {
  store.slots = emptySlots();
  store.priceObserved = false;
  store.budget = { ...EMPTY_BUDGET };
}

/**
 * The single entry point. Every surface that observes something calls this and
 * nothing else. Returns nothing: callers must not branch on intent at the
 * moment they record it, or the page starts reacting to the reader's own
 * click while they are still making it.
 */
export function recordSignal(kind: SignalKind, payload: SignalPayload = {}): void {
  /* Mirror the business-meaningful subset to GA4 and Clarity before anything
     else happens. This function is the single chokepoint every meaningful
     action already passes through, and until now all of it stopped at the
     device -- the whole contact funnel was being measured and thrown away.
     The mirror keeps its own allowlist, swallows every error, and must never
     be able to affect what follows. */
  mirrorSignal(kind, payload);

  const strength = SIGNAL_STRENGTH[kind];

  /* Weak signals are observed and stored for the debug panel, and go no
     further. They touch no slot and cannot reach deriveStage. */
  if (strength === 'weak') {
    updateSession((session) => pushSignal(session, kind, payload));
    return;
  }

  const source: Provenance = strength === 'strong' ? 'explicit' : 'derived';

  /* Snapshot before the write, so the predictor can learn the TRANSITION
     rather than just the destination: "with a subject already chosen, this
     reader picked an area next" is the useful fact, and it is unrecoverable
     once the slots have moved. */
  const beforeStore = readStore();
  const beforeSignature = filledSignature(beforeStore.slots);
  const beforeValues = FACET_SLOT_KEYS.reduce<Partial<Record<FacetSlotKey, string>>>(
    (acc, key) => {
      const v = beforeStore.slots[key].value;
      if (v) acc[key] = v;
      return acc;
    },
    {},
  );

  updateStore((store) => {
    if (payload.cleared === true) {
      clearFacets(store);
    } else {
      applyFacets(store, payload, source);
    }

    switch (kind) {
      case 'search_submitted':
      case 'builder_submitted': {
        /* The trail record is one sentence, so it takes the primary of each
           facet even when the reader selected several. */
        const subject = store.slots.subject.value;
        const area = store.slots.area.value;
        const classLevel = store.slots.classLevel.value;
        /* activity-trail's branch-3 record needs BOTH a subject and an area to
           read as a sentence, so a bare keyword search still writes nothing
           rather than storing half a line the hero cannot use. */
        if (subject && area) {
          store.lastSearch = {
            subject,
            area,
            classLevel: classLevel ?? undefined,
            at: Date.now(),
          };
        }
        const q = payload.query?.trim();
        if (q) {
          const mode: SearchMode = payload.mode === 'papers' ? 'papers' : 'teachers';
          const rest = store.searches.filter(
            (r) => r.q.toLowerCase() !== q.toLowerCase() || r.mode !== mode,
          );
          store.searches = [{ q, mode, ts: Date.now() }, ...rest].slice(0, CAPS.searches);
        }
        break;
      }

      case 'teacher_viewed': {
        const name = payload.name?.trim();
        if (name) {
          store.lastTeacher = {
            name,
            subject: normaliseMany(payload.subject, normaliseSubject)[0] ?? undefined,
            area: normaliseMany(payload.area, normaliseArea)[0] ?? undefined,
            slug: payload.id?.trim() || undefined,
            imageUrl: payload.imageUrl || undefined,
            at: Date.now(),
          };
        }
        break;
      }

      case 'paper_viewed': {
        const board = normaliseMany(payload.board, normaliseBoard)[0] ?? null;
        const subject = normaliseMany(payload.subject, normaliseSubject)[0] ?? null;
        if (board && subject) {
          store.lastPaper = { board, subject, at: Date.now() };
        }
        break;
      }

      case 'contact_completed': {
        const slug = payload.id?.trim();
        if (slug) {
          const rest = store.contacts.filter((c) => c.slug !== slug);
          store.contacts = [{ slug, ts: Date.now() }, ...rest].slice(0, CAPS.contacts);
        }
        break;
      }

      default:
        break;
    }
  });

  const session = updateSession((draft) => {
    pushSignal(draft, kind, payload);

    switch (kind) {
      case 'teacher_viewed': {
        const slug = payload.id?.trim();
        if (slug && !draft.teacherSlugs.includes(slug)) {
          draft.teacherSlugs = [...draft.teacherSlugs, slug];
        }
        break;
      }
      case 'paper_viewed': {
        const id = payload.id?.trim();
        if (id && !draft.paperIds.includes(id)) {
          draft.paperIds = [...draft.paperIds, id];
        }
        break;
      }
      case 'teacher_saved':
        draft.saved = true;
        break;
      case 'contact_started':
        draft.contactStarted = true;
        break;
      case 'contact_completed':
        draft.contactCompleted = true;
        break;
      default:
        break;
    }

    /* Clearing filters is a statement, so the session's own progress markers
       go with them. Without this the stage would stay pinned at evaluation by
       a teacher viewed ten minutes ago, and the page would keep describing a
       comparison the reader has just abandoned. */
    if (payload.cleared === true) {
      draft.teacherSlugs = [];
      draft.saved = false;
    }
  });

  /* Learn only from what the reader actually stated, unprompted.
     Derived values would teach the model the site's own routing (every
     visitor to /maths-tuition-teachers gets subject=Maths) rather than this
     person's preferences. Accepted predictions are excluded for a sharper
     reason: see SignalPayload.fromPrediction — a model that counts its own
     accepted suggestions as evidence will confirm anything it guesses. */
  if (source === 'explicit' && payload.cleared !== true && payload.fromPrediction !== true) {
    const afterStore = readStore();
    const changed = FACET_SLOT_KEYS.filter(
      (key) => afterStore.slots[key].value !== (beforeValues[key] ?? null),
    );
    const values = FACET_SLOT_KEYS.reduce<Partial<Record<FacetSlotKey, string>>>((acc, key) => {
      const v = afterStore.slots[key].value;
      if (v) acc[key] = v;
      return acc;
    }, {});
    observeStep({ before: beforeSignature, changed, values });
  }

  const stage = deriveStage({ store: readStore(), session });

  updateSession((draft) => {
    draft.stage = stage;
  });

  /* The durable stage only ever ratchets up, and only within the freshness
     window. It records how far this person has ever got, which is what the
     returning experience needs; the live stage is the session's. */
  const store = readStore();
  if (stageRank(stage) > stageRank(store.stage)) {
    updateStore((draft) => {
      draft.stage = stage;
    });
  }
}

/** Records a visit for the Recently-visited list. Kept separate from the
 *  signal path because it is a display concern with its own shape, and
 *  TeacherProfile already calls both for different reasons. */
export function recordVisitEntry(entry: {
  type: 'teacher' | 'paper';
  id: string;
  title: string;
  subtitle?: string;
  path: string;
}): void {
  updateStore((store) => {
    const rest = store.visits.filter((v) => !(v.type === entry.type && v.id === entry.id));
    store.visits = [{ ...entry, ts: Date.now() }, ...rest].slice(0, CAPS.visits);
  });
}

/** Marks a teacher contacted on this device. Separate from the contact signal
 *  for the same reason: contact-record.ts gates the review button on it, and
 *  that gate must keep working exactly as it does now. */
export function recordContactEntry(slug: string): void {
  if (!slug) return;
  recordSignal('contact_completed', { id: slug });
}

export { readSession, readStore };
