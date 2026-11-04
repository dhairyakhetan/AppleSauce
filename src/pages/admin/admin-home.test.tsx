import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() } },
}));
vi.mock('@/lib/admin-debug', () => ({
  useAdminDebugToggle: () => ({ on: false, canToggle: false, toggle: () => {} }),
  useAdminDebugOn: () => false,
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: null, profile: null, loading: false }),
  useAuthLoading: () => false,
}));

import { AdminHomePage } from '@/pages/admin/index';
import { AdminEmbedProvider, AdminStack, useAdminEmbedded } from '@/pages/admin/embed';
import { AdminAuditNote, AdminHeader, buildAdminNav } from '@/pages/admin/shell';
import { AdminPageIntro, AdminPageIntroPanel } from '@/components/admin/AdminHelp';
import { SECTION_BODY } from '@/pages/admin/sections';
import { resolveSection, resolveTab, sectionBadge, tabSearch, tabSummary } from '@/pages/admin/home-logic';
import { ADMIN_TABS } from '@/lib/admin-hints';
import type { AdminCountsState } from '@/pages/admin/useAdminSectionCounts';

/* No jsdom here, so these render to markup. The Admin page is drawn in dummy
   mode (no sign-in, no admin check) with the counts handed in. */

const state = (o: Partial<AdminCountsState> = {}): AdminCountsState => ({ counts: {}, status: 'ok', failed: [], refetch: () => {}, ...o });
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

const page = (location: string, counts: AdminCountsState = state({ counts: { approvals: 4, reviews: 2, paperApprovals: 1, adminQueue: 5, submissions: 3 } })) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <StaticRouter location={location}>
        <AdminHomePage dummy counts={counts} />
      </StaticRouter>
    </QueryClientProvider>,
  );

describe('which tab and section an address means', () => {
  it('opens the first tab for no tab, or one that is not there', () => {
    expect(resolveTab(null).key).toBe('people');
    expect(resolveTab('papers').key).toBe('people');
    expect(resolveTab('logs').key).toBe('logs');
  });

  it('opens the first section of the tab for no section, or one that belongs to another tab', () => {
    const logs = resolveTab('logs');
    expect(resolveSection(logs, null).key).toBe('question-changes');
    expect(resolveSection(logs, 'verifiers').key).toBe('question-changes');
    expect(resolveSection(logs, 'admin-actions').key).toBe('admin-actions');
  });

  it('keeps only the tab when the tab changes', () => {
    expect(tabSearch('system')).toBe('?tab=system');
  });
});

describe('the line under the tabs', () => {
  const teachers = ADMIN_TABS.find((t) => t.key === 'teachers')!;
  const people = ADMIN_TABS.find((t) => t.key === 'people')!;

  it('says what the tab is for, in one sentence, on every tab', () => {
    for (const t of ADMIN_TABS) expect(tabSummary(t, state()), t.key).toContain(t.summary);
  });

  it('adds what is waiting on the Teachers tab, from the live counts', () => {
    expect(tabSummary(teachers, state({ counts: { approvals: 4, reviews: 2 } }))).toContain('Waiting for you: 4 applications and 2 reviews.');
    expect(tabSummary(teachers, state({ counts: { approvals: 1, reviews: 0 } }))).toContain('Waiting for you: 1 application.');
    expect(tabSummary(teachers, state({ counts: { approvals: 0, reviews: 3 } }))).toContain('Waiting for you: 3 reviews.');
  });

  it('says nothing is waiting only when both counts were read and are 0', () => {
    expect(tabSummary(teachers, state({ counts: { approvals: 0, reviews: 0 } }))).toContain('Nothing is waiting right now.');
    const half = tabSummary(teachers, state({ status: 'partial', counts: { approvals: 0 }, failed: ['reviews'] }));
    expect(half).not.toContain('Nothing is waiting');
    expect(half).toBe(teachers.summary);
    expect(tabSummary(teachers, state({ status: 'loading' }))).toBe(teachers.summary);
  });

  it('adds nothing to the other tabs', () => {
    expect(tabSummary(people, state({ counts: { approvals: 4 } }))).toBe(people.summary);
  });

  it('puts a count on the Applications and Reviews sections only', () => {
    const s = state({ counts: { approvals: 4, reviews: 0 } });
    expect(sectionBadge('applications', s)).toEqual({ kind: 'n', n: 4 });
    expect(sectionBadge('reviews', s)).toBeNull();
    expect(sectionBadge('listed', s)).toBeNull();
    expect(sectionBadge('reviews', state({ status: 'partial', failed: ['reviews'] }))).toEqual({ kind: 'unknown' });
  });
});

