import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { WhoHasWhat } from '@/components/hod/WhoHasWhat';
import type { HodAssignment } from '@/lib/hod-api';

/* No jsdom here: the list is rendered to markup (what a visitor sees before touching anything), and the
   open-and-close wiring is checked against the source, as the other HOD tests do. */

let id = 1;
const paper = (user: string, name: string, over: Partial<HodAssignment> = {}): HodAssignment => {
  const n = id++;
  return {
    assignment_id: n,
    status: 'assigned',
    user_id: user,
    checker_name: name,
    paper_id: `p${n}`,
    subject: 'Economics',
    school: 'Test School',
    cls: 'X',
    exam: 'Board',
    year: '2024',
    remaining: 12,
    given_by_name: 'Automatic',
    assigned_at: '2026-11-01T10:00:00Z',
    started_at: null,
    ...over,
  };
};

const many = Array.from({ length: 130 }, (_, i) => paper(`u${i % 32}`, `Person ${String(i % 32).padStart(2, '0')}`));
const render = (assignments: HodAssignment[], idle: { user_id: string; name: string; why: string | null }[] = []) =>
  renderToStaticMarkup(
    <WhoHasWhat
      scope="test"
      assignments={assignments}
      idle={idle}
      reasonsOf={(a) => ({ stuck: a.remaining === 99 ? 'Person has done nothing on this for 8 days.' : null, waiting: null })}
      renderActions={() => <button type="button">Take it myself</button>}
      renderMore={() => <p>More</p>}
    />,
  );

describe('Who has what: what a visitor sees first', () => {
  const out = render(many, [{ user_id: 'idle1', name: 'Zed', why: 'Their details have expired, so no new papers are given to them.' }]);

  it('a summary line with the totals', () => {
    expect(out).toContain('data-testid="who-summary"');
    expect(out).toContain('<span class="font-bold">32</span> people hold');
    expect(out).toContain('<span class="font-bold">130</span>');
    expect(out).toContain('1 with no paper');
  });

  it('a search box, a sort and the four filters', () => {
    expect(out).toContain('type="search"');
    expect(out).toContain('Search people or papers');
    expect(out).toContain('Most questions left');
    for (const chip of ['Has stuck papers', 'Waiting for an HOD', 'Light load', 'Heavy load']) expect(out).toContain(chip);
    expect(out).toContain('aria-pressed="false"');
    expect(out).toContain('Open all');
    expect(out).toContain('Close all');
  });

  it('only the first 25 people are drawn, each closed, with a button for the rest', () => {
    expect((out.match(/data-testid="verifier-load"/g) ?? []).length).toBe(25);
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('aria-expanded="true"');
    expect(out).toContain('Show 8 more people');
  });

  it('no paper row and no action button is drawn until a person is opened', () => {
    expect(out).not.toContain('data-testid="assignment-row"');
    expect(out).not.toContain('Take it myself');
    expect(out).not.toContain('Why this paper');
  });

  it('each person is one line: name, papers, questions left, oldest', () => {
    expect(out).toMatch(/Person \d\d<\/span>/);
    expect(out).toContain('papers · ');
    expect(out).toContain('questions left');
    expect(out).toContain('oldest given');
  });

  it('a person with no paper shows the reason without being opened', () => {
    const few = render([paper('u1', 'Asha')], [{ user_id: 'idle1', name: 'Zed', why: 'Their details have expired.' }]);
    expect(few).toContain('data-testid="idle-reason"');
    expect(few).toContain('Their details have expired.');
    expect(few).toContain('no papers yet');
  });

  it('an empty desk says so', () => {
    expect(render([])).toContain('No paper is assigned to anyone right now.');
  });
});

describe('Who has what: the wiring', () => {
  const src = readFileSync('src/components/hod/WhoHasWhat.tsx', 'utf8');
  const tab = readFileSync('src/components/hod/AssignmentsTab.tsx', 'utf8');

  it('people and papers open with real buttons that say whether they are open', () => {
    expect(src).toMatch(/<button\s+type="button"\s+aria-expanded=\{open\}\s+aria-controls=\{panel\}/);
    expect(src).toMatch(/aria-expanded=\{paperOpen\}\s+aria-controls=\{detail\}/);
    expect(src).toContain('aria-pressed={on}');
  });

  it('the actions, "Why this paper?" and the timeline are handed in and drawn only for an opened paper', () => {
    const afterOpen = src.slice(src.indexOf('{paperOpen ? ('));
    expect(afterOpen).toContain('renderActions(a)');
    expect(afterOpen).toContain('renderMore(a)');
    expect(src.slice(0, src.indexOf('{paperOpen ? ('))).not.toContain('renderActions(a)');
  });

  it('the sort and the opened people are remembered per tab, never throwing', () => {
    expect(src).toContain('saveViewState(tabStorage()');
    expect(src).toContain('loadViewState(tabStorage()');
  });

  it('the tab hands in every action it had before', () => {
    expect(tab).toContain('<WhoHasWhat');
    const actions = tab.slice(tab.indexOf('const renderActions'), tab.indexOf('const renderMore'));
    for (const word of ['Take it myself', 'Move to another checker', 'Unassign']) expect(actions).toContain(word);
    expect(tab).toContain('<AssignmentWhy');
    expect(tab).toContain('PaperTimelineDisclosure');
  });

  it('long lists are paged and the phone layout has no sideways scroll', () => {
    expect(src).toContain('windowRows(view, peopleShown)');
    expect(src).toContain('windowRows(p.papers, page)');
    expect(src).toContain('min-w-0');
    expect(src).not.toMatch(/overflow-x-(auto|scroll)/);
  });
});
