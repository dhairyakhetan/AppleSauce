import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { BulkBar, OutcomePanel, SelectAllRow } from '@/components/hod/AssignmentsTab';
import { summariseBulk } from '@/lib/hod-bulk-assign';

/* No jsdom here: the three small views are rendered to markup, and the wiring in
   the tab itself is checked against its source, as the other HOD tests do. */

describe('Assignments: bulk views', () => {
  it('the bar says how many are ticked and names the choice of verifier', () => {
    const out = renderToStaticMarkup(
      <BulkBar count={3} options={[{ value: 'u1', label: 'Krish (Class 10)' }]} value="" onValue={() => {}} onAssign={() => {}} onClear={() => {}} progress={null} />,
    );
    expect(out).toContain('Assign 3 selected to');
    expect(out).toContain('aria-labelledby="bulk-bar-label"');
    expect(out).toContain('Krish (Class 10)');
    // No verifier chosen yet: the button is off.
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Assign<\/button>/);
  });

  it('while it runs the bar shows progress and cannot be pressed again', () => {
    const out = renderToStaticMarkup(
      <BulkBar count={12} options={[]} value="u1" onValue={() => {}} onAssign={() => {}} onClear={() => {}} progress={{ done: 4, total: 12 }} />,
    );
    expect(out).toContain('Assigning 4 of 12 papers...');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"|<button[^>]*aria-busy="true"[^>]*disabled=""/);
  });

  it('select all shows the count and the number ticked', () => {
    const out = renderToStaticMarkup(<SelectAllRow listLength={12} selectedCount={3} onChange={() => {}} />);
    expect(out).toContain('Select all 12');
    expect(out).toContain('3 selected');
    expect(out).not.toContain('checked=""');
  });

  it('the result is inside a polite live region, and lists each refusal by paper name', () => {
    const outcome = summariseBulk(
      [
        { paperId: 'a', label: 'Maths X 2019', ok: true },
        { paperId: 'b', label: 'Physics XII 2020', ok: false, error: 'Above their grade' },
      ],
      'Krish',
    );
    const out = renderToStaticMarkup(<OutcomePanel outcome={outcome} onDismiss={() => {}} />);
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('Gave 1 of 2 papers to Krish. 1 was refused.');
    expect(out).toContain('Physics XII 2020');
    expect(out).toContain('Above their grade');
  });

  it('the live region is on the page even when there is no result yet', () => {
    const out = renderToStaticMarkup(<OutcomePanel outcome={null} onDismiss={() => {}} />);
    expect(out).toContain('aria-live="polite"');
    expect(out).not.toContain('Dismiss');
  });
});

describe('Assignments: the tab wiring', () => {
  const src = readFileSync('src/components/hod/AssignmentsTab.tsx', 'utf8');

  it('the primary button is orange and called Auto assign all, on the existing distribute call', () => {
    expect(src).toContain('Auto assign all');
    expect(src).not.toContain('Give out papers now');
    expect(src).not.toContain("actionToneClass('mint')");
    expect(src).toMatch(/api\.distribute\(\)/);
  });

  it('bulk assign uses the existing one-paper call and there is no Auto assign selected', () => {
    expect(src).toMatch(/runBulkAssign\(items, \(paperId\) => api\.assignPaper\(paperId, toId\)/);
    expect(src).not.toContain('Auto assign selected');
  });

  it('every paper row has a checkbox named after the paper', () => {
    expect(src).toMatch(/aria-label=\{`Select \$\{paperLabel\(p\)\}`\}/);
  });

  it('the picker keeps its dropdown and button on one line at phone width', () => {
    expect(src).toMatch(/className="flex w-full items-center gap-1\.5 sm:inline-flex sm:w-auto"/);
    expect(src).toContain('min-w-0 flex-1');
  });
});
