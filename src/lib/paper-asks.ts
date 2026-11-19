/**
 * "Ask HOD for more papers" (owner, 13 Nov 2026). A checker who has finished everything taps one button; the HODs see who
 * is free. Pure helpers only: no data access here, so the screens, the fake and the tests share them.
 *
 * The database side is supabase/migrations/20261113200000_ask_for_papers.sql (the owner pastes it). Until it is pasted the
 * calls fail with "function not found"; `isNotSwitchedOn` recognises that so the screens show a friendly note, never an
 * error screen.
 */

/** An ask nobody answers is dropped after this many days (the database uses the same number). */
export const ASK_EXPIRES_DAYS = 3;

/** What tapping the button came back with. */
export type AskOutcome = 'asked' | 'already_asked' | 'has_work';

/** One person on the HOD's "Waiting for papers" list. */
export interface PaperAsk {
  ask_id: string;
  user_id: string;
  name: string;
  asked_at: string | null;
  /** Papers they finished in the last 14 days (0 when unknown). */
  finished_recently: number;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** The reply of paper_ask_for_more(). Anything unexpected is null, never a guess: the caller shows "did not go through". */
export function normaliseAskOutcome(raw: unknown): AskOutcome | null {
  return raw === 'asked' || raw === 'already_asked' || raw === 'has_work' ? raw : null;
}

/** paper_ask_mine(): the time of the person's open ask, or null when there is none (or it is unreadable). */
export function normaliseAskedAt(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  return Number.isNaN(new Date(s).getTime()) ? null : s;
}

/** hod_paper_asks(): one row per waiting person, oldest first. Rows without an id are dropped. */
export function normalisePaperAsks(raw: unknown): PaperAsk[] {
  if (!Array.isArray(raw)) return [];
  const out: PaperAsk[] = [];
  for (const row of raw) {
    const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    const id = str(r.ask_id);
    const user = str(r.user_id);
    if (!id || !user) continue;
    out.push({
      ask_id: id,
      user_id: user,
      name: str(r.person_name) ?? 'A checker',
      asked_at: normaliseAskedAt(r.asked_at),
      finished_recently: Math.max(0, Math.floor(num(r.finished_recently))),
    });
  }
  return out.sort((a, b) => (a.asked_at ?? '').localeCompare(b.asked_at ?? ''));
}

/**
 * True when the database has not got the new functions yet (the owner has not pasted the file): PostgREST says
 * PGRST202, Postgres says 42883, and either way the message names "function" or "schema cache".
 */
export function isNotSwitchedOn(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  if (code === 'PGRST202' || code === '42883') return true;
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return msg.includes('could not find the function') || msg.includes('schema cache');
}

/** The plain-words reason for a refused or failed ask. */
export function askFailureMessage(err: unknown): string {
  const e = err && typeof err === 'object' ? (err as { code?: unknown; message?: unknown }) : {};
  if (e.code === '54000' && typeof e.message === 'string' && e.message.trim() !== '') return e.message;
  if (e.code === '42501') return 'Only checkers can ask for papers. Sign in with your checker account and try again.';
  return 'That did not go through. Check your connection and tap the button again.';
}

/** "Free since yesterday" style line for the HOD list. */
export function waitingLine(a: Pick<PaperAsk, 'finished_recently'>, since: string): string {
  const parts = [since ? `Free ${since}` : 'Free now'];
  if (a.finished_recently > 0) {
    parts.push(`finished ${a.finished_recently} ${a.finished_recently === 1 ? 'paper' : 'papers'} in the last two weeks`);
  }
  return parts.join(' · ');
}

/** What a checker reads after tapping, by outcome. Warm and short: they are volunteers. */
export function askOutcomeMessage(outcome: AskOutcome): string {
  switch (outcome) {
    case 'asked':
      return 'Thank you. Your HOD can see you are free and will give you more papers soon.';
    case 'already_asked':
      return 'You already asked. Your HOD can see it, so there is nothing more to do right now.';
    case 'has_work':
      return 'You already have a paper waiting in My papers. Finish it first, then ask for more.';
  }
}
