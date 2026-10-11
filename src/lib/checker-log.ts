/**
 * The checker log (owner, 2026-10-02): "an admin page to see a checker's log
 * day wise in good english language visually".
 *
 * Types, normalisers and the day-summary sentence for /admin/checker-log.
 * Pure (no Supabase client), so it is tested without a login. The RPC calls
 * are in checker-log-api.ts. Days are Asia/Kolkata calendar days: the server
 * buckets by them, and every helper here that makes a day key does too.
 * No em or en dashes in any copy.
 */

import { normaliseEvent, type HistoryEvent } from '@/lib/admin-approval-shape';
import { format, isSameYear } from 'date-fns';
import { ACTION_LABELS, actionWords as sentenceWords, actorLabel, cleanPersonName, normaliseActorKind, type ActorKind } from '@/lib/history-labels';

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------------------------
// Who

export interface CheckerRow {
  actor_key: string;
  name: string;
  role: ActorKind;
  first_at: string | null;
  last_at: string | null;
  total_actions: number;
}

export const ROLE_LABELS: Record<ActorKind, string> = {
  admin: 'Admin',
  student: 'Student checker',
  ai: 'AI check',
  pipeline: 'Automatic pipeline',
};

/** A row's display name: the person's name, or the AI or pipeline label. Never a key or an id. */
export function checkerName(name: string | null | undefined, role: ActorKind, actorKey?: string | null): string {
  if (role === 'ai' || role === 'pipeline') {
    return actorLabel({ actor_kind: role, actor_name: name ?? actorKey ?? null, model: actorKey ?? null });
  }
  return cleanPersonName(name) ?? (role === 'admin' ? 'An admin' : 'A student checker');
}

export function normaliseCheckerRow(raw: unknown): CheckerRow {
  const r = asObj(raw);
  const role = normaliseActorKind(str(r.role) ?? str(r.actor_kind));
  const key = str(r.actor_key) ?? '';
  return {
    actor_key: key,
    name: checkerName(str(r.name), role, key),
    role,
    first_at: str(r.first_at),
    last_at: str(r.last_at),
    total_actions: num(r.total_actions),
  };
}

/** The name as the start of a day sentence: a person's first name, or the full AI/pipeline label. */
export function shortName(name: string, role: ActorKind): string {
  if (role === 'ai' || role === 'pipeline') return name;
  if (/^(An admin|A student checker)$/.test(name)) return name;
  return name.split(/\s+/)[0] || name;
}

// ---------------------------------------------------------------------------
// Days

export const COUNT_KEYS = ['passed', 'fixed', 'set_aside', 'flagged', 'edited', 'approved', 'other'] as const;
export type CountKey = (typeof COUNT_KEYS)[number];
export type DayCounts = Record<CountKey, number>;

export const COUNT_LABELS: Record<CountKey, string> = {
  passed: 'Passed',
  fixed: 'Fixed',
  set_aside: 'Set aside',
  flagged: 'Flagged',
  edited: 'Edited',
  approved: 'Approved',
  other: 'Other',
};

/** Which bucket an action counts in. Mirrors admin_checker_day_log's counts. */
export function categoryOf(action: string): CountKey {
  switch (action) {
    case 'checker_pass':
    case 'admin_pass':
    case 'check_pass':
    case 'ai_pass':
      return 'passed';
    case 'checker_fix':
    case 'checker_printed_typo':
    case 'check_fix':
    case 'check_printed_typo':
    case 'ai_fix':
    case 'auto_fix':
      return 'fixed';
    case 'admin_set_aside':
      return 'set_aside';
    case 'check_flag':
    case 'check_escalate':
    case 'checker_ask_help':
    case 'ai_flagged':
    case 'ai_escalate':
      return 'flagged';
    case 'admin_edit':
    case 'admin_revert':
    case 'admin_draft_edit':
      return 'edited';
    case 'admin_approve':
      return 'approved';
    default:
      return 'other';
  }
}

export function emptyCounts(): DayCounts {
  return { passed: 0, fixed: 0, set_aside: 0, flagged: 0, edited: 0, approved: 0, other: 0 };
}

export function countEvents(events: { action: string }[]): DayCounts {
  const c = emptyCounts();
  for (const e of events) c[categoryOf(e.action)]++;
  return c;
}

export function totalOf(c: DayCounts): number {
  return COUNT_KEYS.reduce((s, k) => s + c[k], 0);
}

/** The header numbers for a range: how many actions, and on how many days there
 *  were any. A day that holds only taken-back work has a card but no actions, so
 *  it is not counted as a day with actions. */
export function rangeSummary(days: { counts: DayCounts; events: unknown[] }[]): { total: number; daysWithActions: number; cardDays: number } {
  const total = days.reduce((s, d) => s + totalOf(d.counts), 0);
  return {
    total,
    daysWithActions: days.filter((d) => totalOf(d.counts) > 0).length,
    cardDays: days.filter((d) => totalOf(d.counts) > 0 || d.events.length > 0).length,
  };
}

export type LogEvent = HistoryEvent & { paper_title: string | null; paper_audit_id: string | null };

export interface LogDay {
  /** 'YYYY-MM-DD', an Asia/Kolkata calendar day */
  day: string;
  counts: DayCounts;
  events: LogEvent[];
}

