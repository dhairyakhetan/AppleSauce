/**
 * The checker's outbox: a verdict (Looks right, Fix it, Skip, Ask the HOD) is
 * written down FIRST and sent to the server in the background, so the screen
 * can show the next question at once (checker speed plan, 12 Oct 2026).
 *
 * The rules, each pinned by checker-outbox.test.ts:
 *
 *  - A verdict is never lost. It is written to localStorage before the screen
 *    moves on, kept through a failed send, a refresh or closing the tab, and
 *    removed only when the server accepts it (or refuses it for good).
 *  - A request that hangs fails like a lost connection. One send may take
 *    SEND_TIMEOUT_MS; after that `sending` is false again, the verdict shows as
 *    "Not saved yet" and is retried (the replay check below tells whether the
 *    first send actually landed).
 *  - A verdict is never sent twice. One send at a time, one entry per
 *    question (a second press on the same question is refused), and an entry
 *    that another tab already finished is not sent again.
 *  - Order holds. Verdicts of one paper go out in the order they were made;
 *    a failing one holds back the ones behind it on the same paper only.
 *  - A failure is calm. A network or server error is retried with a short
 *    wait (1 s, 2 s, 4 s, then every 8 s) and is shown as "Not saved yet". A
 *    refusal that retrying cannot change (the 10 minute lease ran out, someone
 *    else changed the question, no words) is reported once and dropped, as
 *    the old screen did.
 *
 * No React in here: the screen subscribes through useCheckerOutbox.
 */

import type { CheckerApi } from '@/lib/checker-api';
import { markNotSaved, mayHaveLanded, verdictWasSaved } from '@/lib/checker-advance';
import { checkerErrorAdvice } from '@/lib/checker-errors';
import { CHECKER_REQUEST_TIMEOUT_MS, withTimeout } from '@/lib/checker-timeout';
import type { VerdictAndNext } from '@/lib/checker-verdict-next';

export type VerdictKind = 'pass' | 'fix' | 'skip' | 'ask_help' | 'ask_ai_redo';

/** Everything a verdict needs to be sent again later, as plain JSON. */
export interface VerdictPayload {
  /** The version of the question the checker saw (pass and fix). */
  version?: number | null;
  /** Fix: the changes. `body` is null unless the words were edited. */
  patch?: { body?: string | null; display_number?: string | null; marks?: number | null; options?: unknown[] };
  printedTypo?: boolean;
  typoNote?: string | null;
  /** Ask the HOD: what to look at. */
  reason?: string;
  /** The "go through skipped" mode the checker was in, so the next question comes from the same list. */
  includeSkipped?: boolean;
}

export interface OutboxEntry {
  id: string;
  questionId: string;
  paperId: string;
  kind: VerdictKind;
  payload: VerdictPayload;
  createdAt: number;
  /** Sends that failed so far. */
  attempts: number;
  /** Not before this time (ms since epoch). */
  nextTryAt: number;
  lastError: string | null;
  /** Which page load wrote the entry; another tab leaves a young one alone. */
  owner: string;
}

export type OutboxInput = Pick<OutboxEntry, 'questionId' | 'paperId' | 'kind' | 'payload'>;

export interface OutboxState {
  /** Waiting or being sent, oldest first. */
  entries: readonly OutboxEntry[];
  /** True while a request is on its way. */
  sending: boolean;
  /** True when the first waiting verdict has failed at least once. */
  failing: boolean;
  /** True when a waiting verdict has been refused with a bare "Not authorized" AUTH_TROUBLE_AFTER times or more: the
   *  sign-in has probably lapsed or the person was switched off, and retrying alone will not help (audit CK-07). */
  authTrouble: boolean;
  lastError: string | null;
}

/** Retries of a bare "Not authorized" before the screen says it is a sign-in problem. */
export const AUTH_TROUBLE_AFTER = 3;

