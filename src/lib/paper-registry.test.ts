import { describe, expect, it } from 'vitest';
import {
  PROCESSED_STATES,
  STATE_LOOK,
  adminPaperHref,
  barSegments,
  canShowMore,
  hasMore,
  headlineCounts,
  isProcessedState,
  listForStates,
  mergeRows,
  openCount,
  percent,
  questionsLine,
  rowFacts,
  rowHeading,
  rowSubline,
  rowTitle,
  stateLabel,
  subjectOptions,
  type RegistryRow,
  type RegistrySummary,
} from './paper-registry';
import { createFakePaperRegistryApi } from '@/dummy/paper-registry-fake-api';

const summary: RegistrySummary = {
  total: 10,
  by_state: { not_started: 4, ocr_queued: 1, loaded: 2, awaiting_approval: 1, live: 2 },
  by_subject: [
    { subject: 'Physics', total: 6, by_state: { not_started: 3, live: 2, loaded: 1 } },
    { subject: 'Mathematics', total: 4, by_state: { not_started: 1, ocr_queued: 1, loaded: 1, awaiting_approval: 1 } },
  ],
  by_board: { ICSE: 10 },
  frozen: 0,
  excluded: 0,
  last_updated_at: null,
};

const row = (k: string, extra: Partial<RegistryRow> = {}): RegistryRow => ({
  registry_key: k, pdf_name: null, board: null, class: null, subject: null, year: null, school: null,
  ocr_state: null, processed_state: 'not_started', audit_paper_id: null, bank_paper_id: null, source: null,
  questions_total: null, questions_passed: null, open_student: null, open_admin: null, approval_state: null,
  frozen: false, excluded: false, updated_at: null, ...extra,
});