describe('the Admin page', () => {
  it('is laid out like the HOD desk: a tablist of four, the open tab selected, tab and panel linked', () => {
    const html = page('/admin?tab=teachers');
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)?.length).toBe(4);
    expect(html).toMatch(/id="admin-tab-teachers"[^>]*aria-selected="true"/);
    expect(html).toMatch(/id="admin-tab-people"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-labelledby="admin-tab-teachers"');
    expect(html).toContain('aria-controls="admin-panel"');
    expect(html).toContain('id="admin-panel"');
  });

  it('opens on People when no tab is asked for', () => {
    const html = page('/admin');
    expect(html).toMatch(/id="admin-tab-people"[^>]*aria-selected="true"/);
    for (const label of ['Verifiers', 'HODs', 'Teacher reviewers', 'Progress']) expect(text(html)).toContain(label);
  });

  it('shows the four tabs and none of the old groups', () => {
    const html = text(page('/admin'));
    for (const label of ['People', 'Teachers', 'Logs', 'System']) expect(html).toContain(label);
    for (const gone of ['Needs you now', 'Admin queue', 'Student uploads', 'Ready to go live', 'Map of the admin']) expect(html, gone).not.toContain(gone);
  });

  it('puts what is waiting in a number on the Teachers tab and the sentence under the tabs', () => {
    const html = page('/admin?tab=teachers');
    expect(text(html)).toContain('Waiting for you: 4 applications and 2 reviews.');
    expect(html).toMatch(/Teachers[\s\S]*?>6<span class="sr-only"> waiting/);
  });

  it('shows the sections of the open tab as links, the open one current, with their counts', () => {
    const html = page('/admin?tab=teachers&section=reviews');
    expect(html).toContain('aria-label="Teachers parts"');
    expect(html).toMatch(/href="\/admin\?tab=teachers&amp;section=applications"/);
    expect(html).toMatch(/aria-current="page"[^>]*>Reviews/);
    expect(html).toMatch(/Applications[\s\S]*?>4<span class="sr-only"> waiting/);
  });

  it('says what the open section is for, once, with Help', () => {
    const html = page('/admin?tab=logs&section=admin-actions');
    expect(text(html)).toContain('A record of every change an admin made, with who and when.');
    expect(html).toContain('aria-label="About this page"');
    expect(html.match(/aria-label="About this page"/g)?.length).toBe(1);
  });

  it('keeps the HOD desk one tap away, with the paper queues counted on it', () => {
    const html = page('/admin');
    expect(html).toContain('href="/hod"');
    expect(html).toMatch(/HOD desk[\s\S]*?>9<span class="sr-only"> waiting/);
  });

  it('shows a ? and a Retry for a count it could not read, never a 0', () => {
    const html = page('/admin?tab=teachers', state({ status: 'error', failed: ['paperApprovals', 'adminQueue', 'submissions', 'approvals', 'reviews'] }));
    expect(html).toContain('Counts unavailable. Retry');
    expect(html).toContain('count unavailable');
    expect(text(html)).not.toContain('Nothing is waiting');
  });

  it('ends with the audit note, except on the audit log itself', () => {
    expect(page('/admin?tab=people')).toContain('Open audit log');
    expect(page('/admin?tab=logs&section=admin-actions')).not.toContain('Open audit log');
  });

  it('has one h1', () => {
    expect(page('/admin').match(/<h1/g)?.length).toBe(1);
  });
});

describe('a page drawn inside a section', () => {
  const inside = (el: React.ReactElement) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <StaticRouter location="/admin">
          <AdminEmbedProvider>{el}</AdminEmbedProvider>
        </StaticRouter>
      </QueryClientProvider>,
    );
  const alone = (el: React.ReactElement) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <StaticRouter location="/admin">{el}</StaticRouter>
      </QueryClientProvider>,
    );

  it('draws no header, no audit note and no help strip of its own', () => {
    const nav = buildAdminNav('audit');
    expect(inside(<AdminHeader nav={nav} signedInEmail="a@b.c" counts={state()} />)).toBe('');
    expect(inside(<AdminAuditNote />)).toBe('');
    expect(inside(<AdminPageIntro page="audit" />)).toBe('');
    expect(inside(<AdminPageIntroPanel page="audit" />)).toBe('');
  });

  it('draws all of them when it stands on its own address', () => {
    const nav = buildAdminNav('audit');
    expect(alone(<AdminHeader nav={nav} signedInEmail="a@b.c" counts={state()} />)).toContain('Account menu for a@b.c');
    expect(alone(<AdminAuditNote />)).toContain('Open audit log');
    expect(alone(<AdminPageIntro page="audit" />)).toContain('About this page');
  });

  it('drops the full-height wrapper inside a section, and keeps it on its own', () => {
    expect(inside(<AdminStack>x</AdminStack>)).not.toContain('min-h-screen');
    expect(alone(<AdminStack>x</AdminStack>)).toContain('min-h-screen');
  });

  it('knows whether it is inside', () => {
    const Probe = () => <i>{String(useAdminEmbedded())}</i>;
    expect(inside(<Probe />)).toBe('<i>true</i>');
    expect(alone(<Probe />)).toBe('<i>false</i>');
  });
});

describe('every section page is built to sit inside a tab', () => {
  const pagesDir = 'src/pages/admin/';
  const files = ['approvals', 'reviews', 'teachers', 'activity', 'checker-log', 'audit', 'pipeline', 'feedback', 'team', 'checkers'];

  it('wraps itself in AdminStack, not a full-height stack of its own', () => {
    for (const f of files) {
      const src = readFileSync(`${pagesDir}${f}.tsx`, 'utf8');
      expect(src, f).toContain('<AdminStack>');
      expect(src, f).not.toContain('min-h-screen bg-muted');
    }
  });

  it('is reached through SECTION_BODY, which holds a body for every section', () => {
    expect(Object.keys(SECTION_BODY)).toHaveLength(ADMIN_TABS.flatMap((t) => t.sections).length);
  });

  it('keeps ?tab= for the Admin page: the reviews list uses ?source=', () => {
    const src = readFileSync(`${pagesDir}reviews.tsx`, 'utf8');
    expect(src).toContain("searchParams.get('source')");
    expect(src).not.toContain("searchParams.get('tab')");
  });
});

describe('copy', () => {
  it('has no em or en dashes in the new admin files', () => {
    for (const f of ['index.tsx', 'shell.tsx', 'embed.tsx', 'sections.tsx', 'home-logic.ts', 'legacy-routes.tsx']) {
      expect(readFileSync(`src/pages/admin/${f}`, 'utf8'), f).not.toMatch(/[–—]/);
    }
  });
});
