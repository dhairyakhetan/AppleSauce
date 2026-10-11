import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { ADMIN_HOME, CHECKER_HOME, HOD_HOME, TEACHER_REVIEW_HOME, TEAMS, homeFor, roleGroups, roleLinks, type Roles } from '@/lib/role-home';
import { LINK_ICON, TEAM_STYLE } from '@/components/layout/team-style';
import { ADMIN_GROUPS } from '@/lib/admin-hints';
import { buildAdminNav } from '@/pages/admin/shell';

/* Each role lands on one home, and every link the roles are given resolves to
   a real route (read from App.tsx, so renaming a route fails here). */

const app = readFileSync('src/App.tsx', 'utf8');
const routes = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
const matches = (href: string) => routes.some((r) => new RegExp('^' + r.replace(/:[^/]+/g, '[^/]+') + '$').test(href.split(/[?#]/)[0]));

const none: Roles = { isAdmin: false, isHod: false, isChecker: false, isTeacherReviewer: false };
const only = (over: Partial<Roles>): Roles => ({ ...none, ...over });
/** An admin is also an HOD, a checker and a reviewer, because the database functions say so. */
const admin: Roles = { isAdmin: true, isHod: true, isChecker: true, isTeacherReviewer: true };

describe('role home', () => {
  it('sends each role to its own home, admin first', () => {
    expect(homeFor(only({ isChecker: true }))).toBe('/checker');
    expect(homeFor(only({ isHod: true, isChecker: true }))).toBe('/hod');
    expect(homeFor(admin)).toBe('/admin');
    expect(homeFor(only({ isTeacherReviewer: true }))).toBe('/teacher-review');
    expect(homeFor(only({ isChecker: true, isTeacherReviewer: true }))).toBe('/checker');
    expect(homeFor(none)).toBeNull();
  });

  it('offers one account menu link per role, in team order', () => {
    expect(roleLinks(none)).toEqual([]);
    expect(roleLinks(only({ isChecker: true })).map((l) => l.label)).toEqual(['Verify papers']);
    expect(roleLinks(only({ isHod: true })).map((l) => l.label)).toEqual(['HOD desk']);
    expect(roleLinks(only({ isTeacherReviewer: true })).map((l) => l.label)).toEqual(['Review teachers']);
    expect(roleLinks(admin).map((l) => l.label)).toEqual(['Verify papers', 'HOD desk', 'Review teachers', 'Admin']);
  });

  it('every home and menu link is a real route', () => {
    for (const to of [ADMIN_HOME, HOD_HOME, CHECKER_HOME, TEACHER_REVIEW_HOME]) expect(matches(to), to).toBe(true);
    for (const l of roleLinks(admin)) expect(matches(l.to), l.to).toBe(true);
  });
});

describe('account menu by team', () => {
  const labels = (r: Roles) => roleGroups(r).map((g) => g.label);

  it('shows only the teams the person belongs to, each with its own label', () => {
    expect(roleGroups(none)).toEqual([]);
    expect(labels(only({ isChecker: true }))).toEqual(['Papers team']);
    expect(labels(only({ isHod: true }))).toEqual(['Papers team']);
    expect(labels(only({ isTeacherReviewer: true }))).toEqual(['Teachers team']);
    expect(labels(only({ isAdmin: true }))).toEqual(['Admin team']);
    expect(labels(only({ isChecker: true, isTeacherReviewer: true }))).toEqual(['Papers team', 'Teachers team']);
    expect(labels(admin)).toEqual(['Papers team', 'Teachers team', 'Admin team']);
  });

  it('puts the verify and HOD links together under the papers team, the reviewer link under teachers', () => {
    const g = roleGroups(admin);
    expect(g[0].links.map((l) => l.label)).toEqual(['Verify papers', 'HOD desk']);
    expect(g[1].links.map((l) => l.label)).toEqual(['Review teachers']);
    expect(g[2].links.map((l) => l.label)).toEqual(['Admin']);
  });

  it('a section label never appears without a link under it, for every mix of roles', () => {
    const bools = [false, true];
    for (const isAdmin of bools) for (const isHod of bools) for (const isChecker of bools) for (const isTeacherReviewer of bools) {
      const r: Roles = { isAdmin, isHod, isChecker, isTeacherReviewer };
      for (const g of roleGroups(r)) expect(g.links.length, JSON.stringify(r)).toBeGreaterThan(0);
      expect(roleGroups(r).flatMap((x) => x.links)).toEqual(roleLinks(r));
    }
  });

  it('every team has its own accent and every link its own icon, with no raw colour and no opacity on a variable', () => {
    for (const t of TEAMS) {
      expect(TEAM_STYLE[t.team], t.team).toBeDefined();
      expect(TEAM_STYLE[t.team].chip).not.toMatch(/#|\[|\//);
      expect(TEAM_STYLE[t.team].label).not.toMatch(/#|\[|\//);
    }
    const chips = TEAMS.map((t) => TEAM_STYLE[t.team].chip);
    expect(new Set(chips).size).toBe(chips.length);
    const icons = Object.values(LINK_ICON);
    expect(new Set(icons).size).toBe(icons.length);
    for (const l of roleLinks(admin)) expect(LINK_ICON[l.key], l.key).toBeDefined();
  });

  it('the menus read their sections from roleGroups, so desktop and mobile cannot drift', () => {
    for (const f of ['src/components/layout/TopBar.tsx', 'src/components/Navbar.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toContain('roleGroups(');
      expect(src, f).not.toContain('My work');
      expect(src, f).not.toContain('HOD view');
    }
  });
});

describe('admin menu after the clean-up', () => {
  const nav = buildAdminNav('library');

  it('has six tabs by job, each page in the group where an admin would look for it', () => {
    expect(ADMIN_GROUPS.map((g) => g.label)).toEqual(['Needs you', 'Papers', 'People', 'Teachers', 'Logs', 'System']);
    const pagesOf = (key: string) => ADMIN_GROUPS.find((g) => g.key === key)!.pages;
    expect(pagesOf('people')).toContain('hod');
    expect(pagesOf('papers')).toContain('admin-queue');
    expect(pagesOf('teachers')).toContain('reviews');
    expect(pagesOf('system')).toContain('feedback');
    expect(pagesOf('logs')).toEqual(expect.arrayContaining(['audit', 'checker-log']));
  });

  it('puts the HOD desk in the menu and it resolves', () => {
    const hod = nav.find((n) => n.key === 'hod');
    expect(hod?.path).toBe('/hod');
    expect(hod?.label).toBe('HOD desk');
    expect(matches('/hod')).toBe(true);
  });

  it('every menu link resolves', () => {
    for (const n of nav) expect(matches(n.path), `${n.label} -> ${n.path}`).toBe(true);
  });
});

/* Static links written straight into the page files must resolve too. Only
   plain string literals are checked (a template with ${} is dynamic). */
describe('links written into the role screens', () => {
  const files = [
    'src/pages/Checker.tsx',
    'src/pages/Hod.tsx',
    'src/pages/TeacherReview.tsx',
    'src/pages/CheckerHelp.tsx',
    'src/pages/CheckerPractice.tsx',
    'src/components/layout/TopBar.tsx',
    'src/components/Navbar.tsx',
    'src/components/admin/HodSection.tsx',
    'src/components/hod/TeacherReviewersTab.tsx',
    'src/lib/checker-onboarding.ts',
  ];
  it('every to="/x" and navigate(\'/x\') points at a real route', () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const found = [...src.matchAll(/\bto="(\/[^"{}$]*)"/g), ...src.matchAll(/navigate\('(\/[^'$`]*)'/g), ...src.matchAll(/_PATH = '(\/[^']*)'/g)].map((m) => m[1]);
      for (const href of found) if (!matches(href)) bad.push(`${f}: ${href}`);
    }
    expect(bad).toEqual([]);
  });
});
