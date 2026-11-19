import { describe, it, expect } from 'vitest';
import { buildBankURLs, dedupeByLoc, type BankPaperRow } from './sitemap-bank-urls';
import { EXCLUDED_PAPER_IDS } from './excluded-papers';

const CURRENT_DATE = '2026-09-21';

function row(overrides: Partial<BankPaperRow> & { id: string }): BankPaperRow {
  return {
    school: 'Test School',
    has_school: true,
    created_at: '2026-01-15T00:00:00Z',
    ...overrides,
  };
}

describe('buildBankURLs', () => {
  it('emits exactly one paper URL per row, none dropped or duplicated', () => {
    const rows = [row({ id: 'p1' }), row({ id: 'p2' }), row({ id: 'p3' })];
    const { papers } = buildBankURLs(rows, CURRENT_DATE);
    expect(papers.map((p) => p.loc).sort()).toEqual(['/past-papers/p1', '/past-papers/p2', '/past-papers/p3']);
  });

  it('excludes papers on the placeholder-text exclusion list, and reports how many', () => {
    const excludedId = [...EXCLUDED_PAPER_IDS][0];
    const rows = [row({ id: excludedId }), row({ id: 'kept-1' })];
    const { papers, skipped } = buildBankURLs(rows, CURRENT_DATE);
    expect(papers.map((p) => p.loc)).toEqual(['/past-papers/kept-1']);
    expect(skipped).toBe(1);
  });

  it('collapses two papers with the same school into one school URL', () => {
    const rows = [
      row({ id: 'p1', school: 'La Martiniere for Girls' }),
      row({ id: 'p2', school: 'La Martiniere for Girls' }),
    ];
    const { schools } = buildBankURLs(rows, CURRENT_DATE);
    expect(schools).toHaveLength(1);
  });

  it('collapses an "&" spelling and its "and" spelling into one slug, via schoolSlug', () => {
    const rows = [
      row({ id: 'p1', school: 'St. Xavier\'s & Co School' }),
      row({ id: 'p2', school: 'St. Xavier\'s and Co School' }),
    ];
    const { schools } = buildBankURLs(rows, CURRENT_DATE);
    expect(schools).toHaveLength(1);
  });

  it('gives every distinct school its own URL', () => {
    const rows = [
      row({ id: 'p1', school: 'School A' }),
      row({ id: 'p2', school: 'School B' }),
      row({ id: 'p3', school: 'School C' }),
    ];
    const { schools } = buildBankURLs(rows, CURRENT_DATE);
    expect(schools).toHaveLength(3);
  });

  it('never produces a school hub for a paper with has_school false', () => {
    const rows = [row({ id: 'p1', has_school: false, school: '' })];
    const { schools, papers } = buildBankURLs(rows, CURRENT_DATE);
    expect(schools).toHaveLength(0);
    expect(papers).toHaveLength(1);
  });

  it('a school with only excluded papers drops out instead of getting an empty hub', () => {
    const excludedId = [...EXCLUDED_PAPER_IDS][0];
    const rows = [row({ id: excludedId, school: 'Only Excluded School' })];
    const { schools, papers } = buildBankURLs(rows, CURRENT_DATE);
    expect(schools).toHaveLength(0);
    expect(papers).toHaveLength(0);
  });

  it('dates a school hub by its newest paper, not the current date', () => {
    const rows = [
      row({ id: 'p1', school: 'School A', created_at: '2024-01-01T00:00:00Z' }),
      row({ id: 'p2', school: 'School A', created_at: '2026-06-15T00:00:00Z' }),
    ];
    const { schools } = buildBankURLs(rows, CURRENT_DATE);
    expect(schools[0].lastmod).toBe('2026-06-15');
  });

  it('falls back to the current date when a paper has no created_at', () => {
    const rows = [row({ id: 'p1', created_at: null })];
    const { papers } = buildBankURLs(rows, CURRENT_DATE);
    expect(papers[0].lastmod).toBe(CURRENT_DATE);
  });

  it('returns empty arrays for an empty input, not an error', () => {
    expect(buildBankURLs([], CURRENT_DATE)).toEqual({ schools: [], papers: [], skipped: 0 });
  });
});

describe('dedupeByLoc', () => {
  it('keeps the first occurrence of a repeated loc and drops the rest', () => {
    const urls = [
      { loc: '/a', lastmod: '2026-01-01', changefreq: 'weekly' as const, priority: 0.5 },
      { loc: '/a', lastmod: '2026-02-01', changefreq: 'weekly' as const, priority: 0.9 },
      { loc: '/b', lastmod: '2026-01-01', changefreq: 'weekly' as const, priority: 0.5 },
    ];
    const result = dedupeByLoc(urls);
    expect(result).toHaveLength(2);
    expect(result[0].lastmod).toBe('2026-01-01');
  });
});
