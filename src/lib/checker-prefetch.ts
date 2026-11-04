/**
 * Warm the pictures of the next questions while the checker is still on the
 * current one (checker speed plan, 12 Oct 2026, section 2).
 *
 * Pure functions around one in-memory map, no React. The flow:
 *
 *   prefetchNext(paperId)
 *     1. peek the next questions (verifier_peek_next_in_paper: read-only, it
 *        leases nothing, so leased_at and seconds_on_question stay honest)
 *     2. drop the card already on screen (held_by_me)
 *     3. sign the snippet and page paths of the rest in ONE storage request
 *     4. preload the snippet image so it is decoded before the card swaps
 *     5. keep the result in a map keyed by question id
 *
 * The map holds at most MAX_WARM entries (oldest out first) and is emptied by
 * clearPrefetch() when the paper changes, on sign-out, or by the caller. An
 * entry is also dropped once its signed URLs are close to the 600 s expiry.
 *
 * Only paths and URLs live here. Question text is never fetched or stored, so
 * nothing about the words can drift from bank_questions / audit_questions.
 */

import { checkerPictureUrls, peekNextInPaper, type PeekedQuestion } from '@/lib/checker-api';

/** Most questions kept warm at once. */
export const MAX_WARM = 6;
/** Signed URLs live 600 s (checkerPictureUrl); stop trusting them a minute early. */
export const WARM_TTL_MS = 540_000;

export interface WarmQuestion {
  questionId: string;
  paperId: string;
  ord: number;
  snippetPath: string | null;
  snippetUrl: string | null;
  pagePath: string | null;
  pageUrl: string | null;
  /** Date.now() after which the signed URLs should be fetched again. */
  expiresAt: number;
}

export interface PrefetchDeps {
  peek: (paperId: string, count: number) => Promise<PeekedQuestion[]>;
  signMany: (paths: string[]) => Promise<Map<string, string>>;
  preload: (url: string) => Promise<void>;
  now: () => number;
}

/** Decode an image into the browser cache. Resolves (never rejects) when
 *  there is no Image (tests, server) or the load fails. */
export function preloadImage(url: string): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

const defaultDeps: PrefetchDeps = {
  peek: peekNextInPaper,
  signMany: checkerPictureUrls,
  preload: preloadImage,
  now: () => Date.now(),
};

// Insertion-ordered: the first key is the oldest.
const warm = new Map<string, WarmQuestion>();
let currentPaperId: string | null = null;
// Bumped by every clear, so a prefetch that finishes after a clear or a paper
// change drops its result instead of repopulating the map.
let generation = 0;

/** Forget everything warmed so far. Call on paper change and on sign-out. */
export function clearPrefetch(): void {
  warm.clear();
  currentPaperId = null;
  generation += 1;
}

/** How many questions are warm right now. */
export function warmCount(): number {
  return warm.size;
}

/** The warmed pictures for one question, or null (never warmed, evicted, or
 *  the signed URLs are about to expire). */
export function getWarm(questionId: string, now: number = Date.now()): WarmQuestion | null {
  const hit = warm.get(questionId);
  if (!hit) return null;
  if (now >= hit.expiresAt) {
    warm.delete(questionId);
    return null;
  }
  return hit;
}

/** Drop one question once the screen has shown it. */
export function dropWarm(questionId: string): void {
  warm.delete(questionId);
}

function remember(entry: WarmQuestion): void {
  // Re-inserting moves it to the newest slot.
  warm.delete(entry.questionId);
  warm.set(entry.questionId, entry);
  while (warm.size > MAX_WARM) {
    const oldest = warm.keys().next().value;
    if (oldest === undefined) break;
    warm.delete(oldest);
  }
}

/**
 * Peek at the next questions of `paperId` and warm their pictures. Switching
 * to a different paper than the last call clears the map first. Resolves with
 * the entries warmed by this call (already stored), and never rejects: a
 * failed prefetch just means the screen loads the picture the normal way.
 *
 * `count` is how many peeked rows to ask for (the server caps it at 3). The
 * card already on screen comes back as held_by_me and is skipped.
 */
export async function prefetchNext(
  paperId: string,
  opts: { count?: number; preloadPage?: boolean; deps?: Partial<PrefetchDeps> } = {},
): Promise<WarmQuestion[]> {
  const deps: PrefetchDeps = { ...defaultDeps, ...opts.deps };
  if (currentPaperId !== null && currentPaperId !== paperId) clearPrefetch();
  currentPaperId = paperId;
  const myGeneration = generation;

  try {
    const peeked = (await deps.peek(paperId, opts.count ?? 3)).filter((q) => !q.held_by_me);
    if (peeked.length === 0 || myGeneration !== generation) return [];

    const paths = peeked.flatMap((q) => [q.snippet_path, q.page_path]).filter((p): p is string => Boolean(p));
    const urls = paths.length ? await deps.signMany(paths) : new Map<string, string>();
    if (myGeneration !== generation) return [];

    const signedAt = deps.now();
    const entries: WarmQuestion[] = peeked.map((q) => ({
      questionId: q.id,
      paperId,
      ord: q.ord,
      snippetPath: q.snippet_path,
      snippetUrl: q.snippet_path ? urls.get(q.snippet_path) ?? null : null,
      pagePath: q.page_path,
      pageUrl: q.page_path ? urls.get(q.page_path) ?? null : null,
      expiresAt: signedAt + WARM_TTL_MS,
    }));

    await Promise.all(
      entries.flatMap((e) => [
        e.snippetUrl ? deps.preload(e.snippetUrl) : null,
        // The whole page is only shown on a tap and can be large, so it is
        // signed but not downloaded unless the caller asks for it.
        opts.preloadPage && e.pageUrl ? deps.preload(e.pageUrl) : null,
      ]),
    );
    if (myGeneration !== generation) return [];

    entries.forEach(remember);
    return entries;
  } catch {
    return [];
  }
}
