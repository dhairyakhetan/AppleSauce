/* Next-step prediction, learned on the device from this reader's own moves.
 *
 * WHAT THIS IS, PLAINLY: two count tables and a division. It is an online
 * n-gram/Markov model over the interaction sequence, not a neural network and
 * not a transformer. It shares their premise — look at the context so far,
 * rank what usually comes next, get sharper as evidence accumulates — and
 * none of their cost: no weights to ship, no training step, no request, a few
 * kilobytes of counters and an O(1) lookup per query. Calling it a transformer
 * would be flattering and false; this is the technique that actually fits a
 * client-side budget and a product with one reader per device.
 *
 * WHAT IT PREDICTS. Two questions, both directly useful to the UI:
 *
 *   1. WHICH FACET NEXT.  Given the set of slots already filled, which slot
 *      does this reader tend to fill next? That is what decides whether to
 *      offer an area chip or a class chip, rather than guessing an order.
 *      Context is the filled-slot signature, so it generalises across values.
 *
 *   2. WHICH VALUE.  Given subject = Maths, which area does this reader
 *      usually pair with it? Pairwise co-occurrence, which is what lets a
 *      chip read "Maths near Ballygunge" because that is the actual pattern
 *      rather than because Ballygunge was hardcoded first in a list.
 *
 * WHY IT IS SAFE. Three properties, all deliberate:
 *
 *   - MIN_SUPPORT. Nothing is predicted from one or two observations. A
 *     coincidence is not a pattern, and the whole system's rule is that weak
 *     evidence changes nothing. Predictions carry their support count so
 *     every consumer and the debug panel can see how much is behind them.
 *   - DECAY. Counts fade, so the model tracks what the reader is doing now
 *     rather than averaging over everything they ever did. Someone who has
 *     moved from Maths to Physics stops being predicted into Maths.
 *   - BOUNDED. Contexts and outcomes are capped and pruned by lowest count,
 *     so the table cannot grow without limit on a device we do not control.
 *
 * It never decides anything on its own. It ranks options the guardrails have
 * already permitted, and every caller still falls back to the static default
 * when support is thin.
 */

import type { FacetSlotKey, IntentIndex } from './types';
import { FACET_SLOT_KEYS } from './types';

const MODEL_KEY = 'shikshaq.intent.model';

/** Below this many observations a pattern is a coincidence, and predicting
 *  from it would be exactly the confidently-wrong failure to avoid. */
export const MIN_SUPPORT = 3;

/** Counts are multiplied by this every DECAY_EVERY observations, so recent
 *  behaviour outweighs old behaviour without needing timestamps per entry. */
const DECAY_FACTOR = 0.9;
const DECAY_EVERY = 40;
/** Anything this small after decay is noise; dropping it keeps the table lean. */
const PRUNE_BELOW = 0.4;

/* Caps chosen so the whole model stays a few KB: worst case is roughly
   CONTEXT_CAP * OUTCOME_CAP numbers plus their keys. */
const CONTEXT_CAP = 64;
const OUTCOME_CAP = 12;

type Counts = Record<string, number>;

interface PredictModel {
  v: 1;
  /** filled-slot signature -> which slot came next, counted. */
  nextSlot: Record<string, Counts>;
  /** "fromSlot=value>toSlot" -> which value came with it, counted. */
  pairs: Record<string, Counts>;
  /** Total observations, for the decay schedule and for reporting. */
  n: number;
  updatedAt: number;
}

export interface Prediction<T> {
  value: T;
  /** Share of this context's observations, Laplace-smoothed. */
  p: number;
  /** How many observations back it. Never below MIN_SUPPORT when returned. */
  support: number;
}

function emptyModel(): PredictModel {
  return { v: 1, nextSlot: {}, pairs: {}, n: 0, updatedAt: Date.now() };
}

/* ------------------------------------------------------------------- io */

let cached: PredictModel | null = null;

function readModel(): PredictModel {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(MODEL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PredictModel>;
      if (parsed && parsed.v === 1) {
        cached = {
          v: 1,
          nextSlot: isCountMap(parsed.nextSlot) ? parsed.nextSlot : {},
          pairs: isCountMap(parsed.pairs) ? parsed.pairs : {},
          n: typeof parsed.n === 'number' ? parsed.n : 0,
          updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
        };
        return cached;
      }
    }
  } catch {
    /* unreadable or unavailable: an empty model predicts nothing, which is
       the correct behaviour rather than an error worth surfacing. */
  }
  cached = emptyModel();
  return cached;
}

function isCountMap(v: unknown): v is Record<string, Counts> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function writeModel(model: PredictModel): void {
  cached = model;
  try {
    localStorage.setItem(MODEL_KEY, JSON.stringify(model));
  } catch {
    /* private mode or quota. The model stays in memory for this session and
       simply does not persist, which degrades to "no learning yet". */
  }
}

/* -------------------------------------------------------------- shaping */

/** The least a caller has to have for the signature: both a resolved
 *  IntentIndex and the raw stored slots satisfy this, so neither needs a cast
 *  to be read here. */
export type SlotsLike = Record<FacetSlotKey, { value: string | null }>;

/** Which slots are filled, as a stable, value-free key. Value-free on
 *  purpose: it is what makes the model generalise — the pattern "after a
 *  subject, this reader picks an area" holds whichever subject it was. */
export function filledSignature(slots: SlotsLike): string {
  const filled = FACET_SLOT_KEYS.filter((k) => slots[k].value !== null);
  return filled.length === 0 ? '-' : filled.sort().join('+');
}

function bump(counts: Counts, key: string, by = 1): void {
  counts[key] = (counts[key] ?? 0) + by;
  if (Object.keys(counts).length > OUTCOME_CAP) prune(counts, OUTCOME_CAP);
}