describe('paper registry helpers', () => {
  it('knows exactly the eight states the table allows, not started first', () => {
    expect(PROCESSED_STATES[0]).toBe('not_started');
    expect(PROCESSED_STATES).toHaveLength(8);
    expect(Object.keys(STATE_LOOK).sort()).toEqual([...PROCESSED_STATES].sort());
    expect(isProcessedState('live')).toBe(true);
    expect(isProcessedState('done')).toBe(false);
  });

  it('uses plain words and no dashes in every label and hint', () => {
    expect(stateLabel('not_started')).toBe('Not started');
    expect(stateLabel('ocr_queued')).toBe('Waiting to be read');
    expect(stateLabel('ocr_done')).toBe('Read, not loaded');
    expect(stateLabel('loaded')).toBe('Loaded, not checked');
    expect(stateLabel('ai_checked')).toBe('Checked by the AI');
    expect(stateLabel('fully_checked')).toBe('Fully checked');
    expect(stateLabel('awaiting_approval')).toBe('Waiting for your approval');
    expect(stateLabel('live')).toBe('Live');
    expect(stateLabel(null)).toBe('Not started');
    for (const s of PROCESSED_STATES) {
      expect(STATE_LOOK[s].label + STATE_LOOK[s].hint).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it('splits the headline into not started, in progress and on the site', () => {
    expect(headlineCounts(summary)).toEqual({ notStarted: 4, inProgress: 4, live: 2, total: 10 });
    expect(headlineCounts({ total: 0, by_state: {} })).toEqual({ notStarted: 0, inProgress: 0, live: 0, total: 0 });
  });

  it('draws bar slices in pipeline order, dropping empty states, summing to 100', () => {
    const seg = barSegments(summary);
    expect(seg.map((s) => s.state)).toEqual(['not_started', 'ocr_queued', 'loaded', 'awaiting_approval', 'live']);
    expect(seg.reduce((n, s) => n + s.widthPct, 0)).toBeCloseTo(100);
    expect(barSegments({ total: 0, by_state: {} })).toEqual([]);
  });

  it('percent never divides by zero', () => {
    expect(percent(3, 0)).toBe(0);
    expect(percent(1, 3)).toBe(33);
    expect(percent(-2, 5)).toBe(0);
  });

  it('lists subjects with the count in the chosen state, dropping empty ones', () => {
    expect(subjectOptions(summary, null)).toEqual([
      { subject: 'Mathematics', count: 4 },
      { subject: 'Physics', count: 6 },
    ]);
    expect(subjectOptions(summary, 'live')).toEqual([{ subject: 'Physics', count: 2 }]);
  });

  it('merges a next page without repeating a row', () => {
    const merged = mergeRows([row('a'), row('b')], [row('b'), row('c')]);
    expect(merged.map((r) => r.registry_key)).toEqual(['a', 'b', 'c']);
    expect(hasMore(120, 50)).toBe(true);
    expect(hasMore(50, 50)).toBe(false);
  });

  it('shows whatever a row knows without stray commas', () => {
    expect(rowTitle(row('k1'))).toBe('k1');
    expect(rowTitle(row('k1', { pdf_name: ' A.pdf ' }))).toBe('A.pdf');
    expect(rowFacts(row('k', { board: 'ICSE', class: 'X', subject: 'Physics', year: '2025', school: null }))).toBe(
      'ICSE, Class X, Physics, 2025',
    );
    expect(rowFacts(row('k'))).toBe('');
  });

  it('leads a row with board, class, subject and year, and the PDF name second', () => {
    const r = row('k', { pdf_name: 'ICSE_Phy_2025_final.pdf', board: 'ICSE', class: 'X', subject: 'Physics', year: '2025', school: 'Sample High' });
    expect(rowHeading(r)).toBe('ICSE Class X Physics, 2025');
    expect(rowSubline(r)).toBe('ICSE_Phy_2025_final.pdf, Sample High');
    // nothing known: the PDF name leads and is not repeated underneath
    const bare = row('k2', { pdf_name: 'scan_17.pdf' });
    expect(rowHeading(bare)).toBe('scan_17.pdf');
    expect(rowSubline(bare)).toBe('');
    expect(rowHeading(row('k3'))).toBe('k3');
    expect(rowHeading(row('k4', { subject: 'Physics' }))).toBe('Physics');
    expect(questionsLine(row('k'))).toBe('');
    expect(questionsLine(row('k', { questions_total: 40, questions_passed: 12 }))).toBe('12 of 40 questions cleared');
    expect(questionsLine(row('k', { questions_total: 40, questions_passed: 99 }))).toBe('40 of 40 questions cleared');
    expect(openCount(null)).toBe('n/a');
    expect(openCount(3)).toBe('3');
  });

  it('links to the admin paper page only when the audit id is known', () => {
    expect(adminPaperHref(row('k'))).toBeNull();
    expect(adminPaperHref(row('k', { audit_paper_id: 'abc' }))).toBe('/admin/paper-approvals/abc');
  });
});

describe('fake registry api', () => {
  it('puts not started first, filters, searches and pages like the real RPC', async () => {
    const api = createFakePaperRegistryApi();
    const sum = await api.summary();
    expect(sum.total).toBeGreaterThan(100);
    expect(sum.by_state.not_started).toBeGreaterThan(sum.by_state.live ?? 0);

    const first = await api.list({ state: null, search: '', subject: null, limit: 50, offset: 0 });
    expect(first.total).toBe(sum.total);
    expect(first.rows).toHaveLength(50);
    expect(first.rows[0].processed_state).toBe('not_started');
    const second = await api.list({ state: null, search: '', subject: null, limit: 50, offset: 50 });
    expect(mergeRows(first.rows, second.rows)).toHaveLength(100);

    const live = await api.list({ state: 'live', search: '', subject: null, limit: 50, offset: 0 });
    expect(live.total).toBe(sum.by_state.live);
    expect(live.rows.every((r) => r.processed_state === 'live')).toBe(true);

    const hit = await api.list({ state: null, search: 'DEMO-007', subject: null, limit: 50, offset: 0 });
    expect(hit.rows.map((r) => r.registry_key)).toContain('demo-007');
  });

  it('can be told to be empty or to fail', async () => {
    expect((await createFakePaperRegistryApi('empty').summary()).total).toBe(0);
    await expect(createFakePaperRegistryApi('error').summary()).rejects.toThrow();
  });
});

describe('listing several states at once', () => {
  const base = { search: '', subject: null, limit: 50, offset: 0 };

  it('the waiting stop shows not started and the reading queue, matching its count', async () => {
    const api = createFakePaperRegistryApi();
    const sum = await api.summary();
    const page = await listForStates(api, { ...base, states: ['not_started', 'ocr_queued'] });
    const want = (sum.by_state.not_started ?? 0) + (sum.by_state.ocr_queued ?? 0);
    expect(page.total).toBe(want);
    expect(page.rows).toHaveLength(Math.min(50, want));
    expect(page.rows.every((r) => r.processed_state === 'not_started' || r.processed_state === 'ocr_queued')).toBe(true);
  });

  it('pages run through one state and into the next with no gap and no repeat', async () => {
    const api = createFakePaperRegistryApi();
    const sum = await api.summary();
    const notStarted = sum.by_state.not_started ?? 0;
    const states = ['not_started', 'ocr_queued'] as const;
    const all: string[] = [];
    // a page size that straddles the boundary between the two states
    const limit = Math.max(1, Math.floor(notStarted / 2) + 3);
    let total = 0;
    for (let offset = 0; offset === 0 || offset < total; offset += limit) {
      const page = await listForStates(api, { ...base, limit, offset, states });
      total = page.total;
      all.push(...page.rows.map((r) => r.registry_key));
    }
    expect(all).toHaveLength(total);
    expect(new Set(all).size).toBe(total);
    const whole = await listForStates(api, { ...base, limit: 200, states });
    expect(all).toEqual(whole.rows.map((r) => r.registry_key));
    // not started first, then the queue
    const order = whole.rows.map((r) => r.processed_state);
    expect(order.indexOf('ocr_queued')).toBeGreaterThanOrEqual(notStarted);
  });

  it('no state and one state go straight to the server', async () => {
    const api = createFakePaperRegistryApi();
    const every = await listForStates(api, { ...base, states: [] });
    expect(every.total).toBe((await api.summary()).total);
    const live = await listForStates(api, { ...base, states: ['live'] });
    expect(live.rows.every((r) => r.processed_state === 'live')).toBe(true);
  });
});

describe('show more', () => {
  it('is offered only when there is more, nothing failed and no new first page is loading', () => {
    expect(canShowMore(100, 50, { listError: false, listLoading: false })).toBe(true);
    expect(canShowMore(100, 50, { listError: false, listLoading: true })).toBe(false);
    expect(canShowMore(100, 50, { listError: true, listLoading: false })).toBe(false);
    expect(canShowMore(50, 50, { listError: false, listLoading: false })).toBe(false);
  });
});
