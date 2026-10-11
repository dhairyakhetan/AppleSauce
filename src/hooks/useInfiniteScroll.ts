import { useCallback, useRef } from 'react';

/* One sentinel, watched with IntersectionObserver, instead of a "Load more"
   button someone has to find and tap. rootMargin extends the trigger zone
   past the real viewport edge so the next page starts fetching while the
   reader is still a beat away from the bottom, not after they have already
   hit it and are staring at a blank strip.

   A CALLBACK ref, not useRef + useEffect. The first version used a plain ref
   and re-created the observer in a useEffect keyed on [hasMore, rootMargin] —
   which missed real remounts of the sentinel element. Browse.tsx's results
   list swaps between loading/empty/populated branches (e.g.
   displayedTeachers briefly resets to 0 mid-refetch, unmounting the sentinel
   entirely, then remounts a brand new <div> once data lands), and none of
   that changes hasMore's VALUE, so the effect never re-ran and the observer
   stayed attached to a node that no longer existed. A callback ref fires on
   every attach/detach of the actual DOM node AND whenever the ref function's
   own identity changes (which useCallback's dependency array still gives us
   for hasMore/rootMargin), so it covers both cases the effect-based version
   silently missed.

   onLoadMore/loading are read through a ref rather than the callback's own
   dependency array, so a caller passing a fresh arrow function every render
   (the common case — no useCallback required) does not tear the observer
   down and rebuild it on every render. Only hasMore/rootMargin actually
   change the thing being observed. */
export function useInfiniteScroll(options: {
  /** Nothing left to fetch — stop observing rather than firing loadMore into
   *  a page that has no next page. */
  hasMore: boolean;
  /** A fetch is already in flight — the observer stays mounted (the reader
   *  may still be sitting right at the sentinel) but must not fire again
   *  until this clears, or a slow request gets requested a second time. */
  loading: boolean;
  onLoadMore: () => void;
  rootMargin?: string;
}) {
  const { hasMore, rootMargin = '600px 0px' } = options;
  const latest = useRef(options);
  latest.current = options;
  const observerRef = useRef<IntersectionObserver | null>(null);

  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node || !hasMore) return;
      if (typeof IntersectionObserver === 'undefined') return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting && !latest.current.loading) {
            latest.current.onLoadMore();
          }
        },
        { rootMargin },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasMore, rootMargin],
  );

  return sentinelRef;
}
