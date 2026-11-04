import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/* Browse, past papers view: page 1 (fetchPapers) and every later page (loadMorePapers) must apply the
   same filters, or scrolling shows papers the visitor filtered out (CONTEXT.md known issue 19, fixed
   2 Nov 2026: the later pages had skipped schools and exam types). */

const src = readFileSync(resolve(__dirname, './Browse.tsx'), 'utf8');

function slice(from: string, to: string): string {
  const a = src.indexOf(from);
  expect(a, from).toBeGreaterThan(-1);
  const b = src.indexOf(to, a);
  expect(b, to).toBeGreaterThan(a);
  return src.slice(a, b);
}

const firstPage = slice('async function fetchPapers', 'fetchPapers();');
const laterPages = slice('const loadMorePapers = useCallback', 'const papersInfiniteScrollRef');

describe('papers filters on page 1 and on later pages', () => {
  for (const [what, needle] of [
    ['subjects', "query.in('subject', filters.subjects)"],
    ['classes', "query.in('class', filters.classes)"],
    ['boards', "query.in('board', filters.boards)"],
    ['schools', "query.in('school', rawSchoolFilters)"],
    ['exam types', "query.in('exam_type', filters.examTypes)"],
  ] as const) {
    it(`${what}: the same filter is applied on both`, () => {
      expect(firstPage, `page 1 ${what}`).toContain(needle);
      expect(laterPages, `later pages ${what}`).toContain(needle);
    });
  }

  it('later pages expand a school label to every raw school value, as page 1 does', () => {
    expect(laterPages).toContain('filters.schools.flatMap((label) => rawSchoolsFor(label))');
  });

  it('loading more is rebuilt when the school or exam type filter changes', () => {
    expect(laterPages).toContain("filters.schools.join(','), filters.examTypes.join(',')]");
  });
});