export interface OutboxStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface OutboxOptions {
  storageKey: string;
  storage: OutboxStorage | null;
  /** Sends one verdict. What it resolves with (the next question) is handed to onAck. */
  send: (entry: OutboxEntry) => Promise<unknown>;
  /** The server took it, with whatever `send` resolved with. Runs for entries sent after a refresh too. */
  onAck?: (entry: OutboxEntry, result?: unknown) => void;
  /** The server refused it for good; the entry is already removed. */
  onReject?: (entry: OutboxEntry, error: unknown) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Wait before try number `attempts` (1 = the first retry). */
  backoff?: (attempts: number) => number;
  /** Tells this page load from another tab's. */
  ownerId?: string;
  /** How long one send may take before it counts as failed. */
  sendTimeoutMs?: number;
}

export interface Outbox {
  /** Write the verdict down and start sending. Null = refused: that question already has a verdict waiting. */
  enqueue(input: OutboxInput): OutboxEntry | null;
  hasQuestion(questionId: string): boolean;
  /** Ids of the questions with a verdict waiting. */
  pendingQuestionIds(): ReadonlySet<string>;
  state(): OutboxState;
  subscribe(listener: () => void): () => void;
  /** Try the waiting verdicts now (the Retry button). */
  retryNow(): void;
  /** Send everything that is waiting. True when nothing is left, false when a verdict is held back by a failure. */
  flush(): Promise<boolean>;
  /** Stop timers. The entries stay in storage. */
  dispose(): void;
}

/** 1 s, 2 s, 4 s, then every 8 s. */
export function defaultBackoff(attempts: number): number {
  return Math.min(8000, 1000 * 2 ** Math.max(0, attempts - 1));
}

/** A young entry written by another tab is left to that tab. */
export const ADOPT_AFTER_MS = 20_000;

/** One send is the verdict and, after a stale refusal, a few reads that confirm it, each limited to CHECKER_REQUEST_TIMEOUT_MS. */
export const SEND_TIMEOUT_MS = CHECKER_REQUEST_TIMEOUT_MS * 3;

/**
 * True when sending the same request again cannot work, so retrying would
 * only spin: the lease ran out, someone else changed the question, there are
 * no words, the typo rule. Everything else (no network, a server hiccup, a
 * signed-out session) is worth another try.
 */
export function isDefiniteRefusal(err: unknown): boolean {
  if (checkerErrorAdvice(err).moveOn) return true;
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; message?: unknown; details?: unknown };
  const text = [e.message, e.details].filter((v) => typeof v === 'string').join(' ');
  // Any other 42501 the server raised about a question is final; only the bare
  // "Not authorized" (possibly a session that needs a refresh) is worth a retry.
  if (e.code === '42501' && text.trim() !== '' && !/^not authorized$/i.test(text.trim())) return true;
  return (
    e.code === '22023' ||
    /typo corrections are not switched on|printed typo fix must change the words|has no words|empty question/i.test(text)
  );
}

function errorText(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return String(err ?? 'Could not save');
}

