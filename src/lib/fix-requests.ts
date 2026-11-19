/**
 * Bug and edit requests (12 Nov 2026): a checker sends one in, the HOD approves it, then Claude fixes it.
 * An HOD's own request skips the approval and goes straight to Claude.
 *
 * Types, the normalisers that shape each function's rows, and the small pure rules: the words for each
 * state, the groups on the HOD tab, the counts, the name of a screen, the checks on a draft.
 * Pure, no Supabase client, so it is tested without a login. The calls themselves are in
 * fix-requests-api.ts, and the table is described in docs/FIX_REQUESTS.md.
 *
 * Every word on screen is plain: "Something is broken", never "bug ticket" or "RPC".
 */

import { formatDistance } from 'date-fns';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

// --------------------------------------------------------------- keys and memory

/** The root of every query key the request screens use, so one call refreshes them all. */
export const REQUESTS_QUERY_ROOT = 'fix-requests';

/** The key of the HOD desk's request counts (the badge on the Requests tab and the numbers on its filters). */
export const requestsCountsKey = (scope: string) => ['hod', scope, 'request-counts'] as const;

let savedDraft: RequestDraft | null = null;

/** What a person had typed when they closed the form without sending, so closing by accident loses nothing. */
export function readSavedDraft(): RequestDraft | null {
  return savedDraft;
}

export function saveDraft(d: RequestDraft): void {
  savedDraft = d;
}

/** Forget a remembered draft: done after a send, and by tests to start clean. */
export function clearSavedDraft(): void {
  savedDraft = null;
}

// ------------------------------------------------------------------- the limits

/** The same limits as the database (20261112100000_fix_requests.sql). */
export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const DETAILS_MAX = 4000;
export const NOTE_MAX = 500;
export const PAGE_MAX = 300;
export const DAILY_LIMIT = 10;

// ------------------------------------------------------------------ the shapes

