import { paperLabel } from '@/lib/checker-progress';
import { daysSince } from '@/lib/paper-status';
import type { HodAssignment } from '@/lib/hod-api';

/* "Who has what" on the HOD desk, made for long lists (13 Nov 2026: about 30 people and 100+ papers).
   Everything here is a plain function so it can be tested without a screen: group the papers by
   person, add up each person's load, search, filter, sort, and show a long list a page at a time.
   Nothing here reads the database or changes anything. */

/* ------------------------------------------------------------------ the choices on screen */

export type SortKey = 'questions' | 'papers' | 'oldest' | 'name';

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'questions', label: 'Most questions left' },
  { key: 'papers', label: 'Most papers' },
  { key: 'oldest', label: 'Oldest paper first' },
  { key: 'name', label: 'Name' },
];

export const DEFAULT_SORT: SortKey = 'questions';

export type ChipKey = 'stuck' | 'waiting' | 'light' | 'heavy';

export const CHIPS: { key: ChipKey; label: string; hint: string }[] = [
  { key: 'stuck', label: 'Has stuck papers', hint: 'Papers with nothing done on them for 7 days or more.' },
  { key: 'waiting', label: 'Waiting for an HOD', hint: 'The checker finished their part; the rest waits for an HOD to decide.' },
  { key: 'light', label: 'Light load', hint: 'Few questions left, including people with no papers.' },
  { key: 'heavy', label: 'Heavy load', hint: 'Many questions left.' },
];

/** A person with this many questions left or fewer has a light load (nobody with no papers is excluded). */
export const LIGHT_MAX_QUESTIONS = 20;
/** A person with this many questions left or more has a heavy load. */
export const HEAVY_MIN_QUESTIONS = 100;

/** People shown before "Show more", and papers shown inside one opened person. */
export const PEOPLE_PAGE = 25;
export const PAPERS_PAGE = 20;

/** Light and heavy cannot both be on: switching one on switches the other off. */
export function toggleChip(on: ChipKey[], key: ChipKey): ChipKey[] {
  if (on.includes(key)) return on.filter((k) => k !== key);
  const opposite: ChipKey | null = key === 'light' ? 'heavy' : key === 'heavy' ? 'light' : null;
  return [...on.filter((k) => k !== opposite), key];
}

/* ------------------------------------------------------------------ the people */

/** Why a paper is flagged, from the existing reasons in paper-status.ts (null when it is not). */
export interface PaperFlags {
  stuck: string | null;
  waiting: string | null;
}

export interface PersonEntry {
  user_id: string;
  name: string;
  /** Holds no paper at all. */
  idle: boolean;
  /** Why an idle person holds nothing, when it is not just "nothing to give out". */
  why: string | null;
  /** Their papers: stuck first, then waiting for an HOD, then the oldest. */
  papers: HodAssignment[];
  paperCount: number;
  questionsLeft: number;
  /** The oldest hand-out among their papers. */
  oldestAssignedAt: string | null;
  oldestDays: number | null;
  stuckCount: number;
  waitingCount: number;
}

export interface IdlePerson {
  user_id: string;
  name: string;
  why: string | null;
}

type FlagsOf = (a: HodAssignment) => PaperFlags;

const time = (iso: string | null): number => {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};

function rank(a: HodAssignment, flagsOf: FlagsOf): number {
  const f = flagsOf(a);
  return f.stuck ? 0 : f.waiting ? 1 : 2;
}

/** One person's totals from the papers they hold. */
export function personFrom(
  base: { user_id: string; name: string; idle: boolean; why: string | null },
  papers: HodAssignment[],
  flagsOf: FlagsOf,
  now: Date,
): PersonEntry {
  const sorted = [...papers].sort((a, b) => rank(a, flagsOf) - rank(b, flagsOf) || time(a.assigned_at) - time(b.assigned_at) || a.assignment_id - b.assignment_id);
  let oldest: string | null = null;
  for (const p of sorted) if (p.assigned_at && (oldest === null || time(p.assigned_at) < time(oldest))) oldest = p.assigned_at;
  return {
    ...base,
    papers: sorted,
    paperCount: sorted.length,
    questionsLeft: sorted.reduce((n, p) => n + (Number.isFinite(p.remaining) ? p.remaining : 0), 0),
    oldestAssignedAt: oldest,
    oldestDays: daysSince(oldest, now),
    stuckCount: sorted.filter((p) => flagsOf(p).stuck).length,
    waitingCount: sorted.filter((p) => flagsOf(p).waiting).length,
  };
}

