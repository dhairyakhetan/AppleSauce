import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { PaperQueueRow } from './checker-api';
import {
  PAPER_FILTERS,
  filterCounts,
  filterPapers,
  mergeQueueRows,
  normaliseQueueRow,
  sortForReview,
  type PaperFilter,
} from './paper-review-filter';

/* Rows shaped the way admin_paper_queue() returned them on live, 2026-09-28
   (read-only measurement): an English paper with a W14 rescue copy came back
   twice, once per live_copy audit paper, with different question counts. */
const row = (over: Partial<PaperQueueRow>): PaperQueueRow => ({
  paper_id: 'x',
  title: 't',
  school: 'School',
  subject: 'Mathematics',
  cls: 'X',
  board: 'ICSE',
  year: '2023',
  needs_review: false,
  is_published: true,
  incomplete_note: null,
  audit_paper_id: null,
  escalated_count: 0,
  total_questions: 0,
  passed_questions: 0,
  ...over,
});

const RAW: PaperQueueRow[] = [
  // English, needs review: main copy (14 shown) and rescue copy (45 held back).
  row({ paper_id: '63724c', subject: 'English', needs_review: true, audit_paper_id: 'main-1', total_questions: 14, passed_questions: 3 }),
  row({ paper_id: '63724c', subject: 'English', needs_review: true, audit_paper_id: 'rescue-1', total_questions: 45, passed_questions: 0, escalated_count: 1 }),
  // English, verified, also twice.
  row({ paper_id: '698f8f', subject: 'English', audit_paper_id: 'main-2', total_questions: 18, passed_questions: 18 }),
  row({ paper_id: '698f8f', subject: 'English', audit_paper_id: 'rescue-2', total_questions: 45, passed_questions: 0 }),
  // Maths, hidden and incomplete.
  row({ paper_id: 'a1', is_published: false, incomplete_note: 'Page 3 was missing from the source.', total_questions: 20, passed_questions: 20 }),
  // Maths, escalated, bigint counts arriving as strings.
  row({ paper_id: 'b2', needs_review: true, escalated_count: '2' as unknown as number, total_questions: '30' as unknown as number, passed_questions: '10' as unknown as number }),
  // An incomplete note that is only blank space is not a note (the public page hides it too).
  row({ paper_id: 'c3', incomplete_note: '' }),
];

describe('the bug: one row per audit copy, not per paper', () => {
  it('the raw rows repeat paper ids, so the list had duplicate React keys', () => {
    const ids = RAW.map((r) => r.paper_id);
    expect(new Set(ids).size).toBeLessThan(ids.length);
  });

  it('counting the raw rows overstated every tile (live: Needs review 1,190 for 893 papers)', () => {
    const raw = RAW.filter((p) => p.needs_review).length;
    const merged = filterCounts(mergeQueueRows(RAW)).needs_review;
    expect(raw).toBe(3);
    expect(merged).toBe(2);
  });
});

