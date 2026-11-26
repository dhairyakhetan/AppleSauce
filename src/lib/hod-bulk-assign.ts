/* Bulk assigning on the HOD desk: which papers are ticked, running the existing
   one-paper assign call over them, and the plain-words result. Pure, so it is
   tested without a screen. Nothing here talks to the database: the caller hands
   in the assign function (api.assignPaper). */

import { reasonWords } from '@/lib/checker-timeout';

/** At most this many papers go in one bulk assign. */
export const MAX_BULK = 50;
/** How many assign calls run at the same time. */
export const BULK_CONCURRENCY = 4;

// ------------------------------------------------------------------ selection

/** Tick or untick one paper. Ticking is refused (selection returned as it was) once the limit is reached. */
export function toggleSelected(selected: ReadonlySet<string>, id: string, max = MAX_BULK): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
  } else if (next.size < max) {
    next.add(id);
  }
  return next;
}

/** Tick the first `max` papers of the list, in the order shown. */
export function selectFirst(ids: readonly string[], max = MAX_BULK): Set<string> {
  return new Set(ids.slice(0, max));
}

/** Drop ticks for papers that are no longer on the list (given out, or taken by someone else). */
export function pruneSelected(selected: ReadonlySet<string>, available: readonly string[]): Set<string> {
  const here = new Set(available);
  const next = new Set<string>();
  selected.forEach((id) => {
    if (here.has(id)) next.add(id);
  });
  return next;
}

export type SelectAllState = 'none' | 'some' | 'all';

/** State of the "Select all" box: all means every paper that can be ticked is ticked. */
export function selectAllState(selectedCount: number, listLength: number, max = MAX_BULK): SelectAllState {
  if (selectedCount === 0) return 'none';
  return selectedCount >= Math.min(listLength, max) ? 'all' : 'some';
}

/** "Select all 12", or "Select the first 50 of 213" when the list is longer than one bulk run allows. */
export function selectAllLabel(listLength: number, max = MAX_BULK): string {
  return listLength > max ? `Select the first ${max} of ${listLength}` : `Select all ${listLength}`;
}

// ------------------------------------------------------------------- the run

export interface BulkItem {
  paperId: string;
  /** What the paper is called on screen, for the result. */
  label: string;
}

export interface BulkResult extends BulkItem {
  ok: boolean;
  /** The server's reason, as written, when it refused. */
  error?: string;
}

function reasonOf(err: unknown): string {
  return reasonWords(err, 'That did not work.');
}

/**
 * Runs `assign` for every item, at most `concurrency` at once, and never stops
 * early: one refusal does not cancel the others. Every item comes back with its
 * own ok or error, in the order given. More than `max` items is an error: the
 * screen never offers that, so it is a bug if it happens.
 */