/** Everyone who holds a paper, plus the people who hold none. */
export function buildPeople(assignments: HodAssignment[], idle: IdlePerson[], flagsOf: FlagsOf, now: Date): PersonEntry[] {
  const byUser = new Map<string, HodAssignment[]>();
  const names = new Map<string, string>();
  for (const a of assignments) {
    const list = byUser.get(a.user_id) ?? [];
    list.push(a);
    byUser.set(a.user_id, list);
    if (!names.has(a.user_id)) names.set(a.user_id, a.checker_name ?? 'Unnamed verifier');
  }
  const out: PersonEntry[] = [];
  for (const [user_id, papers] of byUser) out.push(personFrom({ user_id, name: names.get(user_id) ?? 'Unnamed verifier', idle: false, why: null }, papers, flagsOf, now));
  for (const p of idle) if (!byUser.has(p.user_id)) out.push(personFrom({ user_id: p.user_id, name: p.name, idle: true, why: p.why }, [], flagsOf, now));
  return out;
}

export interface Totals {
  people: number;
  holding: number;
  papers: number;
  questionsLeft: number;
  stuck: number;
  waiting: number;
}

export function summarise(people: PersonEntry[]): Totals {
  return {
    people: people.length,
    holding: people.filter((p) => !p.idle).length,
    papers: people.reduce((n, p) => n + p.paperCount, 0),
    questionsLeft: people.reduce((n, p) => n + p.questionsLeft, 0),
    stuck: people.reduce((n, p) => n + p.stuckCount, 0),
    waiting: people.reduce((n, p) => n + p.waitingCount, 0),
  };
}

/* ------------------------------------------------------------------ search, filter, sort */

const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);

