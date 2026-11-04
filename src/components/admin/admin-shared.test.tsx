import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() } },
}));
vi.mock('@/lib/admin-debug', () => ({
  useAdminDebugToggle: () => ({ on: false, canToggle: false, toggle: () => {} }),
  useAdminDebugOn: () => false,
}));

import { AdminTabs, nextTabKey } from '@/components/admin/AdminTabs';
import { AdminFilterChips, chipCountText } from '@/components/admin/AdminFilterChips';
import { AdminEmpty, AdminError, AdminLoading, errorSentence } from '@/components/admin/AdminState';
import { AdminPillButton, adminPillClass } from '@/components/admin/AdminPillButton';
import { readRememberedOpen, writeRememberedOpen } from '@/lib/use-remembered-open';
import { AdminHeaderView, CountsRetry, buildAdminNav, hodBadge, navBadge } from '@/pages/admin/shell';
import { AdminRowActions, AdminStatusPill, AdminTable, AdminPanelHeader, rowSubject } from '@/pages/admin/AdminTable';
import { adminGuardStep } from '@/components/AdminConsole';
import type { User } from '@supabase/supabase-js';
import type { AdminCountsState } from '@/pages/admin/useAdminSectionCounts';

/* No jsdom here, so these render to markup and, for clicks, walk the element
   tree of a function component and call the handler it holds. */

function findProp(node: ReactNode, prop: string): ((...a: unknown[]) => void) | null {
  if (!isValidElement(node)) return null;
  const props = node.props as Record<string, unknown>;
  if (typeof props[prop] === 'function') return props[prop] as (...a: unknown[]) => void;
  const kids = props.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const hit = findProp(k as ReactNode, prop);
    if (hit) return hit;
  }
  return null;
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const state = (o: Partial<AdminCountsState>): AdminCountsState => ({ counts: {}, status: 'ok', failed: [], refetch: () => {}, ...o });

describe('AdminTabs', () => {
  const keys = ['a', 'b', 'c'];
  it('moves with the arrow keys, wraps, and jumps with Home and End', () => {
    expect(nextTabKey(keys, 'a', 'ArrowRight')).toBe('b');
    expect(nextTabKey(keys, 'c', 'ArrowRight')).toBe('a');
    expect(nextTabKey(keys, 'a', 'ArrowLeft')).toBe('c');
    expect(nextTabKey(keys, 'b', 'Home')).toBe('a');
    expect(nextTabKey(keys, 'b', 'End')).toBe('c');
    expect(nextTabKey(keys, 'b', 'Enter')).toBeNull();
    expect(nextTabKey([], 'a', 'ArrowRight')).toBeNull();
  });

  it('renders roving tabindex, aria-controls and a labelled tabpanel', () => {
    const html = renderToStaticMarkup(
      <AdminTabs tabs={[{ key: 'a', label: 'One', count: 3 }, { key: 'b', label: 'Two', count: null }, { key: 'c', label: 'Three' }]} value="b" onChange={() => {}} label="Views">
        <p>panel body</p>
      </AdminTabs>,
    );
    expect(html).toContain('role="tablist"');
    expect(html.match(/tabindex="0"/g)?.length).toBe(2); // the selected tab and the panel
    expect(html.match(/tabindex="-1"/g)?.length).toBe(2);
    expect(html.match(/aria-selected="true"/g)?.length).toBe(1);
    expect(html).toMatch(/role="tabpanel"[^>]*aria-labelledby="[^"]*-tab-b"/);
    const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(controls).size).toBe(1);
    expect(html).toContain(`id="${controls[0]}"`);
    expect(html).toContain('panel body');
    expect(text(html)).toContain('One 3'); // a real count
    expect(text(html)).toContain('Two ?'); // an unknown count
    expect(text(html)).not.toContain('Three 0');
    expect(html).toContain('before:-inset-1');
  });
});

