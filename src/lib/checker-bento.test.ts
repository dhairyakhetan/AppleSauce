import { describe, expect, it } from 'vitest';
import { nearestPaneIndex, stepTile, tileForNextQuestion, TILE_ORDER } from '@/lib/checker-bento';

describe('which tile a phone shows for the next question', () => {
  it('keeps Question and Page, so flipping through pages stays on the page', () => {
    expect(tileForNextQuestion('typed')).toBe('typed');
    expect(tileForNextQuestion('printed')).toBe('printed');
  });

  it('sends Fix back to the words, so a new question never opens in the middle of an edit', () => {
    expect(tileForNextQuestion('fix')).toBe('typed');
  });
});

describe('where a swipe came to rest', () => {
  const lefts = [0, 351, 702];
  it('picks the tile whose edge is nearest', () => {
    expect(nearestPaneIndex(lefts, 0)).toBe(0);
    expect(nearestPaneIndex(lefts, 150)).toBe(0);
    expect(nearestPaneIndex(lefts, 200)).toBe(1);
    expect(nearestPaneIndex(lefts, 351)).toBe(1);
    expect(nearestPaneIndex(lefts, 600)).toBe(2);
    expect(nearestPaneIndex(lefts, 9999)).toBe(2);
  });

  it('copes with one tile and with none', () => {
    expect(nearestPaneIndex([0], 40)).toBe(0);
    expect(nearestPaneIndex([], 40)).toBe(0);
  });
});

describe('arrow keys on the phone tabs', () => {
  it('goes round the three tabs in order and wraps', () => {
    expect(TILE_ORDER).toEqual(['typed', 'printed', 'fix']);
    expect(stepTile(TILE_ORDER, 'typed', 1)).toBe('printed');
    expect(stepTile(TILE_ORDER, 'fix', 1)).toBe('typed');
    expect(stepTile(TILE_ORDER, 'typed', -1)).toBe('fix');
  });

  it('still toggles between two tabs, as the practice round has', () => {
    expect(stepTile(['typed', 'printed'], 'typed', 1)).toBe('printed');
    expect(stepTile(['typed', 'printed'], 'printed', 1)).toBe('typed');
  });
});