export const REQUEST_STATUSES = ['waiting_for_hod', 'approved', 'in_progress', 'rejected', 'done'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export type RequestKind = 'bug' | 'edit';

export interface FixRequest {
  id: string;
  created_at: string | null;
  /** Who sent it (the HOD lists return it; the screen uses it to stop an HOD deciding their own). */
  raised_by?: string | null;
  /** Null when the list is the caller's own (their name is theirs), or when the account is gone. */
  raised_by_name: string | null;
  raised_as: 'member' | 'hod';
  kind: RequestKind;
  title: string;
  details: string;
  page_path: string | null;
  status: RequestStatus;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  claude_note: string | null;
  done_at: string | null;
}

const isStatus = (v: unknown): v is RequestStatus => typeof v === 'string' && (REQUEST_STATUSES as readonly string[]).includes(v);

/**
 * One row of request_my_list() or hod_request_list(). A row with no id, no title, a kind or a state this
 * screen does not know is left out: it is better to show nothing than to show the wrong state.
 * The words are passed through untouched, never trimmed or re-cased.
 */
export function normaliseRequest(raw: unknown): FixRequest | null {
  const r = obj(raw);
  const id = str(r.id);
  const title = str(r.title);
  const kind = r.kind === 'bug' || r.kind === 'edit' ? r.kind : null;
  if (!id || !title || !kind || !isStatus(r.status)) return null;
  return {
    id,
    created_at: str(r.created_at),
    raised_by: str(r.raised_by),
    raised_by_name: str(r.raised_by_name),
    raised_as: r.raised_as === 'hod' ? 'hod' : 'member',
    kind,
    title,
    details: typeof r.details === 'string' ? r.details : '',
    page_path: str(r.page_path),
    status: r.status,
    decided_by_name: str(r.decided_by_name),
    decided_at: str(r.decided_at),
    decision_note: str(r.decision_note),
    claude_note: str(r.claude_note),
    done_at: str(r.done_at),
  };
}

export function normaliseRequests(raw: unknown): FixRequest[] {
  return (Array.isArray(raw) ? raw : []).map(normaliseRequest).filter((r): r is FixRequest => r !== null);
}

export interface RequestCounts {
  waiting_for_hod: number;
  approved: number;
  in_progress: number;
  rejected: number;
  done: number;
}

export const NO_REQUEST_COUNTS: RequestCounts = { waiting_for_hod: 0, approved: 0, in_progress: 0, rejected: 0, done: 0 };

/** hod_request_counts(): one row (or the row inside an array). Anything missing counts as 0. */
export function normaliseRequestCounts(raw: unknown): RequestCounts {
  const r = obj(Array.isArray(raw) ? raw[0] : raw);
  return {
    waiting_for_hod: num(r.waiting_for_hod),
    approved: num(r.approved),
    in_progress: num(r.in_progress),
    rejected: num(r.rejected),
    done: num(r.done),
  };
}

/** The number on the HOD tab's badge: requests waiting for the HOD. */
export function waitingCount(counts: RequestCounts | null | undefined): number {
  return counts ? counts.waiting_for_hod : 0;
}

// --------------------------------------------------------------- the words

export const KIND_CHOICES: { kind: RequestKind; label: string; hint: string }[] = [
  { kind: 'bug', label: 'Something is broken', hint: 'A button does nothing, a page looks wrong, a number is wrong.' },
  { kind: 'edit', label: 'Something should change', hint: 'A word, a screen or a way of working you would like different.' },
];

/** A short name for a card. */
export function kindWord(kind: RequestKind): string {
  return kind === 'bug' ? 'Broken' : 'Change';
}

/** What a member sees for each state. */
export function memberStatusWord(status: RequestStatus): string {
  switch (status) {
    case 'waiting_for_hod':
      return 'Waiting for your HOD';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Not taken forward';
    case 'in_progress':
      return 'Being fixed';
    case 'done':
      return 'Done';
  }
}

/** What an HOD sees for each state. */
export function hodStatusWord(status: RequestStatus): string {
  switch (status) {
    case 'waiting_for_hod':
      return 'Waiting for you';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'in_progress':
      return 'Being fixed';
    case 'done':
      return 'Done';
  }
}

/**
 * The sentence under a request in the member's own list: what happened to it, in words.
 * A rejection carries the HOD's reason; a finished one carries what Claude did.
 */
export function memberStatusLine(r: Pick<FixRequest, 'status' | 'raised_as' | 'decision_note' | 'claude_note'>): string {
  switch (r.status) {
    case 'waiting_for_hod':
      return 'Your HOD has not looked at this yet.';
    case 'approved':
      return r.raised_as === 'hod' ? 'It has gone straight on to be fixed.' : 'Your HOD said yes. It is waiting to be fixed.';
    case 'rejected':
      return r.decision_note ? `Your HOD decided not to take this forward. Their reason: ${r.decision_note}` : 'Your HOD decided not to take this forward.';
    case 'in_progress':
      return 'Someone is working on this now.';
    case 'done':
      return r.claude_note ? `Fixed. What was done: ${r.claude_note}` : 'Fixed.';
  }
}

export const SENT_TO_HOD = 'Sent to your HOD. They will look at it before it goes on.';
export const SENT_AS_HOD = 'Sent. Because you are an HOD, it goes straight on to be fixed.';
export const HOD_NEW_REQUEST_NOTE = 'A request you send here is approved at once and goes straight to Claude to fix. Nobody has to say yes first.';
export const MEMBER_NEW_REQUEST_NOTE = 'Your HOD will read this first. If they say yes, it goes on to be fixed.';

// ------------------------------------------------------------------- the groups

export type RequestGroup = 'waiting' | 'approved' | 'rejected' | 'done';

export const REQUEST_GROUPS: { key: RequestGroup; label: string; statuses: RequestStatus[]; empty: string }[] = [
  { key: 'waiting', label: 'Waiting for you', statuses: ['waiting_for_hod'], empty: 'Nothing is waiting for you. When a member sends in a request, it shows here.' },
  { key: 'approved', label: 'Approved', statuses: ['approved', 'in_progress'], empty: 'No approved request is waiting to be fixed.' },
  { key: 'rejected', label: 'Rejected', statuses: ['rejected'], empty: 'No request has been rejected.' },
  { key: 'done', label: 'Done', statuses: ['done'], empty: 'Nothing has been fixed yet.' },
];

export const DEFAULT_GROUP: RequestGroup = 'waiting';

export function groupOf(status: RequestStatus): RequestGroup {
  return REQUEST_GROUPS.find((g) => g.statuses.includes(status))?.key ?? DEFAULT_GROUP;
}

export function groupStatuses(group: RequestGroup): RequestStatus[] {
  return REQUEST_GROUPS.find((g) => g.key === group)?.statuses ?? [];
}

/** Newest first; a row with no readable time goes last. Does not change the list it is given. */
export function newestFirst(list: FixRequest[]): FixRequest[] {
  const time = (r: FixRequest) => {
    const t = r.created_at ? new Date(r.created_at).getTime() : NaN;
    return Number.isNaN(t) ? -Infinity : t;
  };
  return [...list].sort((a, b) => time(b) - time(a));
}

/** Every request filed under its group, each group newest first. */
export function groupRequests(list: FixRequest[]): Record<RequestGroup, FixRequest[]> {
  const out: Record<RequestGroup, FixRequest[]> = { waiting: [], approved: [], rejected: [], done: [] };
  for (const r of newestFirst(list)) out[groupOf(r.status)].push(r);
  return out;
}

/** How many sit in each group, from the one counts call. Approved includes the ones being fixed. */
export function groupCounts(counts: RequestCounts | null | undefined): Record<RequestGroup, number> {
  const c = counts ?? NO_REQUEST_COUNTS;
  return { waiting: c.waiting_for_hod, approved: c.approved + c.in_progress, rejected: c.rejected, done: c.done };
}

/** What the tab badge means, for the tooltip and screen readers. */
export function requestsBadgeLabel(n: number): string {
  return n === 1 ? '1 request waiting for you' : `${n} requests waiting for you`;
}

/** "3 minutes ago", or "" when the time is missing or unreadable. */
export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatDistance(d, now, { addSuffix: true });
}

