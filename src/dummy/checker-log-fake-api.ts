import type { ActorKind } from '@/lib/history-labels';
import {
  addDays,
  countEvents,
  kolkataDay,
  normaliseCheckerRow,
  normaliseDayLog,
  type CheckerLogApi,
} from '@/lib/checker-log';
import { FIXTURE_NOW } from '@/dummy/approval-fake-api';

/**
 * In-memory fake of admin_checker_list() and admin_checker_day_log() (D75),
 * for previewing /admin/checker-log without an admin sign-in. Test builds
 * only: reached solely through the PREVIEW_TOOLS-gated lazy imports in the
 * two checker-log pages. Every person, paper and action is MADE UP and comes
 * from a seeded random generator, so the same data shows on every load.
 */

const ACTORS: { key: string; name: string; role: ActorKind; perDay: number; busyDays: number }[] = [
  { key: 'u:rahul', name: 'Rahul Das', role: 'student', perDay: 30, busyDays: 0.7 },
  { key: 'u:meera', name: 'Meera Iyer', role: 'student', perDay: 22, busyDays: 0.55 },
  { key: 'u:zoya', name: 'Zoya Khan', role: 'student', perDay: 12, busyDays: 0.3 },
  { key: 'u:priya', name: 'Priya Sharma', role: 'admin', perDay: 9, busyDays: 0.6 },
  { key: 'u:arjun', name: 'Arjun Mehta', role: 'admin', perDay: 6, busyDays: 0.45 },
  { key: 'ai:haiku', name: 'AI check (Haiku)', role: 'ai', perDay: 120, busyDays: 0.8 },
  { key: 'ai:sonnet', name: 'AI check (Sonnet)', role: 'ai', perDay: 40, busyDays: 0.6 },
  { key: 'pipeline', name: 'Pipeline (automatic)', role: 'pipeline', perDay: 8, busyDays: 0.5 },
];

const PAPERS = [
  { id: 'f1a00000-0000-4000-8000-0000000000a1', title: 'ICSE Class 10 Physics, 2026' },
  { id: 'f1a00000-0000-4000-8000-0000000000a2', title: 'CBSE Class 9 Geography, 2025' },
  { id: 'f1a00000-0000-4000-8000-0000000000a3', title: 'ICSE Class 8 History and Civics, 2025' },
  { id: 'f1a00000-0000-4000-8000-0000000000a4', title: 'ISC Class 12 Biology, 2025' },
  { id: 'f1a00000-0000-4000-8000-0000000000a5', title: 'ICSE Class 10 Chemistry, 2025' },
  { id: 'f1a00000-0000-4000-8000-0000000000a6', title: 'CBSE Class 10 Maths, 2024' },
];

/** [action, weight] per role. */
const ACTIONS: Record<ActorKind, [string, number][]> = {
  student: [['checker_pass', 30], ['checker_fix', 5], ['checker_printed_typo', 1], ['checker_skip', 2], ['checker_ask_help', 1]],
  admin: [['admin_pass', 6], ['admin_set_aside', 2], ['admin_edit', 3], ['admin_reopen', 1], ['admin_approve', 1]],
  ai: [['check_pass', 30], ['check_fix', 5], ['check_flag', 2], ['check_escalate', 1]],
  pipeline: [['load', 2], ['locate_page', 4], ['queued_for_approval', 1], ['publish', 1]],
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function weighted(rand: () => number, list: [string, number][]): string {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [a, w] of list) {
    if ((r -= w) <= 0) return a;
  }
  return list[0][0];
}

type RawEvent = Record<string, unknown>;

function eventsFor(actor: (typeof ACTORS)[number], day: string): RawEvent[] {
  const rand = mulberry32(hash(`${actor.key}|${day}`));
  if (rand() > actor.busyDays) return [];
  const n = Math.max(1, Math.round(actor.perDay * (0.4 + rand())));
  const paperCount = 1 + Math.floor(rand() * 3);
  const papers = Array.from({ length: paperCount }, () => PAPERS[Math.floor(rand() * PAPERS.length)]);
  const [y, m, d] = day.split('-').map(Number);
  // working hours in Kolkata, 9 am to 9 pm (UTC + 5:30)
  const startUtc = Date.UTC(y, m - 1, d, 3, 30);
  const out: RawEvent[] = [];
  for (let i = 0; i < n; i++) {
    const paper = papers[Math.floor(rand() * papers.length)];
    let action = weighted(rand, ACTIONS[actor.role]);
    if (action === 'admin_approve' && i % 5 !== 0) action = 'admin_pass';
    // each action on its own question, as a day's queue serves them
    const qn = i + 1;
    const at = new Date(startUtc + Math.floor(rand() * 12 * 3600_000)).toISOString();
    const question = !['load', 'queued_for_approval', 'publish', 'admin_approve'].includes(action);
    out.push({
      at,
      actor_name: actor.name,
      actor_kind: actor.role,
      action,
      model: actor.role === 'ai' ? actor.key.slice(3) : null,
      question_id: question ? `${paper.id.slice(0, 28)}q${String(qn).padStart(7, '0')}` : null,
      question_number: question ? String(qn) : null,
      confidence: actor.role === 'ai' ? 0.6 + rand() * 0.39 : null,
      changes:
        action === 'admin_edit'
          ? [{ field: 'marks', before: 2, after: 3 }]
          : action === 'checker_fix'
            ? [{ field: 'body', before: 'Find the value of x when 2x + 3 = 11', after: 'Find the value of x when 2x + 3 = 17' }]
            : [],
      note: action === 'admin_set_aside' ? 'The scan is cut off here' : null,
      paper_title: paper.title,
      paper_audit_id: paper.id,
      // an occasional pass the checker took back (Undo last); picked from the
      // seed, not from `rand`, so every other value keeps its place
      ...(actor.role === 'student' && action === 'checker_pass' && hash(`${actor.key}|${day}|${i}`) % 17 === 0 ? { undone: true } : {}),
    });
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export function createFakeCheckerLogApi(delayMs = 250, now: Date = FIXTURE_NOW): CheckerLogApi {
  const tick = () => new Promise((r) => setTimeout(r, delayMs));
  const today = kolkataDay(now);
  const notFuture = (e: RawEvent) => String(e.at) <= now.toISOString();

  return {
    async list() {
      await tick();
      return ACTORS.map((a) => {
        let total = 0;
        let last: string | null = null;
        let first: string | null = null;
        for (let i = 89; i >= 0; i--) {
          const evs = eventsFor(a, addDays(today, -i)).filter(notFuture);
          total += evs.length;
          if (evs.length) {
            first ??= evs[evs.length - 1].at as string;
            last = evs[0].at as string;
          }
        }
        return normaliseCheckerRow({ actor_key: a.key, name: a.name, role: a.role, first_at: first, last_at: last, total_actions: total });
      });
    },
    async dayLog(actorKey, from, to) {
      await tick();
      const a = ACTORS.find((x) => x.key === actorKey) ?? ACTORS[0];
      const days = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const events = eventsFor(a, d).filter(notFuture);
        // like the server, the counts leave out what was taken back
        if (events.length) days.push({ day: d, counts: countEvents(events.filter((e) => !e.undone) as { action: string }[]), events });
      }
      return normaliseDayLog({ actor: { name: a.name, role: a.role }, days }, actorKey);
    },
  };
}

let shared: CheckerLogApi | null = null;
export function sharedFakeCheckerLogApi(): CheckerLogApi {
  shared ??= createFakeCheckerLogApi();
  return shared;
}

export const FIXTURE_ACTOR_KEY = 'u:rahul';
