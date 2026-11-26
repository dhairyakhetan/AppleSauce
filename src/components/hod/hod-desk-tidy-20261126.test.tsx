import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { FreeFilters } from '@/components/hod/AssignmentsTab';
import { StageStrip } from '@/components/PaperStatus';
import { UPLOAD_NEXT_WORDS, approveGate } from '@/components/hod/UploadsTab';
import { STAGES } from '@/lib/paper-status';
import {
  NO_FREE_FILTER,
  filterFreePapers,
  freeFilterChoices,
  freeFilterOn,
  historyByPaper,
  historyPeople,
  nextNeedsPaper,
  sortNeedsPapers,
} from '@/lib/hod-desk';
import { buildMainStops, normaliseRoute } from '@/lib/pipeline-route';
import { EXAMPLE_ROUTE_RAW } from '@/lib/pipeline-route.fixture';

/* HOD desk tidy, 26 Nov 2026 (owner approved). Node only: rendered markup and source-text checks. */

const read = (p: string) => readFileSync(p, 'utf8');
const noop = () => {};

describe('E1 and E2: one word, one number', () => {
  it('the strip card for papers nobody has says "Waiting for a checker", not "Ready"', () => {
    expect(STAGES.ready.short).toBe('Waiting for a checker');
    const out = renderToStaticMarkup(<StageStrip counts={{ ready: 4, waiting: 2 }} active={null} onPick={noop} />);
    expect(out).toContain('Waiting for a checker');
    expect(out).not.toMatch(/>Ready</);
  });

  it('the strip card that counts papers passing every check says "Can go live", like the Ready tab and the pipeline figure', () => {
    expect(STAGES.waiting.short).toBe('Can go live');
    expect(read('src/components/hod/HodStageStrip.tsx')).toContain('waiting: deskQ.data ? deskQ.data.ready_ok : null');
    const ready = buildMainStops(normaliseRoute(EXAMPLE_ROUTE_RAW), 'hod').find((s) => s.id === 'ready');
    expect(ready?.meaning).toContain('including ones a check still blocks');
    expect(ready?.figures?.[0].label).toBe('Can go live now');
  });
});

describe('E3: tabs that do not fit say so', () => {
  const src = read('src/pages/Hod.tsx');
  it('a fade and an arrow show at each edge with tabs beyond it', () => {
    expect(src).toContain('data-testid="tabs-left"');
    expect(src).toContain('data-testid="tabs-right"');
    expect(src).toContain("edges.right ? 'opacity-100' : 'opacity-0'");
    expect(src).toContain('row.scrollLeft + row.clientWidth < row.scrollWidth - 2');
  });
  it('the arrows are 44 px, out of the Tab order (arrow keys already move between tabs), and the tablist stays one row', () => {
    expect(src).toMatch(/tabIndex=\{-1\}\s+aria-hidden\s+onClick=\{\(\) => scrollTabs\(1\)\}/);
    expect(src).toContain('h-11 w-11');
    expect(src).toContain('role="tablist"');
    expect(src).not.toMatch(/role="tablist"[^>]*flex-wrap/);
  });
});

describe('E4: filters on Papers nobody has', () => {
  const rows = [
    { paper_id: 'a', subject: 'Physics', cls: '10', school: 'St Xavier', exam: 'Pre-board', year: '2024' },
    { paper_id: 'b', subject: 'Chemistry', cls: '9', school: 'La Martiniere', exam: 'Final', year: '2023' },
    { paper_id: 'c', subject: 'Physics', cls: '9', school: 'Modern High', exam: 'Final', year: '2023' },
  ];

  it('filters by subject, class and a search, in list order', () => {
    expect(filterFreePapers(rows, { ...NO_FREE_FILTER, subject: 'Physics' }).map((r) => r.paper_id)).toEqual(['a', 'c']);
    expect(filterFreePapers(rows, { ...NO_FREE_FILTER, cls: '9' }).map((r) => r.paper_id)).toEqual(['b', 'c']);
    expect(filterFreePapers(rows, { ...NO_FREE_FILTER, q: 'xavier' }).map((r) => r.paper_id)).toEqual(['a']);
    expect(filterFreePapers(rows, { ...NO_FREE_FILTER, q: 'class 9' }).map((r) => r.paper_id)).toEqual(['b', 'c']);
    expect(filterFreePapers(rows, NO_FREE_FILTER)).toHaveLength(3);
    expect(freeFilterOn(NO_FREE_FILTER)).toBe(false);
    expect(freeFilterChoices(rows)).toEqual({ subjects: ['Chemistry', 'Physics'], classes: ['9', '10'] });
  });

  it('shows what is applied and one Clear for all of it', () => {
    const out = renderToStaticMarkup(
      <FreeFilters filter={{ subject: 'Physics', cls: '', q: '' }} onFilter={noop} choices={freeFilterChoices(rows)} shown={2} total={3} />,
    );
    expect(out).toContain('Showing 2 of 3 papers. Select all ticks only these.');
    expect(out).toContain('>Clear</button>');
    expect(out).toContain('Every subject');
    expect(out).toContain('Class 10');
    expect(renderToStaticMarkup(<FreeFilters filter={NO_FREE_FILTER} onFilter={noop} choices={freeFilterChoices(rows)} shown={3} total={3} />)).not.toContain(
      'free-showing',
    );
  });

  it('Select all and the ticks work on the filtered list', () => {
    const src = read('src/components/hod/AssignmentsTab.tsx');
    expect(src).toContain('const chosen = shownFree.filter((p) => selected.has(p.paper_id));');
    expect(src).toContain('listLength={shownFree.length}');
    expect(src).toContain('selectFirst(shownFree.map((p) => p.paper_id))');
    expect(src).toContain('{shownFree.map((p: UnassignedPaper) => {');
  });
});

