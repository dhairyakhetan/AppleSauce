import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  countPaperRows,
  countReadableSchools,
  countPapers,
  isComingSoon,
  isListedRow,
  isReadableRow,
  paperCountLabel,
} from './readable-papers';

/* Owner, 12 October 2026: the public paper count is READABLE papers only.
   Listed papers that are under review stay in the library as "Coming soon"
   and are not a total. This file pins the one definition and then proves no
   other file keeps its own. */

const ROOT = resolve(__dirname, '../..');

describe('the readable-paper definition', () => {
  it('treats needs_review as Coming soon, under either spelling the site uses', () => {
    expect(isComingSoon({ needsReview: true })).toBe(true);
    expect(isComingSoon({ _needsReview: true })).toBe(true);
    expect(isComingSoon({ needsReview: false })).toBe(false);
    expect(isComingSoon({})).toBe(false);
    expect(isComingSoon({ needsReview: null })).toBe(false);
  });

  it('lists published papers with questions, and reads those that are not under review', () => {
    const rows = [
      { is_published: true, question_count: 12, needs_review: false },
      { is_published: true, question_count: 12, needs_review: true },
      { is_published: true, question_count: 0, needs_review: false },
      { is_published: false, question_count: 12, needs_review: false },
    ];
    expect(rows.map(isListedRow)).toEqual([true, true, false, false]);
    expect(rows.map(isReadableRow)).toEqual([true, false, false, false]);
  });

  it('counts the 616 + 6 split the owner decided on', () => {
    const rows = [
      ...Array.from({ length: 616 }, () => ({ is_published: true, question_count: 9, needs_review: false })),
      ...Array.from({ length: 6 }, () => ({ is_published: true, question_count: 9, needs_review: true })),
      { is_published: true, question_count: 0, needs_review: false },
      { is_published: false, question_count: 9, needs_review: false },
    ];
    expect(countPaperRows(rows)).toEqual({ ready: 616, comingSoon: 6, listed: 622 });
    const cards = rows.filter(isListedRow).map((r) => ({ needsReview: r.needs_review }));
    expect(countPapers(cards)).toEqual({ ready: 616, comingSoon: 6, listed: 622 });
  });

  it('counts a school only when it has a readable paper', () => {
    const row = (school: string, needs_review: boolean, extra = {}) =>
      ({ school, has_school: true, is_published: true, question_count: 5, needs_review, ...extra });
    const rows = [
      row('A School', false),
      row('A School', true),
      row('B School', true), // only Coming soon: keeps its page, not counted
      row('C School', false),
      row('ICSE Board', false, { has_school: false }), // a board paper, not a school
      row('  ', false), // blank
      row('D School', false, { question_count: 0 }), // empty paper
    ];
    expect(countReadableSchools(rows)).toBe(2);
  });

  it('words the library heading as ready and coming soon', () => {
    expect(paperCountLabel(616, 6)).toBe('616 papers ready, 6 coming soon');
    expect(paperCountLabel(1, 2)).toBe('1 paper ready, 2 coming soon');
    expect(paperCountLabel(40, 0)).toBe('40 papers ready');
    expect(paperCountLabel(0, 3)).toBe('0 papers ready, 3 coming soon');
  });
});

describe('site_counts() in SQL states the same rule', () => {
  const schoolsMigration = readFileSync(
    join(ROOT, 'supabase/migrations/20261012981000_site_counts_readable_schools.sql'),
    'utf8',
  );
  const schoolsCode = schoolsMigration
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

  it('counts only schools that have a readable paper, with the same grants', () => {
    expect(schoolsCode).toMatch(
      /count\(distinct school\) from public\.bank_papers\s+where is_published and question_count > 0 and not needs_review\s+and has_school and school is not null and btrim\(school\) <> ''/,
    );
    expect(schoolsCode).toContain('returns table(teachers bigint, papers bigint, schools bigint)');
    expect(schoolsCode).toContain('security definer');
    expect(schoolsCode).toContain('grant execute on function public.site_counts() to anon, authenticated;');
    expect(schoolsCode).toContain('revoke all on function public.site_counts() from public;');
    // The papers line from the previous migration is carried over unchanged.
    expect(schoolsCode).toMatch(/from public\.bank_papers\s+where is_published and question_count > 0 and not needs_review\),/);
  });

  const migration = readFileSync(
    join(ROOT, 'supabase/migrations/20261012980000_site_counts_readable_papers.sql'),
    'utf8',
  );
  const code = migration.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  it('counts papers that are published, non-empty and not under review', () => {
    expect(code).toMatch(/from public\.bank_papers\s+where is_published and question_count > 0 and not needs_review/);
  });

  it('keeps the signature, the definer setup and the grants', () => {
    expect(code).toContain('returns table(teachers bigint, papers bigint, schools bigint)');
    expect(code).toContain('security definer');
    expect(code).toContain("set search_path to 'public'");
    expect(code).toContain('revoke all on function public.site_counts() from public;');
    expect(code).toContain('grant execute on function public.site_counts() to anon, authenticated;');
  });
});