export async function runBulkAssign(
  items: readonly BulkItem[],
  assign: (paperId: string) => Promise<unknown>,
  opts: { concurrency?: number; max?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<BulkResult[]> {
  const { concurrency = BULK_CONCURRENCY, max = MAX_BULK, onProgress } = opts;
  if (items.length > max) throw new Error(`Assign at most ${max} papers at once.`);
  const results: BulkResult[] = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const item = items[i];
      try {
        await assign(item.paperId);
        results[i] = { ...item, ok: true };
      } catch (err) {
        results[i] = { ...item, ok: false, error: reasonOf(err) };
      }
      done++;
      onProgress?.(done, items.length);
    }
  }
  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

/** "Assigning 3 of 12..." */
export function progressText(done: number, total: number): string {
  return `Assigning ${Math.min(done, total)} of ${total} ${total === 1 ? 'paper' : 'papers'}...`;
}

const papers = (n: number) => `${n} ${n === 1 ? 'paper' : 'papers'}`;

export interface Outcome {
  tone: 'good' | 'mixed' | 'bad';
  headline: string;
  /** Extra plain lines under the headline. */
  lines: string[];
  /** One entry per paper that was refused, with the server's reason. */
  failures: { label: string; reason: string }[];
  /** A place to fix what stopped the hand-out (for example Checkers, when details expired). */
  link?: { to: string; label: string };
}

/** The honest result of a bulk assign: how many went, and each refusal by name. */
export function summariseBulk(results: readonly BulkResult[], targetName: string): Outcome {
  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  const failures = bad.map((r) => ({ label: r.label, reason: r.error ?? 'That did not work.' }));
  if (bad.length === 0) {
    return { tone: 'good', headline: `Gave ${papers(ok.length)} to ${targetName}.`, lines: [], failures };
  }
  if (ok.length === 0) {
    return {
      tone: 'bad',
      headline: `None of the ${papers(bad.length)} could be given to ${targetName}.`,
      lines: ['They are still ticked, so you can pick someone else and try again.'],
      failures,
    };
  }
  return {
    tone: 'mixed',
    headline: `Gave ${ok.length} of ${results.length} papers to ${targetName}. ${bad.length} ${bad.length === 1 ? 'was' : 'were'} refused.`,
    lines: ['The refused papers are still ticked.'],
    failures,
  };
}

// ---------------------------------------------------------------- auto assign

/**
 * Why "Auto assign all" is switched off, in words shown under it, or null when it can be pressed. `gate` is loadGate
 * of the list of papers nobody has; `count` is how many are on it.
 */
export function autoAssignOffReason(gate: 'loading' | 'error' | 'ready', count: number): string | null {
  if (gate === 'loading') return 'Still counting the papers. The button switches on in a moment.';
  if (gate === 'error') return 'The papers waiting could not be counted, so the button stays off. Try again below.';
  if (count <= 0) return 'Nothing to hand out: every paper that is ready already has a checker.';
  return null;
}

export interface HeldPaper {
  paper_id: string;
  user_id: string;
  /** The holder's name as shown. */
  name: string;
}

/**
 * The automatic hand-out only returns how many papers it gave. Who got what is
 * worked out by comparing what each verifier held before and after, so it is
 * exactly what the list now shows. A paper that moved between people counts for
 * the person it moved to.
 */
export function newlyHeld(before: readonly HeldPaper[], after: readonly HeldPaper[]): { name: string; count: number }[] {
  const was = new Set(before.map((b) => `${b.paper_id}|${b.user_id}`));
  const tally = new Map<string, { name: string; count: number }>();
  for (const a of after) {
    if (was.has(`${a.paper_id}|${a.user_id}`)) continue;
    const t = tally.get(a.user_id) ?? { name: a.name, count: 0 };
    t.count++;
    tally.set(a.user_id, t);
  }
  return [...tally.values()].sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
}

// ------------------------------------------------- why papers or people got nothing

/** A checker holds at most this many papers with work (verifier_paper_cap() on the server). */
export const PAPER_CAP = 10;

/** Where details are fixed: the Checkers tab. */
export const CHECKERS_LINK = { to: '/hod?tab=verifiers', label: 'Open Checkers to fix their details' } as const;

export interface LeftoverInput {
  /** The class grade (1 to 12) of each paper still listed after the run; null when its class is not known. */
  leftPapers: { grade: number | null }[];
  /** The list of papers left was cut short, so the paper counts are "at least". */
  leftIsAtLeast?: boolean;
  /** The active checkers. */
  people: { user_id: string }[];
  /** Their details, or null when the details did not load. A grade of null means not recorded (the server reads it as Class 12). */
  profiles: { user_id: string; grade: number | null; expired: boolean; preferred_subjects: string[] }[] | null;
  /** Who holds what after the run, with the questions left for them. */
  held: { user_id: string; remaining: number }[];
  /** Who got at least one paper in this run. */
  gotSome: readonly string[];
  cap?: number;
  /**
   * The database's own reasons (hod_handout_reasons, 20261126330000), or null/undefined when it could not be asked
   * (the file is not pasted yet, or the call failed). With them every paper and checker gets the hand-out's real rule,
   * including the two the screen cannot see (own school, let it sit for 7 days).
   */
  server?: HandoutReasons | null;
}

export interface LeftoverWhy {
  lines: string[];
  /** True when something is fixed on the Checkers tab (expired details, no subjects set). */
  fixOnCheckers: boolean;
}

const checkers = (n: number) => `${n} ${n === 1 ? 'checker' : 'checkers'}`;

/**
 * Why papers stayed without a checker, and why checkers got nothing, from what the screen already holds. It follows
 * the hand-out's own rules (distribute_unassigned_papers): only active checkers whose details have not expired, at most
 * 10 papers with work each, never a paper above their grade. Two of its rules cannot be seen from here (a checker's
 * own school, and a paper a checker let sit for 7 days), so a paper blocked only by those is said to be so in words,
 * not guessed at. Subjects never stop a paper; they only help pick who gets it.
 */
export function explainLeftovers(input: LeftoverInput): LeftoverWhy {
  if (input.server) return explainFromServer(input, input.server);
  const cap = input.cap ?? PAPER_CAP;
  const lines: string[] = [];
  let fixOnCheckers = false;
  const profileOf = new Map((input.profiles ?? []).map((p) => [p.user_id, p]));
  const holding = new Map<string, number>();
  for (const h of input.held) if (h.remaining > 0) holding.set(h.user_id, (holding.get(h.user_id) ?? 0) + 1);
  const expired = (id: string) => profileOf.get(id)?.expired === true;
  const gradeOf = (id: string) => profileOf.get(id)?.grade ?? 12;
  const eligible = input.people.filter((p) => !expired(p.user_id));
  const withRoom = eligible.filter((p) => (holding.get(p.user_id) ?? 0) < cap);

  // The papers.
  if (input.leftPapers.length > 0) {
    let full = 0;
    let grade = 0;
    let nobody = 0;
    let other = 0;
    for (const paper of input.leftPapers) {
      if (eligible.length === 0) nobody++;
      else if (withRoom.length === 0) full++;
      else if (paper.grade !== null && withRoom.every((p) => gradeOf(p.user_id) < (paper.grade as number))) grade++;
      else other++;
    }
    const of = input.leftIsAtLeast ? 'Of the papers still listed, ' : '';
    const n = (k: number) => `${k} ${k === 1 ? 'paper' : 'papers'}`;
    if (nobody > 0) lines.push(`${of}${n(nobody)}: no checker can take papers right now (none is active, or their details expired).`);
    if (full > 0) lines.push(`${of}${n(full)}: every checker who can take papers already holds ${cap} papers with work, the most anyone can hold.`);
    if (grade > 0) lines.push(`${of}${n(grade)}: the class is above the grade of every checker who has room.`);
    if (other > 0) {
      lines.push(
        `${of}${n(other)}: no rule we can see here stops ${other === 1 ? 'it' : 'them'}. The hand-out also keeps a paper from a checker at its own school, and from one who let it sit for 7 days.`,
      );
    }
  }

  // The people who got nothing.
  const got = new Set(input.gotSome);
  const none = input.people.filter((p) => !got.has(p.user_id));
  if (none.length > 0) {
    if (input.profiles === null) {
      lines.push('The details of the checkers did not load, so why each person got nothing is not shown.');
    } else {
      const exp = none.filter((p) => expired(p.user_id)).length;
      const current = none.filter((p) => !expired(p.user_id));
      const atCap = current.filter((p) => (holding.get(p.user_id) ?? 0) >= cap).length;
      const room = current.filter((p) => (holding.get(p.user_id) ?? 0) < cap);
      const below =
        input.leftPapers.length > 0 && input.leftPapers.every((x) => x.grade !== null)
          ? room.filter((p) => input.leftPapers.every((x) => (x.grade as number) > gradeOf(p.user_id))).length
          : 0;
      const ranOut = input.leftPapers.length === 0 ? room.length : 0;
      const noSubjects = current.filter((p) => (profileOf.get(p.user_id)?.preferred_subjects.length ?? 0) === 0).length;
      if (exp > 0) {
        lines.push(`${checkers(exp)} got nothing because their details have expired. Update them on Checkers.`);
        fixOnCheckers = true;
      }
      if (atCap > 0) lines.push(`${checkers(atCap)} already ${atCap === 1 ? 'holds' : 'hold'} ${cap} papers with work, the most anyone can hold.`);
      if (below > 0) lines.push(`${checkers(below)} ${below === 1 ? 'is' : 'are'} below the class of every paper left.`);
      if (ranOut > 0) lines.push(`${checkers(ranOut)} got nothing because no paper was left to give.`);
      if (noSubjects > 0) {
        lines.push(
          `${checkers(noSubjects)} who got nothing ${noSubjects === 1 ? 'has' : 'have'} no subjects set. That does not stop papers, but setting subjects on Checkers helps Auto assign match them.`,
        );
        fixOnCheckers = true;
      }
    }
  }
  return { lines, fixOnCheckers };
}

// --------------------------------------------- the database's own reasons (20261126330000)

/** Why a paper was not handed out: the first hand-out rule that rules out every checker. */
export type PaperBlock = 'taken' | 'no_checker' | 'all_full' | 'grade' | 'own_school' | 'let_it_sit' | 'other';
/** Why a checker got nothing, from the checker's side of the same rules. */
export type PersonBlock = 'expired' | 'full' | 'none_left' | 'grade' | 'own_school' | 'let_it_sit' | 'other';

const PAPER_BLOCKS: readonly PaperBlock[] = ['taken', 'no_checker', 'all_full', 'grade', 'own_school', 'let_it_sit', 'other'];
const PERSON_BLOCKS: readonly PersonBlock[] = ['expired', 'full', 'none_left', 'grade', 'own_school', 'let_it_sit', 'other'];

export interface HandoutReasons {
  papers: { paper_id: string; reason: PaperBlock }[];
  checkers: { user_id: string; reason: PersonBlock }[];
  /** verifier_paper_cap() */
  cap: number;
  /** verifier_idle_days() */
  idleDays: number;
}

/** Most papers the screen asks the database about in one call (the function reads at most this many). */
export const REASONS_MAX = 200;

/** The answer of hod_handout_reasons, or null when it is not the expected shape (an unknown reason reads as 'other'). */
export function normaliseHandoutReasons(raw: unknown): HandoutReasons | null {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r || !Array.isArray(r.papers) || !Array.isArray(r.checkers)) return null;
  const n = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);
  const papers: HandoutReasons['papers'] = [];
  for (const x of r.papers) {
    const o = x && typeof x === 'object' ? (x as Record<string, unknown>) : {};
    if (typeof o.paper_id !== 'string' || o.paper_id === '') continue;
    const reason = PAPER_BLOCKS.includes(o.reason as PaperBlock) ? (o.reason as PaperBlock) : 'other';
    papers.push({ paper_id: o.paper_id, reason });
  }
  const people: HandoutReasons['checkers'] = [];
  for (const x of r.checkers) {
    const o = x && typeof x === 'object' ? (x as Record<string, unknown>) : {};
    if (typeof o.user_id !== 'string' || o.user_id === '') continue;
    const reason = PERSON_BLOCKS.includes(o.reason as PersonBlock) ? (o.reason as PersonBlock) : 'other';
    people.push({ user_id: o.user_id, reason });
  }
  return { papers, checkers: people, cap: n(r.cap, PAPER_CAP), idleDays: n(r.idle_days, 7) };
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** explainLeftovers when the database said why: one line per reason, counted, in the hand-out's own order. */
function explainFromServer(input: LeftoverInput, server: HandoutReasons): LeftoverWhy {
  const lines: string[] = [];
  let fixOnCheckers = false;
  const cap = server.cap;
  const of = input.leftIsAtLeast ? 'Of the papers still listed, ' : '';
  const n = (k: number) => `${k} ${k === 1 ? 'paper' : 'papers'}`;
  const count = <T extends string>(rows: { reason: T }[], reason: T) => rows.filter((x) => x.reason === reason).length;
  const it = (k: number) => (k === 1 ? 'it' : 'them');

  const paperLine: Record<PaperBlock, (k: number) => string> = {
    taken: (k) => `${of}${n(k)}: given to a checker just now, so ${k === 1 ? 'it leaves' : 'they leave'} this list.`,
    no_checker: (k) => `${of}${n(k)}: no checker can take papers right now (none is active, or their details expired).`,
    all_full: (k) => `${of}${n(k)}: every checker who can take papers already holds ${cap} papers with work, the most anyone can hold.`,
    grade: (k) => `${of}${n(k)}: the class is above the grade of every checker who has room.`,
    own_school: (k) => `${of}${n(k)}: every checker who could take ${it(k)} is at the paper's own school, and nobody checks a paper from their own school.`,
    let_it_sit: (k) =>
      `${of}${n(k)}: the checkers who could take ${it(k)} let ${it(k)} sit for ${days(server.idleDays)} before, so ${k === 1 ? 'it is' : 'they are'} not given back to them yet.`,
    other: (k) => `${of}${n(k)}: a checker could take ${it(k)} now. Press Auto assign all again.`,
  };
  for (const reason of PAPER_BLOCKS) {
    const k = count(server.papers, reason);
    if (k > 0) lines.push(paperLine[reason](k));
  }

  // The people who got nothing, by the database's reason. Only the checkers this screen lists are counted.
  const got = new Set(input.gotSome);
  const listed = new Set(input.people.map((x) => x.user_id));
  const none = server.checkers.filter((c) => listed.has(c.user_id) && !got.has(c.user_id));
  const personLine: Record<PersonBlock, (k: number) => string> = {
    expired: (k) => `${checkers(k)} got nothing because their details have expired. Update them on Checkers.`,
    full: (k) => `${checkers(k)} already ${k === 1 ? 'holds' : 'hold'} ${cap} papers with work, the most anyone can hold.`,
    none_left: (k) => `${checkers(k)} got nothing because no paper was left to give.`,
    grade: (k) => `${checkers(k)} ${k === 1 ? 'is' : 'are'} below the class of every paper left.`,
    own_school: (k) => `${checkers(k)} got nothing because every paper left that suits their class is from their own school.`,
    let_it_sit: (k) => `${checkers(k)} got nothing because they let the papers left that suit them sit for ${days(server.idleDays)} before.`,
    other: (k) => `${checkers(k)} could take a paper that is left. Press Auto assign all again.`,
  };
  for (const reason of PERSON_BLOCKS) {
    const k = count(none, reason);
    if (k === 0) continue;
    lines.push(personLine[reason](k));
    if (reason === 'expired') fixOnCheckers = true;
  }

  // Subjects never stop a paper, but setting them helps the hand-out match. Said only when the details loaded.
  if (input.profiles !== null) {
    const profileOf = new Map(input.profiles.map((x) => [x.user_id, x]));
    const noSubjects = input.people.filter((x) => {
      const prof = profileOf.get(x.user_id);
      return !got.has(x.user_id) && prof?.expired !== true && (prof?.preferred_subjects.length ?? 0) === 0;
    }).length;
    if (noSubjects > 0) {
      lines.push(
        `${checkers(noSubjects)} who got nothing ${noSubjects === 1 ? 'has' : 'have'} no subjects set. That does not stop papers, but setting subjects on Checkers helps Auto assign match them.`,
      );
      fixOnCheckers = true;
    }
  }
  return { lines, fixOnCheckers };
}