describe('AdminFilterChips', () => {
  const chips = [
    { key: 'all', label: 'All', noCount: true },
    { key: 'live', label: 'Live', count: 12 },
    { key: 'hidden', label: 'Hidden', count: 0 },
    { key: 'ready', label: 'Ready' },
  ];
  it('marks the applied chip pressed and shows 0 as 0 and unknown as ?', () => {
    const html = renderToStaticMarkup(<AdminFilterChips chips={chips} value="live" onChange={() => {}} />);
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(3);
    expect(text(html)).toContain('Live 12');
    expect(text(html)).toContain('Hidden 0');
    expect(text(html)).toContain('Ready ?');
    expect(text(html)).not.toContain('All ?');
    expect(html).toContain('min-h-10');
    expect(chipCountText({ count: undefined })).toBe('?');
    expect(chipCountText({ count: 0 })).toBe('0');
  });

  it('shows a one-tap clear only while a non-default filter is applied', () => {
    const onClear = vi.fn();
    const applied = renderToStaticMarkup(<AdminFilterChips chips={chips} value="live" onChange={() => {}} onClear={onClear} />);
    expect(applied).toContain('Clear filter');
    const plain = renderToStaticMarkup(<AdminFilterChips chips={chips} value="all" onChange={() => {}} onClear={onClear} />);
    expect(plain).not.toContain('Clear filter');
    const noHandler = renderToStaticMarkup(<AdminFilterChips chips={chips} value="live" onChange={() => {}} />);
    expect(noHandler).not.toContain('Clear filter');
  });

  it('calls onChange with the chip key', () => {
    const onChange = vi.fn();
    const tree = AdminFilterChips({ chips, value: 'all', onChange });
    // The first button in the group is the "All" chip.
    const click = findProp(tree, 'onClick');
    click?.();
    expect(onChange).toHaveBeenCalledWith('all');
  });
});

describe('AdminError, AdminEmpty and AdminLoading', () => {
  it('is an alert that names what failed and retries on tap', () => {
    const onRetry = vi.fn();
    const tree = AdminError({ what: 'the applications', onRetry });
    findProp(tree, 'onClick')?.();
    expect(onRetry).toHaveBeenCalledTimes(1);
    const html = renderToStaticMarkup(<AdminError what="the applications" onRetry={onRetry} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('The applications did not load.');
    expect(html).toContain('Try again');
    expect(html).toContain('min-h-10');
    expect(html).not.toMatch(/nothing (is )?waiting|no .* yet/i);
  });

  it('builds a clean sentence', () => {
    expect(errorSentence('the teachers.')).toBe('The teachers did not load.');
    expect(errorSentence('  ')).toBe('This did not load.');
  });

  it('empty says why and offers a next step', () => {
    const onClick = vi.fn();
    const html = renderToStaticMarkup(<AdminEmpty title="No papers in this view." hint="Try another view." action={{ label: 'Show all papers', onClick }} />);
    expect(html).toContain('No papers in this view.');
    expect(html).toContain('Show all papers');
    expect(html).not.toContain('role="alert"');
  });

  it('loading is a status, one skeleton per shape', () => {
    for (const shape of ['table', 'tiles', 'cards', 'rows'] as const) {
      const html = renderToStaticMarkup(<AdminLoading shape={shape} label="Loading x" />);
      expect(html, shape).toContain('role="status"');
      expect(html, shape).toContain('animate-pulse');
    }
    expect(renderToStaticMarkup(<AdminLoading rows={2} />).match(/h-14/g)?.length).toBe(2);
  });
});

describe('AdminPillButton', () => {
  it('builds four variants and two sizes, with 44px and 40px floors', () => {
    expect(adminPillClass('primary', 'md')).toContain('bg-panel');
    expect(adminPillClass('primary', 'md')).toContain('min-h-11');
    expect(adminPillClass('secondary', 'sm')).toContain('min-h-10');
    expect(adminPillClass('secondary', 'sm')).not.toContain('min-h-11');
    expect(adminPillClass('destructive')).toContain('text-destructive');
    expect(adminPillClass('quiet')).toContain('bg-transparent');
  });
  it('disables itself while busy', () => {
    const html = renderToStaticMarkup(<AdminPillButton busy>Save</AdminPillButton>);
    expect(html).toContain('disabled');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('type="button"');
  });
  it('has no glued class names', () => {
    for (const v of ['primary', 'secondary', 'quiet', 'destructive'] as const) expect(adminPillClass(v)).not.toMatch(/min-h-\d+[a-z]/);
  });
});

describe('use-remembered-open', () => {
  const fake = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('opens on the first visit, then stays closed', () => {
    const s = fake();
    expect(readRememberedOpen('p', s)).toBe(true);
    expect(readRememberedOpen('p', s)).toBe(false);
  });
  it('remembers what the admin left it as', () => {
    const s = fake();
    readRememberedOpen('p', s);
    writeRememberedOpen('p', true, s);
    expect(readRememberedOpen('p', s)).toBe(true);
    writeRememberedOpen('p', false, s);
    expect(readRememberedOpen('p', s)).toBe(false);
  });
  it('renders and does not throw when storage is missing or throws', () => {
    expect(readRememberedOpen('p', null)).toBe(true);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readRememberedOpen('p', broken)).toBe(true);
    expect(() => writeRememberedOpen('p', true, broken)).not.toThrow();
  });
});

