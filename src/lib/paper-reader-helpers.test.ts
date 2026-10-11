import { describe, expect, it } from 'vitest';

import { fileStateFrom, isShareDismissed, siblingNeighbours } from '@/lib/paper-reader-helpers';

// Newest first, exactly as the sibling query orders them.
const SERIES = [{ id: '2024' }, { id: '2023' }, { id: '2022' }];

describe('siblingNeighbours', () => {
  it('Previous is the older paper and Next the newer one', () => {
    expect(siblingNeighbours(SERIES, '2023')).toEqual({ previous: { id: '2022' }, next: { id: '2024' } });
  });

  it('has no Next on the newest paper and no Previous on the oldest', () => {
    expect(siblingNeighbours(SERIES, '2024')).toEqual({ previous: { id: '2023' }, next: null });
    expect(siblingNeighbours(SERIES, '2022')).toEqual({ previous: null, next: { id: '2023' } });
  });

  it('offers neither when the paper is not in the list', () => {
    expect(siblingNeighbours(SERIES, 'other')).toEqual({ previous: null, next: null });
    expect(siblingNeighbours([], undefined)).toEqual({ previous: null, next: null });
  });
});

describe('isShareDismissed', () => {
  it('treats closing the share sheet as a choice', () => {
    expect(isShareDismissed(new DOMException('cancelled', 'AbortError'))).toBe(true);
    expect(isShareDismissed({ name: 'AbortError' })).toBe(true);
  });

  it('treats every other failure as a failure', () => {
    expect(isShareDismissed(new DOMException('no', 'NotAllowedError'))).toBe(false);
    expect(isShareDismissed(new TypeError('x'))).toBe(false);
    expect(isShareDismissed(null)).toBe(false);
    expect(isShareDismissed(undefined)).toBe(false);
    expect(isShareDismissed('AbortError')).toBe(false);
  });
});

describe('fileStateFrom', () => {
  it('is loading until the request answers', () => {
    expect(fileStateFrom(null)).toBe('loading');
  });

  it('is missing only when the server answered with no file', () => {
    expect(fileStateFrom({ data: null, error: null })).toBe('missing');
    expect(fileStateFrom({ data: '', error: null })).toBe('missing');
  });

  it('is ready with an address', () => {
    expect(fileStateFrom({ data: 'https://x/y.pdf', error: null })).toBe('ready');
  });

  it('a failed request is an error, never "not uploaded"', () => {
    expect(fileStateFrom({ data: null, error: new Error('network') })).toBe('error');
  });
});