/**
 * What to say after "Auto assign all". `gave` is the number the server returned;
 * `perPerson` and `left` come from a fresh read afterwards (null when that read
 * failed, in which case only the server's number is shown). `leftIsAtLeast`
 * means the list is longer than the screen asks for. `why` (explainLeftovers) says
 * why papers or people got nothing, and adds a link to Checkers when that is where
 * the fix is.
 */
export function summariseAutoAssign(input: {
  gave: number;
  perPerson: { name: string; count: number }[] | null;
  left: number | null;
  leftIsAtLeast?: boolean;
  why?: LeftoverWhy | null;
}): Outcome {
  const { gave, perPerson, left, leftIsAtLeast, why } = input;
  const lines: string[] = [];
  if (perPerson && perPerson.length > 0) {
    lines.push(perPerson.map((p) => `${p.name}: ${papers(p.count)}`).join(', '));
  }
  if (left !== null) {
    if (left === 0) {
      lines.push('No paper is left without a checker.');
    } else {
      const count = leftIsAtLeast ? `At least ${papers(left)}` : papers(left);
      lines.push(`${count} could not be given out by the rules, so ${left === 1 && !leftIsAtLeast ? 'it is' : 'they are'} still listed below. You can assign them yourself.`);
    }
  }
  if (why) lines.push(...why.lines);
  const link = why?.fixOnCheckers ? { link: { ...CHECKERS_LINK } } : {};
  if (gave <= 0) {
    return { tone: 'bad', headline: 'Nothing could be given out by the rules right now.', lines, failures: [], ...link };
  }
  return { tone: left === 0 || left === null ? 'good' : 'mixed', headline: `Gave out ${papers(gave)}.`, lines, failures: [], ...link };
}
