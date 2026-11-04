import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { ADMIN_PAGES, ADMIN_TABS, adminHref } from '@/lib/admin-hints';
import { buildAdminNav, isAdminPath } from '@/pages/admin/shell';
import { LEGACY_ADMIN_PATHS, legacyAdminTarget } from '@/pages/admin/legacy-routes';
import { SECTION_BODY } from '@/pages/admin/sections';

/* The admin menu is four tabs, and every address that ever led somewhere in the
   admin still leads somewhere. The routes are read straight from App.tsx, so
   renaming a route without the menu fails here. */

const app = readFileSync('src/App.tsx', 'utf8');
const routes = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
const element = (path: string) => new RegExp('^' + path.replace(/:[^/]+/g, '[^/]+') + '$');
const matches = (href: string) => routes.some((r) => element(r).test(href.split(/[?#]/)[0]));

describe('admin menu', () => {
  const nav = buildAdminNav('people');

  it('reads routes from App.tsx', () => {
    expect(routes).toContain('/admin');
    expect(routes.length).toBeGreaterThan(30);
  });

  it('is four tabs: People, Teachers, Logs, System', () => {
    expect(nav.map((n) => n.label)).toEqual(['People', 'Teachers', 'Logs', 'System']);
    expect(nav.filter((n) => n.active).map((n) => n.key)).toEqual(['people']);
  });

  it('every tab goes to /admin, a real route that is not a redirect', () => {
    expect(app).toMatch(/<Route\s+path="\/admin"\s+element=\{<AdminHome\s*\/>\}/);
    for (const item of nav) {
      expect(isAdminPath(item.path), item.path).toBe(true);
      expect(matches(item.path), `${item.label} -> ${item.path}`).toBe(true);
      expect(item.path).toBe(adminHref(item.key));
    }
  });

  it('every section has a body, and every body belongs to a section', () => {
    const sections = ADMIN_TABS.flatMap((t) => t.sections.map((s) => s.key));
    expect(Object.keys(SECTION_BODY).sort()).toEqual([...sections].sort());
  });

  it('shows a page that moved to the HOD desk under no tab', () => {
    expect(buildAdminNav('library').some((n) => n.active)).toBe(false);
    expect(buildAdminNav('audit').filter((n) => n.active).map((n) => n.key)).toEqual(['logs']);
    expect(buildAdminNav('logs').filter((n) => n.active).map((n) => n.key)).toEqual(['logs']);
  });

  it('keeps no admin page of its own except the ones a list row opens', () => {
    const own = routes.filter((r) => r.startsWith('/admin') && !r.startsWith('/admin?'));
    const children = ['/admin', '/admin/library/:paperId', '/admin/paper-review/:paperId', '/admin/paper-approvals/:auditPaperId', '/admin/checker-log/:actorKey'];
    const redirecting = own.filter((r) => !children.includes(r));
    // Every other /admin address is an old one, and sends the visitor on.
    for (const r of redirecting) {
      expect(app, `${r} must redirect`).toMatch(new RegExp(`<Route\\s+path="${r}"\\s+element=\\{<LegacyAdminRedirect\\s*/>`));
      expect(LEGACY_ADMIN_PATHS[r], `${r} must be in legacy-routes.tsx`).toBeDefined();
    }
  });
});

describe('every old admin address still works', () => {
  it('has a route for every address in the legacy table', () => {
    for (const path of Object.keys(LEGACY_ADMIN_PATHS)) {
      expect(routes, `${path} has no route`).toContain(path);
      expect(app).toMatch(new RegExp(`<Route\\s+path="${path}"\\s+element=\\{<LegacyAdminRedirect\\s*/>`));
    }
  });

  it('sends each to a section of the Admin page, or to a tab of the HOD desk', () => {
    for (const path of Object.keys(LEGACY_ADMIN_PATHS)) {
      const to = legacyAdminTarget(path, '');
      expect(to, path).not.toBeNull();
      expect(to, path).toMatch(/^\/(admin\?tab=(people|teachers|logs|system)&section=[a-z-]+|hod\?tab=(needs-you|ready|uploads|live))$/);
      expect(matches(to as string), `${path} -> ${to}`).toBe(true);
    }
  });

  it('sends the paper pages to the HOD desk tabs', () => {
    expect(legacyAdminTarget('/admin/admin-queue', '')).toBe('/hod?tab=needs-you');
    expect(legacyAdminTarget('/admin/paper-approvals', '')).toBe('/hod?tab=ready');
    expect(legacyAdminTarget('/admin/papers', '')).toBe('/hod?tab=uploads');
    expect(legacyAdminTarget('/admin/library', '')).toBe('/hod?tab=live');
    expect(legacyAdminTarget('/admin/paper-review', '')).toBe('/hod?tab=live');
    expect(legacyAdminTarget('/admin/uploads', '')).toBe('/hod?tab=uploads');
    expect(legacyAdminTarget('/admin/queue', '')).toBe('/hod?tab=needs-you');
    expect(legacyAdminTarget('/admin/needs-you', '')).toBe('/hod?tab=needs-you');
  });

  it('sends the people, teacher, log and system pages to their section', () => {
    expect(legacyAdminTarget('/admin/teachers', '')).toBe('/admin?tab=teachers&section=listed');
    expect(legacyAdminTarget('/admin/approvals', '')).toBe('/admin?tab=teachers&section=applications');
    expect(legacyAdminTarget('/admin/applications', '')).toBe('/admin?tab=teachers&section=applications');
    for (const old of ['/admin/recommendations', '/admin/comments', '/admin/upvotes']) {
      expect(legacyAdminTarget(old, '')).toBe('/admin?tab=teachers&section=reviews');
    }
    expect(legacyAdminTarget('/admin/audit', '')).toBe('/admin?tab=logs&section=admin-actions');
    expect(legacyAdminTarget('/admin/pipeline', '')).toBe('/admin?tab=system&section=pipeline');
    expect(legacyAdminTarget('/admin/feedback', '')).toBe('/admin?tab=system&section=feedback');
    expect(legacyAdminTarget('/admin/team', '')).toBe('/admin?tab=people&section=progress');
    expect(legacyAdminTarget('/admin/checkers', '')).toBe('/admin?tab=people&section=verifiers');
  });

  it('keeps the filters and the dummy switch that came with the old address', () => {
    expect(legacyAdminTarget('/admin/approvals', '?status=approved')).toBe('/admin?tab=teachers&section=applications&status=approved');
    expect(legacyAdminTarget('/admin/audit', '?dummy=1')).toBe('/admin?tab=logs&section=admin-actions&dummy=1');
  });

  it('translates the two old filters whose names changed', () => {
    expect(legacyAdminTarget('/admin/checkers', '?view=hods')).toBe('/admin?tab=people&section=hods');
    expect(legacyAdminTarget('/admin/reviews', '?tab=recommendations')).toBe('/admin?tab=teachers&section=reviews&source=recommendations');
  });

  it('ignores a trailing slash and knows nothing of an address that was never there', () => {
    expect(legacyAdminTarget('/admin/audit/', '')).toBe('/admin?tab=logs&section=admin-actions');
    expect(legacyAdminTarget('/admin/nonsense', '')).toBeNull();
  });

  it('never points a page at somewhere its own copy does not say', () => {
    for (const [path, page] of Object.entries(LEGACY_ADMIN_PATHS)) expect(legacyAdminTarget(path, ''), path).toBe(ADMIN_PAGES[page].path);
  });
});
