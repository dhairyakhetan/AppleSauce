import { describe, it, expect } from 'vitest';
import { extractLeakNeedles, findLeak } from './prerender-leak-check';

describe('extractLeakNeedles', () => {
  it('takes the first 8 words of each body', () => {
    const body = 'Find the value of x if two plus two equals four and five';
    const [needle] = extractLeakNeedles([body]);
    expect(needle).toBe('Find the value of x if two plus');
  });

  it('drops bodies whose 8-word prefix is 30 chars or shorter', () => {
    expect(extractLeakNeedles(['Short question here'])).toEqual([]);
  });

  it('drops empty and whitespace-only bodies without throwing', () => {
    expect(extractLeakNeedles(['', '   ', undefined as unknown as string])).toEqual([]);
  });

  it('collapses internal whitespace before measuring length', () => {
    const body = 'Word1   word2\n\nword3\tword4 word5 word6 word7 word8 word9';
    const [needle] = extractLeakNeedles([body]);
    expect(needle).toBe('Word1 word2 word3 word4 word5 word6 word7 word8');
  });
});

describe('findLeak', () => {
  const needles = ['a distinctive run of eight words exactly'];

  it('returns null when no file contains any needle', () => {
    const files = [
      { path: '/dist/a/index.html', html: '<html>nothing interesting here</html>' },
      { path: '/dist/b/index.html', html: '<html>also nothing</html>' },
    ];
    expect(findLeak(needles, files)).toBeNull();
  });

  it('reports the exact file and needle that leaked', () => {
    const files = [
      { path: '/dist/a/index.html', html: '<html>clean</html>' },
      { path: '/dist/b/index.html', html: '<html>a distinctive run of eight words exactly here</html>' },
    ];
    expect(findLeak(needles, files)).toEqual({
      path: '/dist/b/index.html',
      needle: 'a distinctive run of eight words exactly',
    });
  });

  it('checks every file, not just the first', () => {
    const files = [
      { path: '/dist/a/index.html', html: '<html>clean</html>' },
      { path: '/dist/b/index.html', html: '<html>clean too</html>' },
      { path: '/dist/c/index.html', html: '<html>a distinctive run of eight words exactly here</html>' },
    ];
    expect(findLeak(needles, files)?.path).toBe('/dist/c/index.html');
  });

  it('returns null for an empty needle list', () => {
    const files = [{ path: '/dist/a/index.html', html: 'anything at all' }];
    expect(findLeak([], files)).toBeNull();
  });
});