describe('E5: Needs you order and the next paper', () => {
  const p = (id: string, escalated: number, admin_bucket: number) => ({ audit_paper_id: id, title: `Paper ${id}`, escalated, admin_bucket });
  const list = [p('a', 5, 2), p('b', 0, 1), p('c', 3, 0)];

  it('sorts by most or fewest waiting, or students first, keeping the server order on ties', () => {
    expect(sortNeedsPapers(list, 'most').map((x) => x.audit_paper_id)).toEqual(['a', 'c', 'b']);
    expect(sortNeedsPapers(list, 'fewest').map((x) => x.audit_paper_id)).toEqual(['b', 'c', 'a']);
    expect(sortNeedsPapers(list, 'students').map((x) => x.audit_paper_id)).toEqual(['a', 'c', 'b']);
  });

  it('the next paper is the one after this in the list, else the first other one, else none', () => {
    expect(nextNeedsPaper(list, 'a')?.audit_paper_id).toBe('b');
    expect(nextNeedsPaper(list, 'c')?.audit_paper_id).toBe('a');
    expect(nextNeedsPaper(list, 'gone')?.audit_paper_id).toBe('a');
    expect(nextNeedsPaper([p('a', 1, 0)], 'a')).toBeNull();
  });

  it('after the last question the screen offers "Next paper waiting for you"', () => {
    const src = read('src/components/hod/NeedsYouTab.tsx');
    expect(src).toContain('Next paper waiting for you');
    expect(src).toContain('nextPaper={nextNeedsPaper(ordered, paperId)}');
    expect(src).toContain('data-testid="needs-sort"');
  });
});

describe('E6: say no to a subject request', () => {
  const src = read('src/components/hod/VerifiersTab.tsx');
  it('sits next to Approve and keeps the subjects as they are (which clears the request)', () => {
    expect(src.indexOf('data-testid="decline-request"')).toBeGreaterThan(src.indexOf('onClick={() => void approveRequest()}'));
    expect(src).toContain('await api.setPreferred(p.user_id, p.preferred_subjects);');
    expect(src).toContain("confirmLabel: 'Say no'");
  });
});

describe('E7: History', () => {
  it('searches the loaded rows by paper', () => {
    const rows = [{ paper_label: 'Physics 10 St Xavier 2024' }, { paper_label: null }, { paper_label: 'Chemistry 9' }];
    expect(historyByPaper(rows, 'xavier')).toEqual([rows[0]]);
    expect(historyByPaper(rows, '  ')).toHaveLength(3);
  });

  it('lists HODs and admins seen in the history alongside the checkers, each once, by name', () => {
    const people = historyPeople(
      [{ user_id: 'c1', label: 'Rohan' }],
      [
        { id: 'h1', name: 'Asha', role: 'hod' },
        { id: 'c1', name: 'Rohan', role: 'verifier' },
        { id: 'a1', name: 'Kanishk', role: 'admin' },
      ],
      (r) => (r === 'hod' ? 'HOD' : r === 'admin' ? 'Admin' : 'Checker'),
    );
    expect(people).toEqual([
      { id: 'h1', label: 'Asha (HOD)' },
      { id: 'a1', label: 'Kanishk (Admin)' },
      { id: 'c1', label: 'Rohan' },
    ]);
  });

  it('the screen says the search covers only what is loaded', () => {
    const src = read('src/components/hod/HistoryTab.tsx');
    expect(src).toContain('in the {rowsAll.length} loaded.');
    expect(src).toContain("' Load older at the bottom to search further back.'");
  });
});

describe('E8: Uploads', () => {
  it('Approve is off until every file was opened, and says why', () => {
    expect(approveGate(['a.pdf'], new Set())).toBe('Open the file first. Approve switches on once you have looked at it.');
    expect(approveGate(['a.pdf', 'b.pdf'], new Set(['a.pdf']))).toContain('1 of 2 opened');
    expect(approveGate(['a.pdf', 'b.pdf'], new Set(['a.pdf', 'b.pdf']))).toBeNull();
    expect(approveGate([], new Set())).toContain('nothing to approve');
    const src = read('src/components/hod/UploadsTab.tsx');
    expect(src).toContain('disabled={busy || gate !== null}');
    expect(src).toContain('onClick={() => onOpened(l.path)}');
  });

  it('says what happens next', () => {
    expect(UPLOAD_NEXT_WORDS).toContain('Nothing goes on the site from here.');
    expect(read('src/components/hod/UploadsTab.tsx')).toContain('{gate ?? UPLOAD_NEXT_WORDS}');
  });
});

describe('E9: only Pass is orange in Needs you', () => {
  it('Send back to students is a quiet button', () => {
    const src = read('src/components/hod/NeedsYouTab.tsx');
    expect(src).toMatch(/<button type="button" className=\{quietButton\} disabled=\{busy\} onClick=\{\(\) => setPanel\('back'\)\}>\s+Send back to students/);
  });
});

describe('copy rules', () => {
  it('no em or en dashes', () => {
    for (const f of [
      'src/components/hod/AssignmentsTab.tsx',
      'src/components/hod/HistoryTab.tsx',
      'src/components/hod/NeedsYouTab.tsx',
      'src/components/hod/UploadsTab.tsx',
      'src/components/hod/VerifiersTab.tsx',
      'src/lib/hod-desk.ts',
      'src/lib/paper-status.ts',
      'src/pages/Hod.tsx',
    ]) {
      expect(read(f), f).not.toMatch(/[–—]/);
    }
  });
});
