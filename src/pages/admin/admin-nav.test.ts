import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { ADMIN_GROUPS, ADMIN_PAGES, PAGE_ORDER } from '@/lib/admin-hints';
import { buildAdminNav, groupLandingPath, isAdminPath } from '@/pages/admin/shell';

/* Every link in the admin menu must land on a real route. The routes are read
   straight from App.tsx, so renaming a route without the menu fails here. */

const app = readFileSync('src/App.tsx', 'utf8');
const routes = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
const element = (path: string) => new RegExp('^' + path.replace(/:[^/]+/g, '[^/]+') + '$');
const matches = (href: string) => routes.some((r) => element(r).test(href));
const redirects = [...app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<Navigate/g)].map((m) => m[1]);

describe('admin menu', () => {
  const nav = buildAdminNav('library');

  it('reads routes from App.tsx', () => {
    expect(routes).toContain('/admin/library');
    expect(routes.length).toBeGreaterThan(30);
  });

  it('every menu entry goes to a real route that is not a redirect', () => {
    for (const item of nav) {
      expect(matches(item.path), `${item.label} -> ${item.path}`).toBe(true);
      expect(redirects, `${item.label} -> ${item.path} is only a redirect`).not.toContain(item.path);
    }
  });

  it('every page key is in exactly one group', () => {
    const grouped = ADMIN_GROUPS.flatMap((g) => g.pages);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(grouped.sort()).toEqual(Object.keys(ADMIN_PAGES).sort());
    expect(PAGE_ORDER.length).toBe(grouped.length);
  });

  it('every real admin page is in the menu or is a child of one that is', () => {
    const inMenu = new Set(nav.map((n) => n.path));
    // Child pages: reached from their parent's list, each with its own back link.
    const children: Record<string, string> = {
      '/admin/library/:paperId': '/admin/library',
      '/admin/paper-approvals/:auditPaperId': '/admin/paper-approvals',
      '/admin/checker-log/:actorKey': '/admin/checker-log',
      // Old bookmark, redirects to the Library page of that paper.
      '/admin/paper-review/:paperId': '/admin/library',
    };
    // '/admin' is no longer a redirect: it is a menu item ("Needs you now").
    const redirectsOrRoot = new Set(redirects);
    for (const r of routes.filter((x) => x.startsWith('/admin'))) {
      if (redirectsOrRoot.has(r)) continue;
      if (inMenu.has(r)) continue;
      expect(children[r], `${r} is neither in the menu nor a known child page`).toBeDefined();
      expect(inMenu.has(children[r]), `${r} parent ${children[r]} must be in the menu`).toBe(true);
    }
  });

  it('a group tab never leads outside the admin when an admin page exists in it', () => {
    for (const g of ADMIN_GROUPS) {
      const target = groupLandingPath(nav, g.key);
      expect(isAdminPath(target), `${g.label} -> ${target}`).toBe(true);
    }
  });

  it('has the six groups in this order, with these pages in this order', () => {
    expect(ADMIN_GROUPS.map((g) => [g.key, g.pages])).toEqual([
      ['now', ['now']],
      ['papers', ['ready', 'admin-queue', 'submissions', 'library']],
      ['people', ['checkers', 'team', 'hod', 'student-queue']],
      ['teachers', ['applications', 'reviews', 'teachers']],
      ['logs', ['activity', 'checker-log', 'audit']],
      ['system', ['pipeline', 'feedback']],
    ]);
  });

  it('makes /admin a menu item and a real route, not a redirect', () => {
    expect(nav.find((n) => n.path === '/admin')?.key).toBe('now');
    expect(routes).toContain('/admin');
    expect(redirects).not.toContain('/admin');
  });

  it('keeps every old address working: each legacy path still redirects', () => {
    const LEGACY: [string, string][] = [
      ['/admin/applications', '/admin/approvals'],
      ['/admin/recommendations', '/admin/reviews'],
      ['/admin/comments', '/admin/reviews'],
      ['/admin/upvotes', '/admin/reviews'],
      ['/admin/paper-review', '/admin/library'],
    ];
    for (const [from, to] of LEGACY) {
      const m = new RegExp(`<Route\\s+path="${from}"\\s+element=\\{<Navigate\\s+to="${to}"`).exec(app);
      expect(m, `${from} must still redirect to ${to}`).not.toBeNull();
    }
    // The one with a parameter goes through a small component that keeps the id.
    expect(app).toMatch(/<Route\s+path="\/admin\/paper-review\/:paperId"\s+element=\{<LegacyPaperReviewRedirect/);
    expect(app).toContain('/admin/library/${paperId');
  });

  it('puts every link that leaves the admin after the pages inside it', () => {
    // The plan says "at most one outside link per group", but it also puts both
    // the HOD desk and the student screen in People. The rule that holds for
    // both: outside links trail the group, never sit between admin pages.
    for (const g of ADMIN_GROUPS) {
      const items = nav.filter((n) => n.group === g.key);
      const firstOutside = items.findIndex((n) => !isAdminPath(n.path));
      if (firstOutside === -1) continue;
      for (const n of items.slice(firstOutside)) expect(isAdminPath(n.path), `${n.label} is inside the admin but follows an outside link`).toBe(false);
    }
    expect(nav.filter((n) => !isAdminPath(n.path)).map((n) => n.key)).toEqual(['hod', 'student-queue']);
  });
});