// ------------------------------------------------------------------- the screen

/** The path and query of the page a request was sent from, kept within the database limit. */
export function screenPath(loc: { pathname: string; search?: string }): string {
  return `${loc.pathname}${loc.search ?? ''}`.slice(0, PAGE_MAX);
}

/**
 * The name of the screen a request came from, in words. Paper ids and the like are left out of the
 * name; the full path is still stored for Claude. Anything it does not know is shown as the path.
 */
export function describeScreen(path: string | null | undefined): string {
  if (!path) return 'Not known';
  const q = path.indexOf('?');
  const pathname = q === -1 ? path : path.slice(0, q);
  const params = new URLSearchParams(q === -1 ? '' : path.slice(q + 1));
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/checker') {
    if (params.get('paper') && params.get('verify') === '1') return 'My papers, checking a question';
    if (params.get('paper')) return 'My papers, one paper';
    return 'My papers';
  }
  if (clean === '/checker/practice') return 'The practice round';
  if (clean === '/checker/help') return 'Rules and shortcuts';
  if (clean === '/hod') {
    const tab = params.get('tab');
    const label = tab ? HOD_TAB_NAMES[tab] : undefined;
    return label ? `HOD desk, ${label}` : 'HOD desk';
  }
  if (clean === '/hod/pipeline') return 'HOD desk, Pipeline';
  if (clean === '/') return 'The home page';
  return clean;
}

const HOD_TAB_NAMES: Record<string, string> = {
  'needs-you': 'Needs you',
  ready: 'Ready to go live',
  uploads: 'Uploads',
  requests: 'Requests',
  live: 'Live papers',
  assignments: 'Assignments',
  checkers: 'Checkers',
  history: 'History',
  'ai-trust': 'AI trust',
  'teacher-reviewers': 'Reviewers',
};

// ----------------------------------------------------------------------- drafts

export interface RequestDraft {
  kind: RequestKind | null;
  title: string;
  details: string;
}

export const EMPTY_DRAFT: RequestDraft = { kind: null, title: '', details: '' };

/** The first problem with a draft, in words, or null when it can be sent. Mirrors the database's checks. */
export function draftProblem(d: RequestDraft): string | null {
  if (d.kind !== 'bug' && d.kind !== 'edit') return 'Choose whether something is broken or something should change.';
  const title = d.title.trim();
  if (title.length < TITLE_MIN) return `Give it a short title, at least ${TITLE_MIN} letters.`;
  if (title.length > TITLE_MAX) return `The title is too long. Keep it under ${TITLE_MAX} letters.`;
  if (d.details.trim().length > DETAILS_MAX) return `The details are too long. Keep them under ${DETAILS_MAX} letters.`;
  return null;
}

/** What a rejection or an approval note needs before it is sent. A rejection must say why. */
export function decisionProblem(approve: boolean, note: string): string | null {
  const n = note.trim();
  if (n.length > NOTE_MAX) return `The note is too long. Keep it under ${NOTE_MAX} letters.`;
  if (!approve && n === '') return 'Say in a few words why this is not going ahead.';
  return null;
}

// ----------------------------------------------------------------------- errors

const ERROR_FALLBACK = 'That did not go through. Nothing was changed. Try again.';

/**
 * A sentence for a failed call. The database writes plain English for its own refusals (bad input,
 * the daily limit, an already-decided request), and those are shown as written. A plain "not allowed"
 * or anything unexpected gets a line of ours, so a raw database message never reaches the screen.
 */
export function requestErrorWords(err: unknown, fallback = ERROR_FALLBACK): string {
  if (!err || typeof err !== 'object') return fallback;
  const e = err as { code?: unknown; message?: unknown };
  const message = typeof e.message === 'string' ? e.message.trim() : '';
  if (e.code === '42501') {
    return message && message !== 'Not authorized' ? message : 'Your account cannot do that. Nothing was changed.';
  }
  if ((e.code === '22023' || e.code === '54000' || e.code === '55000') && message) return message;
  return fallback;
}