/* ---------------------------------------------------------------------------
   Source scan: one module owns the paper total.
--------------------------------------------------------------------------- */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const SOURCES = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))]
  .map((f) => ({ file: relative(ROOT, f).split(sep).join('/'), full: f }))
  .filter(({ file }) =>
    !/\.test\.tsx?$/.test(file)
    && !/\.generated\.ts$/.test(file)
    && !file.endsWith('src/content/figure-dimensions.ts')
    && !file.startsWith('src/dummy/')
    && file !== 'src/integrations/supabase/types.ts',
  );

describe('no file keeps its own paper total', () => {
  it('scans a real set of files', () => {
    expect(SOURCES.length).toBeGreaterThan(100);
  });

  it('hard-codes neither the old total (622) nor the new one (616)', () => {
    const offenders = SOURCES.filter(({ full }) => /(?<![\d,.])(622|616)(?![\d,.])/.test(readFileSync(full, 'utf8')))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('counts bank_papers rows only inside lib/readable-papers.ts', () => {
    /* A head-only count straight off bank_papers is a paper total. The
       import tool's own post-load report (scripts/import-bank.ts) is not a
       public figure. */
    const ALLOWED = new Set(['src/lib/readable-papers.ts', 'scripts/import-bank.ts']);
    const offenders = SOURCES.filter(({ file, full }) => {
      if (ALLOWED.has(file)) return false;
      const src = readFileSync(full, 'utf8');
      return /from\(['"]bank_papers['"]\)[\s\S]{0,300}?count:\s*['"](exact|planned|estimated)['"]/.test(src);
    }).map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('does not total a school paper count with a bare .length in the school pages', () => {
    const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
    // The school page and the prerendered hubs state counts from the split, not list length.
    expect(read('src/pages/SchoolPage.tsx')).not.toMatch(/`\$\{papers\.length\} (past )?paper/);
    expect(read('scripts/prerender.ts')).not.toMatch(/\$\{(esc\()?list\.length\)?\} (past )?(question )?papers/);
    expect(read('scripts/prerender.ts')).not.toMatch(/esc\(schools\.length\)/);
  });

  it('reads the site_counts() papers column only through useSiteCounts', () => {
    const offenders = SOURCES.filter(({ file, full }) => {
      if (file === 'src/hooks/useSiteCounts.ts') return false;
      return /\.rpc\(\s*['"]site_counts['"]/.test(readFileSync(full, 'utf8'));
    }).map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('keeps Home, About and the library headline on the shared hook or module', () => {
    const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
    expect(read('src/pages/Index.tsx')).toContain('siteCounts.data?.papers');
    expect(read('src/pages/About.tsx')).toContain('siteCounts?.papers');
    expect(read('src/pages/PastPapers.tsx')).toContain("from '@/lib/readable-papers'");
    expect(read('src/pages/PaperResults.tsx')).toContain('paperCountLabel');
    expect(read('src/hooks/useSiteCounts.ts')).toContain('readablePapersCountQuery');
    expect(read('scripts/prerender.ts')).toContain("from '../src/lib/readable-papers'");
    expect(read('scripts/generate-sitemap.ts')).toContain("from '../src/lib/readable-papers'");
    expect(read('src/pages/SchoolPage.tsx')).toContain("from '@/lib/readable-papers'");
    expect(read('src/pages/SchoolsPage.tsx')).toContain("from '@/lib/readable-papers'");
    expect(read('src/hooks/useSiteCounts.ts')).toContain('fetchBankSchoolValues(true, true)');
  });
});
