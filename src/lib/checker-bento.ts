/* Small rules of the verify screen's bento layout (12 Oct 2026), kept as plain
   functions so they are tested without a browser. */

export type TileId = 'typed' | 'printed' | 'fix';

/** The order of the phone's tiles, left to right: Question, Page, Fix. */
export const TILE_ORDER: TileId[] = ['typed', 'printed', 'fix'];

/** From this width the tiles sit side by side on one screen; below it they are swiped. */
export const BENTO_MIN_WIDTH = 768;

/**
 * Which tile a phone shows when the next question swipes in. The tile you were
 * on stays (the owner asked for it), except Fix: that belongs to the question
 * you were fixing, so a new question opens on the words instead of in the
 * middle of an edit.
 */
export function tileForNextQuestion(current: TileId): TileId {
  return current === 'fix' ? 'typed' : current;
}

/** The index of the tile whose left edge is nearest the scroll position (where a swipe came to rest). */
export function nearestPaneIndex(paneLefts: readonly number[], scrollLeft: number): number {
  let best = 0;
  for (let i = 1; i < paneLefts.length; i++) {
    if (Math.abs(paneLefts[i] - scrollLeft) < Math.abs(paneLefts[best] - scrollLeft)) best = i;
  }
  return best;
}

/** The next or previous tab for an arrow key, wrapping round the ends. */
export function stepTile(order: readonly TileId[], current: TileId, step: 1 | -1): TileId {
  const i = Math.max(0, order.indexOf(current));
  return order[(i + step + order.length) % order.length];
}
