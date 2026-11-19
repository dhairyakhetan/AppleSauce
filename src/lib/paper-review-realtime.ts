/**
 * Pure helpers for the paper-review realtime channel (W13). The channel
 * itself lives in src/hooks/usePaperReviewChannel.ts; everything here is
 * free of React and Supabase so it can be unit tested.
 *
 * The server side is supabase/migrations/20260928180000_paper_review_realtime.sql:
 * database triggers send a small private Broadcast on topic 'paper-review',
 * event 'activity', whenever a checker or admin acts. Clients can only
 * write presence on that topic, never a broadcast, so every activity event
 * really came from the database.
 */

export const PAPER_REVIEW_TOPIC = 'paper-review';
export const PAPER_REVIEW_EVENT = 'activity';

export interface PaperReviewActivity {
  /** 'audit' = an action on the audit_* staging copy (checker work, escalations);
   *  'live' = an admin change to a live bank_* row. */
  source: 'audit' | 'live';
  action: string;
  /** audit_questions.id, or null for a paper-level or account-level action. */
  questionId: string | null;
  /** audit_papers.id, or null. */
  paperId: string | null;
  /** The acting account, or null for an AI/system action. */
  actorUserId: string | null;
  at: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Validates a broadcast payload. Anything malformed is dropped (null), never thrown. */
export function parseActivityPayload(payload: unknown): PaperReviewActivity | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const action = str(p.action);
  if (!action) return null;
  return {
    source: p.source === 'live' ? 'live' : 'audit',
    action,
    questionId: str(p.question_id),
    paperId: str(p.paper_id),
    actorUserId: str(p.actor_user_id),
    at: str(p.at),
  };
}

/**
 * True when this event means "someone other than me changed or cleared the
 * question I have open", so the checker should be told and moved on.
 */
export function isForeignChangeToOpenQuestion(
  event: PaperReviewActivity,
  openQuestionId: string | null | undefined,
  myUserId: string | null | undefined,
): boolean {
  if (!openQuestionId || event.questionId !== openQuestionId) return false;
  // An AI/system change (no actor) is someone else too.
  if (event.actorUserId && myUserId && event.actorUserId === myUserId) return false;
  return true;
}

/** First word of a full name, for presence. Never an email. */
export function firstNameOf(fullName: string | null | undefined): string {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  // A full_name field that holds an email address would leak it; drop it.
  if (!first || first.includes('@')) return 'Someone';
  return first.slice(0, 40);
}

export interface PresenceMeta {
  user_id?: unknown;
  first_name?: unknown;
}

export interface OnlinePerson {
  userId: string;
  firstName: string;
}

/**
 * Turns realtime-js presenceState() ({ [key]: meta[] }) into one entry per
 * person: several open tabs are one person, entries without a user id are
 * dropped, and the viewer can be left out. Sorted by name for a stable list.
 */
export function shapeOnlineList(
  state: Record<string, PresenceMeta[] | undefined> | null | undefined,
  excludeUserId?: string | null,
): OnlinePerson[] {
  const byId = new Map<string, OnlinePerson>();
  for (const metas of Object.values(state ?? {})) {
    for (const meta of metas ?? []) {
      const userId = str(meta?.user_id);
      if (!userId || userId === excludeUserId || byId.has(userId)) continue;
      byId.set(userId, {
        userId,
        firstName: firstNameOf(typeof meta.first_name === 'string' ? meta.first_name : null),
      });
    }
  }
  return [...byId.values()].sort(
    (a, b) => a.firstName.localeCompare(b.firstName) || a.userId.localeCompare(b.userId),
  );
}

/** "Asha", "Asha and Ravi", "Asha, Ravi and Mou". */
export function formatOnlineNames(people: OnlinePerson[]): string {
  const names = people.map((p) => p.firstName);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export interface Debouncer {
  /** Ask for a run. Bursts collapse into one trailing run. */
  trigger: () => void;
  /** Drop any pending run. */
  cancel: () => void;
  /** True when a run is scheduled. */
  pending: () => boolean;
}

/**
 * Trailing debounce with a ceiling: a burst of events runs `fn` once,
 * `wait` ms after the last event, but never later than `maxWait` ms after
 * the first one, so a steady stream of checker actions still refreshes.
 * Timers are injectable for tests.
 */
export function createDebouncer(
  fn: () => void,
  wait: number,
  maxWait: number,
  timers: { set: (cb: () => void, ms: number) => unknown; clear: (id: unknown) => void } = {
    set: (cb, ms) => setTimeout(cb, ms),
    clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  },
  now: () => number = () => Date.now(),
): Debouncer {
  let timer: unknown = null;
  let firstAt: number | null = null;

  const run = () => {
    timer = null;
    firstAt = null;
    fn();
  };

  return {
    trigger() {
      const t = now();
      if (firstAt === null) firstAt = t;
      if (timer !== null) timers.clear(timer);
      const untilCeiling = Math.max(firstAt + maxWait - t, 0);
      timer = timers.set(run, Math.min(wait, untilCeiling));
    },
    cancel() {
      if (timer !== null) timers.clear(timer);
      timer = null;
      firstAt = null;
    },
    pending: () => timer !== null,
  };
}
