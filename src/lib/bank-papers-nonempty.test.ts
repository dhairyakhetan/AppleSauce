import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/* Owner, 2026-09-28: papers with no questions are never shown. Every public
   read of bank_papers that filters is_published must also filter
   question_count > 0, or an empty paper reappears in the library, the
   counts, the sitemap or the prerendered pages. */
const FILES = [
  'src/lib/question-bank.ts',
  'src/hooks/useSiteCounts.ts',
  'src/pages/Index.tsx',
  'src/pages/About.tsx',
  'src/pages/BankPaper.tsx',
  'scripts/prerender.ts',
  'scripts/generate-sitemap.ts',
];

describe('public bank_papers reads skip empty papers', () => {
  for (const file of FILES) {
    it(file, () => {
      const src = readFileSync(resolve(__dirname, '../..', file), 'utf8');
      // Each bank_papers query up to its is_published filter.
      const queries = src.match(/from\(['"]bank_papers['"]\)[\s\S]{0,200}?\.eq\('is_published', true\)[^\n]*/g) ?? [];
      expect(queries.length).toBeGreaterThan(0);
      for (const q of queries) expect(q).toContain(".gt('question_count', 0)");
    });
  }
});
