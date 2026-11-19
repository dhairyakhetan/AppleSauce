import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHELF_LIMIT, orderLatest, publishTime, type ShelfEntry } from '@/lib/latest-papers';

/* The "Latest papers" shelf follows PUBLISH time, not exam year (owner, 13 Nov
   2026: "this area doesn't reflect papers I publish actively from the HOD
   desk"). A 2024 paper published today must outrank 2026 papers published weeks
   ago. */

const paper = (id: string, created_at: string, year: number): ShelfEntry => ({ id, created_at, year });

describe('publishTime', () => {
  it('reads an ISO timestamp', () => {
    expect(publishTime('2026-11-13T04:00:59+00:00')).toBe(Date.parse('2026-11-13T04:00:59+00:00'));
  });
  it('treats missing or unreadable as 0 (oldest)', () => {
    expect(publishTime('')).toBe(0);
    expect(publishTime(undefined)).toBe(0);
    expect(publishTime(null)).toBe(0);
    expect(publishTime('not a date')).toBe(0);
  });
});

describe('orderLatest', () => {
  it('puts a paper published today first even when its exam year is older (the owner’s case)', () => {
    const today = paper('d04fbe', '2026-11-13T04:00:00+00:00', 2024);
    const older2026 = paper('b392ed', '2026-10-02T09:00:00+00:00', 2026);
    const oldest2026 = paper('e99799', '2026-09-25T09:00:00+00:00', 2026);
    expect(orderLatest([oldest2026, older2026, today]).map((p) => p.id)).toEqual(['d04fbe', 'b392ed', 'e99799']);
  });

  it('breaks a tie (one batch, one timestamp) by exam year, newer first, then by id', () => {
    const t = '2026-09-25T09:00:00+00:00';
    const out = orderLatest([paper('b', t, 2025), paper('a', t, 2025), paper('c', t, 2026)]);
    expect(out.map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('puts papers with no publish time after every timestamped paper', () => {
    const out = orderLatest([paper('old', '', 2026), paper('new', '2020-01-01T00:00:00+00:00', 2010)]);
    expect(out.map((p) => p.id)).toEqual(['new', 'old']);
  });

  it('keeps a paper that is in more than one list once, from the earliest list given', () => {
    const fresh = paper('x', '2026-11-13T04:00:00+00:00', 2024);
    const stale = paper('x', '', 2024);
    const out = orderLatest([fresh], [stale, paper('y', '2026-10-01T00:00:00+00:00', 2026)]);
    expect(out.map((p) => p.id)).toEqual(['x', 'y']);
    expect(out[0]).toBe(fresh);
  });

  it('never mutates its inputs', () => {
    const a = [paper('a', '2026-01-01T00:00:00+00:00', 2020), paper('b', '2026-02-01T00:00:00+00:00', 2020)];
    const copy = [...a];
    orderLatest(a);
    expect(a).toEqual(copy);
  });

  it('accepts no lists and empty lists', () => {
    expect(orderLatest()).toEqual([]);
    expect(orderLatest([], [])).toEqual([]);
  });

  it('the shelf holds twelve', () => {
    expect(SHELF_LIMIT).toBe(12);
  });
});

/* Source-level wiring guards (the repo's tests run in node, not a browser). */
const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
const noComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('the past papers page is wired to publish time', () => {
  const page = noComments(read('../pages/PastPapers.tsx'));
  const bank = noComments(read('./question-bank.ts'));

  it('no longer orders the shelf by exam year alone', () => {
    expect(page).not.toContain('(b.year || 0) - (a.year || 0)');
    expect(page).toContain('orderLatest<Paper>(latestQuery.data ?? [], bankPapers');
  });

  it('reads the newest published papers fresh, with a short cache and a refetch on focus', () => {
    expect(page).toContain("queryKey: ['past-papers', 'latest']");
    expect(page).toContain('staleTime: 60 * 1000');
    expect(page).toContain('refetchOnWindowFocus: true');
    expect(page).toContain('fetchLatestPublishedPapers(SHELF_LIMIT)');
  });

  it('carries the publish time onto the shelf rows instead of an empty string', () => {
    expect(page).toContain("created_at: b.addedAt ?? ''");
    expect(page).not.toMatch(/created_at: '',\s*_bankYear/);
  });

  it('the fresh read asks for published papers with questions, newest publish first, and limits itself', () => {
    const fn = bank.slice(bank.indexOf('export async function fetchLatestPublishedPapers'));
    expect(fn).toContain(".eq('is_published', true)");
    expect(fn).toContain(".gt('question_count', 0)");
    expect(fn).toContain(".order('created_at', { ascending: false })");
    expect(fn).toContain('.limit(limit)');
  });

  it('asks for created_at, which signed-out visitors may read, and keeps the session-wide index as it was', () => {
    expect(bank).toMatch(/const PAPER_COLUMNS =\s*'[^']*created_at'/);
    expect(bank).toContain('let indexCache: Promise<BankPaper[]> | null = null;');
  });
});