function newId(now: number): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${now.toString(36)}-${rand}`;
}

function parse(raw: string | null): OutboxEntry[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (e): e is OutboxEntry =>
        Boolean(e) &&
        typeof e === 'object' &&
        typeof (e as OutboxEntry).id === 'string' &&
        typeof (e as OutboxEntry).questionId === 'string' &&
        typeof (e as OutboxEntry).paperId === 'string' &&
        ['pass', 'fix', 'skip', 'ask_help', 'ask_ai_redo'].includes((e as OutboxEntry).kind),
    );
  } catch {
    return [];
  }
}

export function createOutbox(opts: OutboxOptions): Outbox {
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const backoff = opts.backoff ?? defaultBackoff;
  const owner = opts.ownerId ?? newId(now());
  const sendTimeoutMs = opts.sendTimeoutMs ?? SEND_TIMEOUT_MS;

  const read = (): OutboxEntry[] => {
    try {
      return parse(opts.storage ? opts.storage.getItem(opts.storageKey) : null);
    } catch {
      return [];
    }
  };

  // Entries from an earlier page load. A young one that another tab wrote is
  // left to that tab (it is still sending it); it is looked at again later.
  let entries: OutboxEntry[] = read();
  let sending = false;
  let timer: unknown = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  let snapshot: OutboxState = { entries, sending, failing: false, authTrouble: false, lastError: null };

  const persist = () => {
    try {
      opts.storage?.setItem(opts.storageKey, JSON.stringify(entries));
    } catch {
      /* storage full or blocked: the verdict still waits in memory */
    }
  };

  const publish = () => {
    const head = entries[0];
    snapshot = {
      entries: [...entries],
      sending,
      failing: entries.some((e) => e.attempts > 0),
      authTrouble: entries.some((e) => e.attempts >= AUTH_TROUBLE_AFTER && /^not authorized$/i.test((e.lastError ?? '').trim())),
      lastError: head?.lastError ?? entries.find((e) => e.lastError)?.lastError ?? null,
    };
    listeners.forEach((l) => l());
  };

  /** Only a paper's oldest verdict may be sent, so one paper stays in order. */
  const isHeadOfItsPaper = (e: OutboxEntry) => entries.find((x) => x.paperId === e.paperId) === e;

  /** True when this entry was written by another tab recently enough that tab is probably still on it. */
  const belongsToLiveTab = (e: OutboxEntry) => e.owner !== owner && now() - e.createdAt < ADOPT_AFTER_MS;

  const stillStored = (e: OutboxEntry) => read().some((x) => x.id === e.id);

  const schedule = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (disposed || sending) return;
    let soonest = Infinity;
    for (const e of entries) {
      if (!isHeadOfItsPaper(e)) continue;
      const at = belongsToLiveTab(e) ? Math.max(e.nextTryAt, e.createdAt + ADOPT_AFTER_MS) : e.nextTryAt;
      soonest = Math.min(soonest, at);
    }
    if (soonest === Infinity) return;
    timer = setTimer(() => {
      timer = null;
      void pump();
    }, Math.max(0, soonest - now()));
  };

  const remove = (e: OutboxEntry) => {
    entries = entries.filter((x) => x.id !== e.id);
    persist();
  };

  async function pump(): Promise<void> {
    if (sending || disposed) return;
    for (;;) {
      const due = entries.find((e) => isHeadOfItsPaper(e) && e.nextTryAt <= now() && !belongsToLiveTab(e));
      if (!due) break;
      // Another tab may have finished it while this one slept.
      if (due.owner !== owner && !stillStored(due)) {
        remove(due);
        continue;
      }
      sending = true;
      publish();
      let failure: { error: unknown } | null = null;
      let result: unknown;
      try {
        // A send that never answers must not hold the paper's queue for ever.
        result = await withTimeout(
          opts.send(due),
          sendTimeoutMs,
          undefined,
          { set: (cb, ms) => setTimer(cb, ms), clear: (h) => clearTimer(h) },
        );
      } catch (error) {
        failure = { error };
      }
      sending = false;
      if (!failure) {
        remove(due);
        publish();
        opts.onAck?.(due, result);
      } else if (isDefiniteRefusal(failure.error)) {
        remove(due);
        publish();
        opts.onReject?.(due, failure.error);
      } else {
        const attempts = due.attempts + 1;
        const next: OutboxEntry = { ...due, attempts, lastError: errorText(failure.error), nextTryAt: now() + backoff(attempts) };
        entries = entries.map((x) => (x.id === due.id ? next : x));
        persist();
        publish();
      }
    }
    publish();
    schedule();
  }

  /** Resolves on the next change of the outbox. */
  const nextChange = () =>
    new Promise<void>((resolve) => {
      const off = () => {
        listeners.delete(fn);
        resolve();
      };
      const fn = () => off();
      listeners.add(fn);
    });

  publish();
  void pump();

  return {
    enqueue(input) {
      if (entries.some((e) => e.questionId === input.questionId)) return null;
      const t = now();
      const entry: OutboxEntry = {
        ...input,
        id: newId(t),
        createdAt: t,
        attempts: 0,
        nextTryAt: t,
        lastError: null,
        owner,
      };
      // Written down before anything is sent, and before the screen moves on.
      entries = [...entries, entry];
      persist();
      publish();
      void pump();
      return entry;
    },
    hasQuestion: (questionId) => entries.some((e) => e.questionId === questionId),
    pendingQuestionIds: () => new Set(entries.map((e) => e.questionId)),
    state: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    retryNow() {
      const t = now();
      entries = entries.map((e) => (e.attempts > 0 ? { ...e, nextTryAt: t } : e));
      persist();
      publish();
      void pump();
    },
    async flush() {
      for (;;) {
        if (entries.length === 0) return true;
        if (sending) {
          await nextChange();
          continue;
        }
        await pump();
        if (entries.length === 0) return true;
        // Nothing more is due: what is left waits for a retry or for another tab.
        if (!sending) return false;
      }
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}

/** What sending a verdict needs from the checker API. */
export type VerdictSendApi = Pick<CheckerApi, 'verdictAndNext' | 'paperQuestions' | 'nextInPaper' | 'questionContext'>;

/**
 * Send one waiting verdict: ONE call saves it and returns the next question of
 * the paper with its context (verifier_verdict_and_next). A refused verdict
 * throws the same error as the plain call and nothing is served.
 *
 * A send the server refuses as stale or "not assigned to you" may only mean an
 * earlier send of the same verdict did land (a retry, or a page that closed
 * mid-request) and its answer was lost. It is then checked with a read of the paper: only when the question
 * shows exactly what this verdict leaves (verdictWasSaved) is it taken as
 * saved, and the next question is read the plain way. In every other case the
 * original refusal is thrown, so it is shown, never swallowed.
 *
 * A refusal "not currently assigned to you" can also mean the 10 minute lease
 * simply ran out while the checker was still on the question (a long edit);
 * nothing renews a lease while a question is open. When the read shows the
 * verdict was not saved, the question is asked for again (that leases it to this
 * checker and does nothing else) and, only if the same question came back, the
 * verdict is sent once more. The version the checker saw still travels with it,
 * so words someone else changed in the meantime are never overwritten (40001).
 */
export async function sendVerdict(
  api: VerdictSendApi,
  e: Pick<OutboxEntry, 'questionId' | 'paperId' | 'kind' | 'payload'>,
): Promise<VerdictAndNext> {
  const p = e.payload;
  const attempt = () =>
    api.verdictAndNext({
      action: e.kind,
      questionId: e.questionId,
      paperId: e.paperId,
      version: p.version,
      patch: p.patch,
      printedTypo: p.printedTypo,
      typoNote: p.typoNote,
      reason:
        e.kind === 'ask_help'
          ? p.reason ?? 'Not sure how to fix this'
          : e.kind === 'ask_ai_redo'
            ? p.reason ?? ''
            : undefined,
      includeSkipped: p.includeSkipped,
    });
  try {
    return await attempt();
  } catch (err) {
    if (!mayHaveLanded(err)) throw err;
    let saved: { version: number | null } | null = null;
    let readOk = false;
    try {
      const row = (await api.paperQuestions(e.paperId)).find((q) => q.id === e.questionId);
      readOk = true;
      if (verdictWasSaved(e, row)) saved = { version: row!.version };
    } catch {
      /* the read failed too: show the original refusal */
    }
    // A read that showed the question unchanged proves nothing was saved
    // (a skip cannot be read back, so it is never marked).
    const refuse = (x: unknown) => (readOk && e.kind !== 'skip' ? markNotSaved(x) : x);
    if (!saved) {
      if (/not currently assigned/i.test(errorText(err)) && (await retakeLease(api, e))) {
        try {
          return await attempt();
        } catch (again) {
          throw refuse(again);
        }
      }
      throw refuse(err);
    }
    // It was saved. Read the next question the plain way (a failure here is a
    // network failure and is retried; the replay then confirms again).
    //
    // One refusal is not a failure: if this was the paper's last question, saving it closed the
    // paper behind the checker (verifier_close_finished runs inside the verdict), and the
    // server then answers "This paper is not assigned to you" to any further read. The verdict
    // is proven saved, so that answer means "nothing more on this paper": the paper is finished.
    // Left to throw, it made the screen say "this paper is no longer on your list" for an
    // answer that had in fact gone through (tracker of 2 Nov, "asked to sign in again").
    let next: Awaited<ReturnType<VerdictSendApi['nextInPaper']>> = null;
    try {
      next = await api.nextInPaper(e.paperId, { includeSkipped: p.includeSkipped });
    } catch (nextErr) {
      if (!/paper is not assigned to you/i.test(errorText(nextErr))) throw nextErr;
    }
    return {
      verdict_ok: true,
      verdict: e.kind,
      verdict_version: saved.version,
      next: next ? { ...next, context: await api.questionContext(next.id) } : null,
      next_paper_id: next ? e.paperId : null,
    };
  }
}

/** Ask for the paper's next question again. True when the question that came
 *  back is the one this verdict is for, which means its lease is this checker's
 *  again. Any failure is false: the original refusal is then shown. */
async function retakeLease(api: VerdictSendApi, e: Pick<OutboxEntry, 'questionId' | 'paperId' | 'payload'>): Promise<boolean> {
  try {
    const row = await api.nextInPaper(e.paperId, { includeSkipped: e.payload.includeSkipped });
    return row?.id === e.questionId;
  } catch {
    return false;
  }
}

/* One outbox per signed-in checker, kept for the life of the page so a save
   that is still on its way carries on after the checker leaves the verify
   screen. The key carries the user: a verdict is never sent as someone else. */

const registry = new Map<string, Outbox>();

export function outboxStorageKey(scope: string, userId: string | undefined): string {
  return `shikshaq.checker.outbox.v1:${scope}:${userId ?? 'anon'}`;
}

function browserStorage(): OutboxStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** One id per browser tab, kept through a refresh, so a refreshed tab picks its
 *  own waiting verdicts up at once while another tab leaves them alone. */
function tabOwnerId(): string | undefined {
  try {
    if (typeof window === 'undefined') return undefined;
    const k = 'shikshaq.checker.outbox.tab';
    let id = window.sessionStorage.getItem(k);
    if (!id) {
      id = newId(Date.now());
      window.sessionStorage.setItem(k, id);
    }
    return id;
  } catch {
    return undefined;
  }
}

export interface OutboxHooks {
  api: VerdictSendApi;
  /** `result` is what the server returned with the verdict: the next question, or none. */
  onAck?: (entry: OutboxEntry, result: VerdictAndNext | null) => void;
  onReject?: (entry: OutboxEntry, error: unknown) => void;
}

const hooksByKey = new Map<string, OutboxHooks>();
/** The page's own hooks (the My papers screens, audit CK-02): used while no verify screen is open. */
const baseHooksByKey = new Map<string, OutboxHooks>();

/** A verify screen is closing: acks go back to the page's own hooks, if it has any, instead of a screen that is gone. */
export function releaseOutboxHooks(scope: string, userId: string | undefined, hooks: OutboxHooks): void {
  const key = outboxStorageKey(scope, userId);
  const base = baseHooksByKey.get(key);
  if (hooksByKey.get(key) === hooks && base) hooksByKey.set(key, base);
}

/** The outbox for this scope and user, created on first use. `hooks` always
 *  points at the newest screen, so an ack reaches the screen that is open now.
 *  `base`: these are the page's own hooks (the list screens); they are used only while no verify screen has claimed the box. */
export function getOutbox(scope: string, userId: string | undefined, hooks: OutboxHooks, opts: { base?: boolean } = {}): Outbox {
  const key = outboxStorageKey(scope, userId);
  if (opts.base) {
    const before = baseHooksByKey.get(key);
    baseHooksByKey.set(key, hooks);
    // Only when no verify screen has claimed the box (nobody has, or the page's own earlier hooks are active).
    if (!hooksByKey.has(key) || hooksByKey.get(key) === before) hooksByKey.set(key, hooks);
  } else {
    hooksByKey.set(key, hooks);
  }
  let box = registry.get(key);
  if (!box) {
    box = createOutbox({
      storageKey: key,
      storage: browserStorage(),
      ownerId: tabOwnerId(),
      send: (entry) => sendVerdict(hooksByKey.get(key)!.api, entry),
      onAck: (entry, result) => hooksByKey.get(key)?.onAck?.(entry, (result as VerdictAndNext | undefined) ?? null),
      onReject: (entry, err) => hooksByKey.get(key)?.onReject?.(entry, err),
    });
    registry.set(key, box);
  }
  return box;
}

/** Stop and forget every outbox in this tab. Done at sign-out, so the waiting answers of the person who left are
 *  never sent under the next person's login. They stay saved under that person's own key and carry on when they
 *  sign back in. Also a test helper. */
export function resetOutboxRegistry(): void {
  registry.forEach((b) => b.dispose());
  registry.clear();
  hooksByKey.clear();
  baseHooksByKey.clear();
}
