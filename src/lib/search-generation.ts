/**
 * Which search a late response belongs to.
 *
 * A results page fetches a first page whenever the filters change and further
 * pages as the reader scrolls. A next-page request that is still in flight when
 * the filters change comes back after the list has already been reset to the
 * new search; appending it would put the OLD search's rows under the NEW
 * heading and count, and advancing the page counter would skip a page of the
 * new results. Each request takes a token when it starts and checks it when it
 * lands; changing the search invalidates every token taken before.
 */
export interface SearchGeneration {
  /** A new search has begun: every earlier token is now stale. Returns the new token. */
  begin(): number;
  /** The token for the search that is on screen now. */
  current(): number;
  /** True while `token` still belongs to the search on screen. */
  isCurrent(token: number): boolean;
}

export function createSearchGeneration(): SearchGeneration {
  let n = 0;
  return {
    begin: () => ++n,
    current: () => n,
    isCurrent: (token) => token === n,
  };
}