describe('merged rows', () => {
  const papers = mergeQueueRows(RAW);

  it('have exactly one row per paper, so every list key is unique', () => {
    const ids = papers.map((p) => p.paper_id);
    expect(ids).toEqual(['63724c', '698f8f', 'a1', 'b2', 'c3']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('add up progress and escalations across copies, so nothing is dropped', () => {
    const eng = papers.find((p) => p.paper_id === '63724c')!;
    expect(eng.total_questions).toBe(59);
    expect(eng.passed_questions).toBe(3);
    expect(eng.escalated_count).toBe(1);
  });

  it('coerce bigint strings to numbers so > 0 and arithmetic work', () => {
    const b2 = papers.find((p) => p.paper_id === 'b2')!;
    expect(b2.escalated_count).toBe(2);
    expect(b2.total_questions).toBe(30);
    expect(normaliseQueueRow(row({ needs_review: undefined as unknown as boolean })).needs_review).toBe(false);
  });
});

describe('tiles, chips and the list always agree', () => {
  const papers = mergeQueueRows(RAW);
  const counts = filterCounts(papers);

  it.each(PAPER_FILTERS.map((f) => f.key))('%s: the count is the length of the list it shows', (f) => {
    expect(filterPapers(papers, f as PaperFilter)).toHaveLength(counts[f as PaperFilter]);
  });

  it('each filter picks the right papers', () => {
    const ids = (f: PaperFilter) => filterPapers(papers, f).map((p) => p.paper_id).sort();
    expect(ids('needs_review')).toEqual(['63724c', 'b2']);
    expect(ids('escalated')).toEqual(['63724c', 'b2']);
    expect(ids('hidden')).toEqual(['a1']);
    expect(ids('incomplete')).toEqual(['a1']);
    expect(ids('verified')).toEqual(['698f8f', 'c3']);
    expect(ids('all')).toHaveLength(5);
  });

  it('a hidden paper that is still flagged is in Hidden only, never in Needs review', () => {
    const withHiddenFlagged = mergeQueueRows([
      ...RAW,
      row({ paper_id: 'h9', is_published: false, needs_review: true, total_questions: 5 }),
    ]);
    const ids = (f: PaperFilter) => filterPapers(withHiddenFlagged, f).map((p) => p.paper_id).sort();
    expect(ids('needs_review')).toEqual(['63724c', 'b2']);
    expect(ids('hidden')).toEqual(['a1', 'h9']);
    expect(filterCounts(withHiddenFlagged).needs_review).toBe(2);
  });

  it('switching filter changes the list (the owner saw it not follow)', () => {
    const lists = PAPER_FILTERS.map((f) => filterPapers(papers, f.key).map((p) => p.paper_id).join(','));
    expect(new Set(lists).size).toBeGreaterThan(3);
  });

  it('sorts fewest left to check first, papers with no copy last', () => {
    const sorted = sortForReview([...papers, row({ paper_id: 'zz', total_questions: 0 })]);
    expect(sorted[0].paper_id).toBe('a1');
    expect(sorted[sorted.length - 1].paper_id).toBe('zz');
  });

  it('labels carry no em or en dash', () => {
    for (const f of PAPER_FILTERS) expect(f.label).not.toMatch(/[–—]/);
  });
});

describe('the one-row queue migration', () => {
  const sql = readFileSync('supabase/migrations/20260928230000_admin_paper_queue_one_row_and_pdf_name.sql', 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const fns: [string, string][] = [
    ['admin_paper_queue', ''],
    ['admin_paper_draft', 'text'],
  ];

  for (const [name, args] of fns) {
    it(`${name} is admin-checked, definer, and closed to anon`, () => {
      expect(sql).toContain(`revoke all on function public.${name}(${args}) from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${name}(${args}) to authenticated;`);
      const body = sql.slice(sql.indexOf(`function public.${name}(`));
      const head = body.slice(0, body.indexOf('$function$;'));
      expect(head).toMatch(/security definer/);
      expect(head).toMatch(/set search_path to 'public'/);
      expect(head).toMatch(/if not public\.is_admin\(\) then\s+raise exception 'Not authorized' using errcode = '42501';/);
    });
  }

  it('drops admin_paper_draft before recreating it, since its return type changes', () => {
    expect(sql.indexOf('drop function if exists public.admin_paper_draft(text);')).toBeGreaterThan(-1);
    expect(sql.indexOf('drop function if exists public.admin_paper_draft(text);')).toBeLessThan(
      sql.indexOf('create function public.admin_paper_draft(text'.replace('(text', '(p_paper_id text')),
    );
  });

  it('both pickers skip the rescue copy, as 20260928220000 does', () => {
    const pickers = sql.match(/and coalesce\(a\.meta_source ->> 'role', ''\) <> 'rescue'\s+order by a\.created_at desc/g) ?? [];
    expect(pickers).toHaveLength(2);
    expect(sql).not.toMatch(/group by bp\.id, ap\.id/);
  });

  it('returns the PDF file name, not its path', () => {
    expect(sql).toMatch(/source_pdf text,/);
    // Literal substring: the SQL strips everything up to the last / or \.
    expect(sql).toContain(String.raw`regexp_replace(a.pdf_path, '^.*[\\/]', '')`);
  });

  it('never grants anything to anon and never writes bank_questions', () => {
    expect(sql).not.toMatch(/grant[^;]*\banon\b/i);
    expect(sql).not.toMatch(/update\s+public\.bank_questions/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.bank_questions/i);
  });
});
