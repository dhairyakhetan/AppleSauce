import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The helper under test is pure, but its module imports the Supabase client,
// which needs a browser localStorage. The client is not used here.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { countListedTeachers } from './listed-teachers';

/* 2026-10-12: the header said 147, the trust strip 147, the filter sheet 148
   and the home page and About 148. One teacher had paused their listing. A
   paused teacher stays in teachers_list, so a plain row count over-reports,
   while Browse drops paused rows from every list it shows. */
describe('countListedTeachers', () => {
  const slugs = Array.from({ length: 148 }, (_, i) => `teacher-${i}`);

  it('subtracts a paused teacher: 148 rows, one paused, 147 listed', () => {
    expect(countListedTeachers(slugs, new Set(['teacher-7']))).toBe(147);
  });

  it('counts everyone when nobody is paused', () => {
    expect(countListedTeachers(slugs, new Set())).toBe(148);
  });

  it('ignores a paused slug that has no teachers_list row', () => {
    expect(countListedTeachers(slugs, new Set(['not-in-listing']))).toBe(148);
  });

  it('keeps a row with no slug, since it cannot be paused (as Browse keeps it)', () => {
    expect(countListedTeachers([null, 'a'], new Set(['a']))).toBe(1);
  });
});

/* Every headline teacher figure must read the one shared total. A surface that
   runs its own teachers_list count reintroduces the 148 against 147 split. */
describe('teacher headline figures share one source', () => {
  const SURFACES = [
    'src/pages/Index.tsx',
    'src/pages/About.tsx',
    'src/components/OnboardingModal.tsx',
    'src/pages/Browse.tsx',
    'src/components/Navbar.tsx',
    'src/components/Footer.tsx',
    'src/components/ProductTour.tsx',
  ];

  for (const file of SURFACES) {
    it(`${file} takes the teacher total from useSiteCounts`, () => {
      const src = readFileSync(resolve(__dirname, '../..', file), 'utf8');
      expect(src).toMatch(/from ['"]@\/hooks\/useSiteCounts['"]/);
      expect(src).toMatch(/useSiteCounts\(\)/);
    });
  }

  it('useSiteCounts takes teachers from the listed count, not the raw RPC column', () => {
    const src = readFileSync(resolve(__dirname, '../hooks/useSiteCounts.ts'), 'utf8');
    expect(src).toContain('fetchListedTeacherCount()');
    expect(src).not.toMatch(/teachers:\s*teachers\.count/);
  });

  it('Browse filter-sheet pool drops paused listings, matching its list', () => {
    const src = readFileSync(resolve(__dirname, '../pages/Browse.tsx'), 'utf8');
    expect(src).toContain("select(SHIKSHAQ_COLUMNS + ', is_paused')");
    expect(src).toContain('.filter((r) => !r.is_paused)');
  });
});