/** Keeps the `keep` highest counts and drops the rest. Bounded tables are
 *  the difference between a few KB and unbounded growth on someone's phone. */
function prune(counts: Counts, keep: number): void {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  for (const [key] of entries.slice(keep)) delete counts[key];
}

function decay(model: PredictModel): void {
  for (const table of [model.nextSlot, model.pairs]) {
    for (const context of Object.keys(table)) {
      const counts = table[context];
      for (const outcome of Object.keys(counts)) {
        counts[outcome] *= DECAY_FACTOR;
        if (counts[outcome] < PRUNE_BELOW) delete counts[outcome];
      }
      if (Object.keys(counts).length === 0) delete table[context];
    }
    if (Object.keys(table).length > CONTEXT_CAP) {
      /* Prune whole contexts by their total weight, so a context that has
         only ever been seen once goes before one seen often. */
      const totals = Object.entries(table)
        .map(([ctx, counts]) => [ctx, Object.values(counts).reduce((a, b) => a + b, 0)] as const)
        .sort((a, b) => b[1] - a[1]);
      for (const [ctx] of totals.slice(CONTEXT_CAP)) delete table[ctx];
    }
  }
}

/* ------------------------------------------------------------- learning */

export interface ObservedStep {
  /** Filled-slot signature BEFORE this step. */
  before: string;
  /** Slots whose value this step newly set or changed. */
  changed: FacetSlotKey[];
  /** The slot values in play after the step, for co-occurrence. */
  values: Partial<Record<FacetSlotKey, string>>;
}

/**
 * Records one step of the journey. Called from the signal recorder, after the
 * slots have been updated, with a snapshot of what changed.
 *
 * Only EXPLICIT steps should reach here — a facet the reader stated. Learning
 * from derived values would teach the model the site's own routing habits
 * rather than the reader's preferences.
 */
export function observeStep(step: ObservedStep): void {
  if (step.changed.length === 0) return;
  const model = readModel();

  for (const slot of step.changed) {
    const counts = (model.nextSlot[step.before] ??= {});
    bump(counts, slot);
  }

  /* Pairwise co-occurrence, both directions, so "which area for this
     subject" and "which subject in this area" are both answerable. */
  const present = Object.entries(step.values).filter(([, v]) => Boolean(v)) as Array<
    [FacetSlotKey, string]
  >;
  for (const [fromSlot, fromValue] of present) {
    for (const [toSlot, toValue] of present) {
      if (fromSlot === toSlot) continue;
      const counts = (model.pairs[`${fromSlot}=${fromValue}>${toSlot}`] ??= {});
      bump(counts, toValue);
    }
  }

  model.n += 1;
  model.updatedAt = Date.now();
  if (model.n % DECAY_EVERY === 0) decay(model);
  writeModel(model);
}

/* ----------------------------------------------------------- predicting */

function rank<T extends string>(counts: Counts | undefined): Prediction<T>[] {
  if (!counts) return [];
  const entries = Object.entries(counts);
  if (entries.length === 0) return [];
  const total = entries.reduce((sum, [, c]) => sum + c, 0);
  /* Laplace smoothing over the outcomes actually seen: it keeps a single
     observation from reading as certainty (1/1 = 100%) without needing a
     prior over every value in the vocabulary. */
  const denominator = total + entries.length;
  return entries
    .map(([value, count]) => ({
      value: value as T,
      p: (count + 1) / denominator,
      support: Math.round(count),
    }))
    .filter((c) => c.support >= MIN_SUPPORT)
    .sort((a, b) => b.p - a.p);
}

/** Which facet this reader tends to fill next, given what is already filled. */
export function predictNextSlot(intent: IntentIndex): Prediction<FacetSlotKey>[] {
  const model = readModel();
  const filled = new Set(FACET_SLOT_KEYS.filter((k) => intent[k].value !== null));
  /* A slot already filled is not a useful thing to predict next, however
     often it has been picked before. */
  return rank<FacetSlotKey>(model.nextSlot[filledSignature(intent)]).filter(
    (c) => !filled.has(c.value),
  );
}

/** Which value of `toSlot` this reader usually pairs with a known value. */
export function predictValue(
  fromSlot: FacetSlotKey,
  fromValue: string,
  toSlot: FacetSlotKey,
): Prediction<string>[] {
  const model = readModel();
  return rank<string>(model.pairs[`${fromSlot}=${fromValue}>${toSlot}`]);
}

/**
 * The best single value for a slot, using whatever the index already knows as
 * context. Tries the strongest known facet first, so a prediction is
 * conditioned on subject before it falls back to area.
 */
export function predictSlotValue(
  intent: IntentIndex,
  toSlot: FacetSlotKey,
): Prediction<string> | null {
  if (intent[toSlot].value !== null) return null;
  /* Order matters: subject is the most informative thing the site can know,
     so a prediction conditioned on it beats one conditioned on class size. */
  for (const fromSlot of ['subject', 'area', 'board', 'classLevel'] as const) {
    const fromValue = intent[fromSlot].value;
    if (!fromValue) continue;
    const [best] = predictValue(fromSlot, fromValue, toSlot);
    if (best) return best;
  }
  return null;
}

/** Model size and reach, for the debug panel. Never shown to a visitor. */
export function modelStats(): { observations: number; contexts: number; pairs: number } {
  const model = readModel();
  return {
    observations: model.n,
    contexts: Object.keys(model.nextSlot).length,
    pairs: Object.keys(model.pairs).length,
  };
}

/** Debug-panel only: forget what has been learned, for a cold-start walk. */
export function resetModel(): void {
  cached = emptyModel();
  try {
    localStorage.removeItem(MODEL_KEY);
  } catch {
    /* nothing to remove if storage is unavailable */
  }
}