/** Every word typed must appear somewhere in the text. An empty search matches everything. */
export function matchesQuery(text: string, query: string): boolean {
  const terms = words(query);
  if (terms.length === 0) return true;
  const hay = text.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export interface View {
  query: string;
  chips: ChipKey[];
  sort: SortKey;
}

const loadOf = (p: PersonEntry): ChipKey | null => (p.questionsLeft >= HEAVY_MIN_QUESTIONS ? 'heavy' : p.questionsLeft <= LIGHT_MAX_QUESTIONS ? 'light' : null);

/**
 * The list for the current search, filters and sort. A person is kept when their name matches or one of their
 * papers does; with a search or a "stuck" or "waiting" filter only the matching papers stay under them, and their
 * totals are worked out again from what is left, so the line on screen always adds up to the rows beneath it.
 */
export function applyView(people: PersonEntry[], view: View, flagsOf: FlagsOf, now: Date): PersonEntry[] {
  const wantStuck = view.chips.includes('stuck');
  const wantWaiting = view.chips.includes('waiting');
  const wantLoad = view.chips.includes('light') ? 'light' : view.chips.includes('heavy') ? 'heavy' : null;
  const searching = words(view.query).length > 0;
  const kept: PersonEntry[] = [];
  for (const person of people) {
    if (wantLoad && loadOf(person) !== wantLoad) continue;
    const nameHit = searching && matchesQuery(person.name, view.query);
    let papers = person.papers;
    if (searching && !nameHit) papers = papers.filter((p) => matchesQuery(`${person.name} ${paperLabel(p)} ${p.exam ?? ''}`, view.query));
    if (wantStuck) papers = papers.filter((p) => flagsOf(p).stuck);
    if (wantWaiting) papers = papers.filter((p) => flagsOf(p).waiting);
    const filtered = papers.length !== person.papers.length;
    // A person with no papers has nothing to flag, so a stuck or waiting filter drops them; a name search keeps them.
    if (person.idle) {
      if (wantStuck || wantWaiting) continue;
      if (searching && !nameHit) continue;
      kept.push(person);
      continue;
    }
    if (papers.length === 0) continue;
    kept.push(filtered ? personFrom({ user_id: person.user_id, name: person.name, idle: false, why: null }, papers, flagsOf, now) : person);
  }
  return sortPeople(kept, view.sort);
}

export function sortPeople(people: PersonEntry[], sort: SortKey): PersonEntry[] {
  const byName = (a: PersonEntry, b: PersonEntry) => a.name.localeCompare(b.name);
  const out = [...people];
  switch (sort) {
    case 'questions':
      return out.sort((a, b) => b.questionsLeft - a.questionsLeft || b.paperCount - a.paperCount || byName(a, b));
    case 'papers':
      return out.sort((a, b) => b.paperCount - a.paperCount || b.questionsLeft - a.questionsLeft || byName(a, b));
    case 'oldest':
      // People with no papers have no date and go last.
      return out.sort((a, b) => time(a.oldestAssignedAt) - time(b.oldestAssignedAt) || byName(a, b));
    default:
      return out.sort(byName);
  }
}

/* ------------------------------------------------------------------ a long list, a page at a time */

export function windowRows<T>(rows: T[], shown: number): { visible: T[]; hidden: number } {
  const n = Math.max(0, Math.floor(shown));
  return { visible: rows.slice(0, n), hidden: Math.max(0, rows.length - n) };
}

/** "Show 25 more" never claims more than is left. */
export function moreLabel(hidden: number, page: number): string {
  return `Show ${Math.min(hidden, page)} more`;
}

/* ------------------------------------------------------------------ plain words for the lines */

export const questionsLeftText = (n: number) => `${n} ${n === 1 ? 'question' : 'questions'} left`;
export const papersText = (n: number) => `${n} ${n === 1 ? 'paper' : 'papers'}`;

export function oldestText(days: number | null): string | null {
  if (days === null) return null;
  if (days === 0) return 'oldest given today';
  return `oldest given ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** One line for a person, for the row and for a screen reader. */
export function personLine(p: PersonEntry): string {
  if (p.idle) return 'No papers yet';
  const parts = [papersText(p.paperCount), questionsLeftText(p.questionsLeft)];
  const oldest = oldestText(p.oldestDays);
  if (oldest) parts.push(oldest);
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ remembered choices (this tab only) */

export interface ViewState {
  sort: SortKey;
  /** User ids of the opened people. */
  expanded: string[];
}

export const viewStateKey = (scope: string) => `shikshaq.hod.whohaswhat.${scope}`;

const isSort = (v: unknown): v is SortKey => v === 'questions' || v === 'papers' || v === 'oldest' || v === 'name';

/** Reads the remembered sort and opened people; anything missing or broken gives the defaults. Never throws. */
export function loadViewState(storage: Pick<Storage, 'getItem'> | null, scope: string): ViewState {
  const fallback: ViewState = { sort: DEFAULT_SORT, expanded: [] };
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(viewStateKey(scope));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { sort?: unknown; expanded?: unknown };
    return {
      sort: isSort(parsed.sort) ? parsed.sort : DEFAULT_SORT,
      expanded: Array.isArray(parsed.expanded) ? parsed.expanded.filter((x): x is string => typeof x === 'string').slice(0, 500) : [],
    };
  } catch {
    return fallback;
  }
}

/** Remembers the sort and opened people for this browser tab. Never throws (private windows can refuse). */
export function saveViewState(storage: Pick<Storage, 'setItem'> | null, scope: string, state: ViewState): void {
  if (!storage) return;
  try {
    storage.setItem(viewStateKey(scope), JSON.stringify({ sort: state.sort, expanded: state.expanded.slice(0, 500) }));
  } catch {
    // Remembering is a convenience; the list works without it.
  }
}

/** The tab's own storage, or null where the browser refuses or there is none (tests, private windows). */
export function tabStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