export interface CheckerDayLog {
  actor: { name: string; role: ActorKind };
  days: LogDay[];
}

export function normaliseDayLog(raw: unknown, actorKey?: string): CheckerDayLog {
  const r = asObj(raw);
  const a = asObj(r.actor);
  const role = normaliseActorKind(str(a.role) ?? str(a.actor_kind));
  const days = asArr(r.days)
    .map((d): LogDay => {
      const o = asObj(d);
      const events = asArr(o.events)
        .map((e) => {
          const eo = asObj(e);
          return {
            ...normaliseEvent(e),
            paper_title: str(eo.paper_title),
            paper_audit_id: str(pick2(eo, 'paper_audit_id', 'audit_paper_id')),
          };
        })
        .sort((x, y) => y.at.localeCompare(x.at));
      const co = asObj(o.counts);
      const counts = Object.keys(co).length
        ? (Object.fromEntries(COUNT_KEYS.map((k) => [k, num(co[k])])) as DayCounts)
        : countEvents(events);
      return { day: (str(o.day) ?? '').slice(0, 10), counts, events };
    })
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day))
    .sort((x, y) => y.day.localeCompare(x.day));
  return { actor: { name: checkerName(str(a.name), role, actorKey), role }, days };
}

function pick2(o: Json, a: string, b: string): unknown {
  return o[a] ?? o[b];
}

const IST_OFFSET_MS = 330 * 60_000;

/** The Asia/Kolkata calendar day of an instant, as 'YYYY-MM-DD'. */
export function kolkataDay(at: string | Date): string {
  const t = typeof at === 'string' ? new Date(at).getTime() : at.getTime();
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' plus n days (n may be negative). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Every day from `from` to `to`, inclusive, oldest first. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Tuesday 2 Oct', with the year when it is not `thisYear`. Calendar-only, no time zone shift. */
export function dayWords(day: string, thisYear?: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} ${d} ${MONTHS[m - 1]}${thisYear !== undefined && y !== thisYear ? ` ${y}` : ''}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The day in one sentence:
 * "Tuesday 2 Oct: Rahul checked 34 questions on 3 papers, passed 28, fixed 4, set aside 2."
 */
export function daySentence(
  actor: { name: string; role: ActorKind },
  day: LogDay,
  thisYear?: number,
): string {
  const who = shortName(actor.name, actor.role);
  // A pass that was taken back (Undo last) did not check the question, so it
  // does not count toward the questions or papers either.
  const standing = day.events.filter((e) => !e.undone);
  const qs = new Set(standing.map((e) => e.question_id).filter(Boolean)).size;
  const papers = new Set(standing.map((e) => e.paper_audit_id).filter(Boolean)).size;
  const c = day.counts;
  const parts: string[] = [];
  if (c.passed) parts.push(`passed ${c.passed}`);
  if (c.fixed) parts.push(`fixed ${c.fixed}`);
  if (c.set_aside) parts.push(`set aside ${c.set_aside}`);
  if (c.flagged) parts.push(`flagged ${c.flagged}`);
  if (c.edited) parts.push(`edited ${c.edited}`);
  if (c.approved) parts.push(`approved ${plural(c.approved, 'paper', 'papers')}`);
  let lead: string;
  if (day.events.length > 0 && standing.length === 0) {
    return `${dayWords(day.day, thisYear)}: ${who} took back everything they did.`;
  }
  if (qs > 0) {
    lead = `${who} checked ${plural(qs, 'question', 'questions')}${papers ? ` on ${plural(papers, 'paper', 'papers')}` : ''}`;
  } else if (papers > 0) {
    lead = `${who} worked on ${plural(papers, 'paper', 'papers')}`;
  } else {
    const n = totalOf(c);
    lead = `${who} did ${plural(n, 'thing', 'things')}`;
  }
  if (c.other) parts.push(plural(c.other, 'other action', 'other actions'));
  const tail = parts.length ? `, ${parts.join(', ')}` : '';
  return `${dayWords(day.day, thisYear)}: ${lead}${tail}.`;
}

/** "2 Oct", or "2 Oct 2025" for an earlier year, for the Since column. */
export function sinceWords(at: string | null | undefined, now: Date = new Date()): string {
  if (!at) return 'Not recorded';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return 'Not recorded';
  return format(d, isSameYear(d, now) ? 'd MMM' : 'd MMM yyyy');
}

/** What the "other" bucket mostly holds, in words: "looked for this question on the scanned pages". Null when nothing names it. */
export function otherActionWords(events: { action: string; undone?: boolean }[]): string | null {
  const tally = new Map<string, number>();
  for (const e of events) {
    if (e.undone || categoryOf(e.action) !== 'other' || !ACTION_LABELS[e.action]) continue;
    tally.set(e.action, (tally.get(e.action) ?? 0) + 1);
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return top ? sentenceWords({ action: top[0], at: '' }) : null;
}

/** 0..4 heat level for a day's total against the busiest day in view. */
export function heatLevel(total: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (total <= 0 || max <= 0) return 0;
  const r = total / max;
  if (r > 0.75) return 4;
  if (r > 0.5) return 3;
  if (r > 0.25) return 2;
  return 1;
}

export interface CheckerLogApi {
  list(): Promise<CheckerRow[]>;
  dayLog(actorKey: string, from: string, to: string): Promise<CheckerDayLog>;
}
