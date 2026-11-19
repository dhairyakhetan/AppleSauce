import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { ReadyList, READY_KEY } from '@/components/hod/ReadyTab';
import type { HodApi } from '@/lib/hod-api';
import { verifierSetupLine } from '@/lib/hod-desk';
import {
  CHECKS,
  blockedReasons,
  junkNumbersText,
  normaliseChecks,
  normaliseReadyPapers,
  plainCheckDetail,
  readySummaryText,
} from '@/lib/hod-publish';

/* Fault hunt 13 Nov 2026: screens that said something wrong or misleading.
   No jsdom: the Ready list is rendered to markup from preset query data, and the
   rest is checked as pure functions and against source text, as the other HOD tests do. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const noComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const DASH = /[–—]/;

function checksFor(failing: Record<string, string>) {
  return CHECKS.map((c) => ({ key: c.key, label: c.label, ok: !(c.key in failing), detail: failing[c.key] ?? '' }));
}

function paper(id: string, failing: Record<string, string>) {
  return { audit_paper_id: id, title: `Paper ${id}`, question_count: 10, passed_count: 10, left_out: 0, checks: checksFor(failing), kind: 'new', queued_at: null, is_live: false };
}

function renderReady(rows: unknown[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(READY_KEY('t'), normaliseReadyPapers(rows));
  qc.setQueryData(['hod', 't', 'trail'], []);
  const api = {} as HodApi;
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ReadyList api={api} scope="t" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Ready to go live: honest count and a Blocked group', () => {
  const rows = [
    paper('a', {}),
    paper('b', {}),
    paper('c', { pictures_present: '2 pictures are not on the site yet.' }),
    paper('d', { header_complete: 'Missing: board, year.', scanner_junk_gone: '1 question has scanner marks (1 question with no number).' }),
  ];

  it('says how many can go live and how many are blocked', () => {
    const out = renderReady(rows);
    expect(out).toContain('2 papers can go live now. 2 others are blocked, with the reason under each.');
    expect(out).not.toContain('4 papers are ready');
  });

  it('lists the passing papers first under their own heading, and the rest under "Blocked, with the reason"', () => {
    const out = renderReady(rows);
    expect(out).toContain('Can go live now (2)');
    expect(out).toContain('Blocked, with the reason (2)');
    const go = out.indexOf('data-testid="ready-can-go-live"');
    const blocked = out.indexOf('data-testid="ready-blocked"');
    expect(go).toBeGreaterThan(-1);
    expect(blocked).toBeGreaterThan(go);
    expect(out.indexOf('Paper a')).toBeLessThan(blocked);
    expect(out.indexOf('Paper b')).toBeLessThan(blocked);
    expect(out.indexOf('Paper c')).toBeGreaterThan(blocked);
    expect(out.indexOf('Paper d')).toBeGreaterThan(blocked);
  });

  it('shows each blocked paper its reason from the check data, and a passing paper none', () => {
    const out = renderReady(rows);
    expect(out).toContain('Pictures are in place: 2 pictures are not on the site yet.');
    expect(out).toContain('Paper details are complete: Missing: board, year.');
    expect(out.match(/data-testid="blocked-reasons"/g)).toHaveLength(2);
    expect(out).not.toMatch(DASH);
  });

  it('a blocked paper is not offered "Review and publish"', () => {
    const out = renderReady(rows);
    expect(out.match(/aria-label="Review and publish /g)).toHaveLength(2);
    expect(out).toContain('aria-label="Open Paper c"');
  });

  it('with nothing passing there is no "Can go live now" group, only Blocked', () => {
    const out = renderReady([paper('x', { pictures_present: 'A picture is missing.' })]);
    expect(out).toContain('None can go live yet. 1 paper is blocked.');
    expect(out).not.toContain('Can go live now (');
    expect(out).toContain('Blocked, with the reason (1)');
  });

  it('when every paper passes there is no Blocked group', () => {
    const out = renderReady([paper('x', {}), paper('y', {})]);
    expect(out).toContain('2 papers can go live now.');
    expect(out).not.toContain('Blocked, with the reason');
  });

  it('summary wording, in numbers', () => {
    expect(readySummaryText(85, 26)).toBe('26 papers can go live now. 59 others are blocked, with the reason under each.');
    expect(readySummaryText(2, 1)).toBe('1 paper can go live now. 1 other is blocked, with the reason under each.');
    expect(readySummaryText(3, 0)).toBe('None can go live yet. 3 papers are blocked.');
    expect(readySummaryText(3, 3)).toBe('3 papers can go live now.');
    for (const t of [readySummaryText(85, 26), readySummaryText(3, 0)]) expect(t).not.toMatch(DASH);
  });

  it('blockedReasons uses the failed checks only, and falls back to the check name when there is no detail', () => {
    const checks = checksFor({ pictures_present: '', scanner_junk_gone: 'Marks left.' });
    expect(blockedReasons(checks)).toEqual(['Pictures are in place', 'No scanner junk left: Marks left.']);
    expect(blockedReasons(checksFor({}))).toEqual([]);
  });

  it('the stage strip counts only the papers that pass, so it matches the Ready tab', () => {
    const src = noComments(read('./HodStageStrip.tsx'));
    expect(src).toContain('waiting: deskQ.data ? deskQ.data.ready_ok : null');
    expect(src).not.toContain('deskQ.data.ready :');
  });
});

describe('Verifiers: no green message above an error', () => {
  it('says "Everyone is set up" only when the details loaded, there are people and nobody needs attention', () => {
    expect(verifierSetupLine(0, 5, false)).toBe('Everyone is set up.');
    expect(verifierSetupLine(0, 5, true)).toBe('');
    expect(verifierSetupLine(0, 0, false)).toBe('');
    expect(verifierSetupLine(3, 5, true)).toBe('');
    expect(verifierSetupLine(3, 5, false)).toBe('3 need your attention and are listed first.');
  });

  it('the tab asks the helper, with the load error, and no longer hard-codes the green sentence', () => {
    const src = noComments(read('./VerifiersTab.tsx'));
    expect(src).toContain('verifierSetupLine(needing, profiles.length, profilesQ.isError)');
    expect(src).not.toContain("'Everyone is set up.'");
  });
});

describe('Scanner message: no "question ?, ?"', () => {
  it('counts the questions with no number instead of printing a question mark', () => {
    expect(junkNumbersText(['?', '?'])).toBe('2 questions with no number');
    expect(junkNumbersText(['?'])).toBe('1 question with no number');
    expect(junkNumbersText(['3', '?', '?'])).toBe('question 3 and 2 questions with no number');
    expect(junkNumbersText(['3', '5'])).toBe('questions 3, 5');
    expect(junkNumbersText([null, ' '])).toBe('2 questions with no number');
  });

  it('rewrites the database sentence for the scanner check only', () => {
    expect(plainCheckDetail('scanner_junk_gone', '2 questions have scanner marks (question ?, ?).')).toBe(
      '2 questions have scanner marks (2 questions with no number).',
    );
    expect(plainCheckDetail('scanner_junk_gone', '2 questions have scanner marks (question 4, ?).')).toBe(
      '2 questions have scanner marks (question 4 and 1 question with no number).',
    );
    // Real numbers are left exactly as written.
    expect(plainCheckDetail('scanner_junk_gone', '2 questions have scanner marks (question 4, 7).')).toBe(
      '2 questions have scanner marks (question 4, 7).',
    );
    expect(plainCheckDetail('header_complete', 'Missing: board (question ?).')).toBe('Missing: board (question ?).');
  });

  it('normaliseChecks applies it, so the Checks step and the Ready row both read plainly', () => {
    const checks = normaliseChecks([{ key: 'scanner_junk_gone', label: 'No scanner junk left', ok: false, detail: '2 questions have scanner marks (question ?, ?).' }]);
    const junk = checks.find((c) => c.key === 'scanner_junk_gone');
    expect(junk?.detail).toBe('2 questions have scanner marks (2 questions with no number).');
    expect(junk?.detail).not.toContain('?');
  });

  it('the Checks step builds the marked-questions line from the same helper', () => {
    const src = noComments(read('./PublishFlow.tsx'));
    expect(src).toContain('junkNumbersText(junk.map((q) => q.display_number ?? q.number_path))');
    expect(src).not.toContain("?? '?'");
  });
});

describe('Past papers page reads the papers table once', () => {
  const code = noComments(read('../../pages/PastPapers.tsx'));

  it('has one select on papers in the landing query, not four', () => {
    // The landing read, plus the signed-in "new papers" count.
    expect(code.match(/from\('papers'\)/g) ?? []).toHaveLength(2);
    expect(code).toContain("{ count: 'exact' }");
    expect(code).not.toContain('schoolsRes');
    expect(code).not.toContain('subjectsRes');
    expect(code).not.toContain('countRes');
    expect(code).toContain('recentPapers: paperRows.slice(0, 6)');
  });
});