describe('shell badges', () => {
  const nav = buildAdminNav('teachers');
  const item = (key: string) => nav.find((n) => n.key === key)!;

  it('shows the teachers tab a number, nothing for zero, and ? for an unreadable count', () => {
    expect(navBadge(item('teachers'), state({ counts: { approvals: 4, reviews: 2 } }))).toEqual({ kind: 'n', n: 6 });
    expect(navBadge(item('teachers'), state({ counts: { approvals: 0, reviews: 0 } }))).toBeNull();
    expect(navBadge(item('teachers'), state({ status: 'error', failed: ['approvals', 'reviews'] }))).toEqual({ kind: 'unknown' });
    expect(navBadge(item('teachers'), state({ status: 'loading' }))).toBeNull(); // still loading: quiet
  });

  it('a real number beats a ? for the other half of the same tab', () => {
    expect(navBadge(item('teachers'), state({ status: 'partial', counts: { approvals: 3 }, failed: ['reviews'] }))).toEqual({ kind: 'n', n: 3 });
  });

  it('has no badge on the tabs that count nothing', () => {
    const counts = { paperApprovals: 6, adminQueue: 41, submissions: 3, approvals: 4, reviews: 2 };
    for (const key of ['people', 'logs', 'system']) expect(navBadge(item(key), state({ counts })), key).toBeNull();
  });

  it('lets a page override the shared count', () => {
    expect(navBadge({ key: 'teachers', count: 9 }, state({ counts: { approvals: 1 } }))).toEqual({ kind: 'n', n: 9 });
    expect(navBadge({ key: 'teachers', count: 0 }, state({ counts: { approvals: 1 } }))).toBeNull();
  });

  it('buildAdminNav adds the two teacher counts a page passes in', () => {
    expect(buildAdminNav('teachers', { approvals: 12, reviews: 4 }).find((n) => n.key === 'teachers')?.count).toBe(16);
    expect(buildAdminNav('teachers').find((n) => n.key === 'teachers')?.count).toBeUndefined();
  });

  it('puts every paper queue on the HOD desk chip, and no tab', () => {
    const counts = { paperApprovals: 6, adminQueue: 41, submissions: 3, approvals: 4, reviews: 2 };
    expect(hodBadge(state({ counts }))).toEqual({ kind: 'n', n: 50 });
    expect(hodBadge(state({ counts: { paperApprovals: 0, adminQueue: 0, submissions: 0 } }))).toBeNull();
    expect(hodBadge(state({ status: 'error', failed: ['paperApprovals', 'adminQueue', 'submissions'] }))).toEqual({ kind: 'unknown' });
  });

  const render = (counts: AdminCountsState, active: Parameters<typeof buildAdminNav>[0] = 'teachers') =>
    renderToStaticMarkup(
      <StaticRouter location="/">
        <AdminHeaderView nav={buildAdminNav(active)} signedInEmail="staff@example.com" counts={counts} />
      </StaticRouter>,
    );

  it('renders the four tabs as links, a ? badge and a Retry button when counts failed', () => {
    const refetch = vi.fn();
    const html = render(state({ status: 'partial', failed: ['reviews'], counts: { paperApprovals: 2 }, refetch }));
    for (const label of ['People', 'Teachers', 'Logs', 'System']) expect(html).toContain(`>${label}`);
    for (const gone of ['Needs you', 'Papers', 'Library', 'Admin queue', 'Student uploads']) expect(html, gone).not.toContain(`>${gone}`);
    expect(html).toContain('href="/admin?tab=people"');
    expect(html).toContain('Counts unavailable. Retry');
    expect(html).toContain('count unavailable');
    expect(html).not.toContain('>0<');
  });

  it('marks the tab of the page as current, and none for a page that moved to the HOD desk', () => {
    expect(render(state({}), 'activity')).toMatch(/aria-current="page"[^>]*>Logs/);
    expect(render(state({}), 'library')).not.toContain('aria-current');
  });

  it('has no Retry button when every count was read', () => {
    const html = render(state({ counts: { paperApprovals: 2 } }));
    expect(html).not.toContain('Counts unavailable');
  });

  it('the Retry button calls refetch', () => {
    const refetch = vi.fn();
    findProp(CountsRetry({ onRetry: refetch }), 'onClick')?.();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('links to the HOD desk with what is waiting there', () => {
    const html = render(state({ counts: { paperApprovals: 2, adminQueue: 3, submissions: 1 } }));
    expect(html).toContain('href="/hod"');
    expect(html).toMatch(/HOD desk[\s\S]*>6<span class="sr-only"> waiting/);
  });

  it('has an account menu with the first letter of the email', () => {
    const html = render(state({}));
    expect(html).toContain('aria-label="Account menu for staff@example.com"');
    expect(html).toContain('>S</button>');
  });
});

describe('AdminTable additions are off by default', () => {
  const columns = [{ key: 'a', label: 'A', width: '1fr' }, { key: 'b', label: 'B', width: '1fr', wrap: true }];
  const rows = [{ id: '1', cells: ['Long name here', 'Maths, Physics, English and more'] }];
  const render = (extra: Partial<Parameters<typeof AdminTable>[0]> = {}, rowExtra = {}) =>
    renderToStaticMarkup(
      <StaticRouter location="/">
        <AdminTable columns={columns} rows={[{ ...rows[0], ...rowExtra }]} {...extra} />
      </StaticRouter>,
    );

  it('wraps only a column that asks, and puts string cells in a title', () => {
    const html = render();
    expect(html).toContain('line-clamp-2');
    expect(html).toContain('title="Maths, Physics, English and more"');
    expect(html).toContain('title="Long name here"');
    expect(html.match(/truncate/g)?.length).toBeGreaterThan(0);
  });

  it('adds no link or chevron unless a row has an href', () => {
    expect(render()).not.toContain('<a ');
    const linked = render({}, { href: '/admin/x' });
    expect(linked).toContain('href="/admin/x"');
    expect(linked).toContain('lucide-chevron-right');
  });

  it('names the row after each action, for screen readers only', () => {
    const acts = [{ label: 'Edit', tone: 'primary' as const, onClick: () => {} }];
    const html = renderToStaticMarkup(<AdminRowActions actions={acts} subject="Ananya Roy" />);
    expect(html).toContain('Edit<span class="sr-only"> Ananya Roy</span>');
    expect(renderToStaticMarkup(<AdminRowActions actions={acts} />)).not.toContain('sr-only');
    expect(rowSubject({ cells: ['Ananya Roy', 'x'] })).toBe('Ananya Roy');
    expect(rowSubject({ subject: 'Chosen', cells: ['Other'] })).toBe('Chosen');
    expect(rowSubject({ cells: [<b key="a">node</b>] })).toBeUndefined();
    expect(rowSubject({ cells: ['x'.repeat(100)] })?.length).toBe(60);
  });

  it('stacks row actions only when asked', () => {
    const acts = [{ label: 'Approve', tone: 'primary' as const, onClick: () => {} }];
    expect(renderToStaticMarkup(<AdminRowActions actions={acts} />)).not.toContain('flex-wrap');
    expect(renderToStaticMarkup(<AdminRowActions actions={acts} stack />)).toContain('flex-wrap');
  });

  it('draws status colours from tokens, not hex', () => {
    for (const s of ['live', 'pending', 'paused', 'hidden'] as const) {
      expect(renderToStaticMarkup(<AdminStatusPill status={s} />), s).not.toMatch(/#[0-9A-Fa-f]{3,6}/);
    }
  });

  it('puts a subtitle and the one action in the panel header', () => {
    const html = renderToStaticMarkup(<AdminPanelHeader title="T" subtitle="What it holds" action={<button type="button">Do it</button>} />);
    expect(html).toContain('What it holds');
    expect(html).toContain('Do it');
    expect(renderToStaticMarkup(<AdminPanelHeader title="T" />)).not.toContain('<p');
  });
});

describe('the admin guard does not bounce a signed-in admin on a cold load', () => {
  const someone = { id: 'u1' } as unknown as User;
  it('waits while the saved session is still being restored', () => {
    expect(adminGuardStep(null, true)).toBe('wait');
    expect(adminGuardStep(undefined, true)).toBe('wait');
  });
  it('only treats nobody as signed out once the restore has finished', () => {
    expect(adminGuardStep(null, false)).toBe('signed-out');
  });
  it('checks the admin list for any user it has, loading or not', () => {
    expect(adminGuardStep(someone, true)).toBe('check');
    expect(adminGuardStep(someone, false)).toBe('check');
  });
});
