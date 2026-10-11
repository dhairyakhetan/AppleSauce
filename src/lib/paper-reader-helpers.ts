/**
 * Small pure rules from the paper reader, kept out of the page so they can be
 * tested without mounting a PDF viewer.
 */

export interface SiblingRef {
  id: string;
}

/**
 * Previous / next within a series. `siblings` arrives newest year first (the
 * query orders year descending), so reading "forward" through a series means
 * walking to a NEWER paper and "previous" means the OLDER one. The buttons
 * used to take the neighbours the other way round, so "Previous" led to the
 * later year.
 */
export function siblingNeighbours<T extends SiblingRef>(
  siblings: T[],
  currentId: string | undefined,
): { previous: T | null; next: T | null } {
  const i = siblings.findIndex((s) => s.id === currentId);
  if (i < 0) return { previous: null, next: null };
  return {
    previous: i < siblings.length - 1 ? siblings[i + 1] : null,
    next: i > 0 ? siblings[i - 1] : null,
  };
}

/** The user dismissing the native share sheet is a choice, not a failure.
 *  navigator.share rejects with AbortError when they do. */
export function isShareDismissed(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

/** Where the paper's PDF address is in its life. `missing` is only ever the
 *  server saying there is no file; a request still in flight is `loading` and
 *  one that failed is `error`, so neither is allowed to read as "not uploaded". */
export type FileState = 'loading' | 'ready' | 'missing' | 'error';

export function fileStateFrom(result: { data: string | null; error: unknown } | null): FileState {
  if (!result) return 'loading';
  if (result.error) return 'error';
  return result.data ? 'ready' : 'missing';
}
