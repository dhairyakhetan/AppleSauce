/**
 * Signed picture links, asked for early (checker speed plan, 12 Oct 2026).
 *
 * The verify screen used to ask for a picture link only after the question's
 * context had come back, which is a second round trip in a row. Now, the
 * moment the next question's row arrives, `primePicture` starts signing the
 * picture that question will almost always show (or takes the link
 * prefetchNext already signed), and `cachedPictureUrl` hands that same answer
 * to useSignedUrl. If the screen then plans a different picture (a sub-part
 * that shows its parent's crop) it simply asks for that one as before.
 *
 * Only links live here, never question text. A link is trusted for
 * LINK_TTL_MS (signed links last 600 s). A failed signing is not kept.
 */

import type { CheckerApi } from '@/lib/checker-api';
import { getWarm } from '@/lib/checker-prefetch';
import { planCheckerPicture } from '@/lib/checker-pictures';

export const LINK_TTL_MS = 540_000;
const MAX_LINKS = 24;

interface Link {
  promise: Promise<string | null>;
  at: number;
}

const links = new Map<string, Link>();

export function clearPictureCache(): void {
  links.clear();
}

export function pictureCacheSize(): number {
  return links.size;
}

function keep(path: string, promise: Promise<string | null>, now: number): Promise<string | null> {
  links.delete(path);
  links.set(path, { promise, at: now });
  while (links.size > MAX_LINKS) {
    const oldest = links.keys().next().value;
    if (oldest === undefined) break;
    links.delete(oldest);
  }
  // A failed signing is not worth remembering: ask again next time.
  promise.then(
    (url) => {
      if (url === null && links.get(path)?.promise === promise) links.delete(path);
    },
    () => {
      if (links.get(path)?.promise === promise) links.delete(path);
    },
  );
  return promise;
}

/** The link for one picture path: the early one when there is one, else a fresh one. */
export function cachedPictureUrl(
  api: Pick<CheckerApi, 'pictureUrl'>,
  path: string,
  now: number = Date.now(),
): Promise<string | null> {
  const hit = links.get(path);
  if (hit && now - hit.at < LINK_TTL_MS) return hit.promise;
  return keep(path, api.pictureUrl(path), now);
}

/**
 * Start the picture of a question that has just arrived. `ctx` is unknown at
 * this point, so the picture is the one planCheckerPicture picks without a
 * context (the question's own crop, or its whole-question crop).
 */
export function primePicture(
  api: Pick<CheckerApi, 'pictureUrl'>,
  question: { id: string; source: Record<string, unknown> | null | undefined },
  now: number = Date.now(),
): void {
  const path = planCheckerPicture(question, null)?.path;
  if (!path) return;
  const hit = links.get(path);
  if (hit && now - hit.at < LINK_TTL_MS) return;
  const warm = getWarm(question.id, now);
  if (warm?.snippetUrl && warm.snippetPath === path) {
    keep(path, Promise.resolve(warm.snippetUrl), now);
    return;
  }
  keep(path, api.pictureUrl(path), now);
}

/** An api whose pictureUrl goes through the early links. */
export function withPictureCache<T extends Pick<CheckerApi, 'pictureUrl'>>(api: T): T {
  return { ...api, pictureUrl: (path: string) => cachedPictureUrl(api, path) };
}
