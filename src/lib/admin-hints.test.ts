import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ADMIN_PAGES, ADMIN_TABS, TIPS, adminHref, adminPageHref, tabOfPage, type AdminPageKey } from '@/lib/admin-hints';

/* Pages that no longer have a place in the Admin page's tabs: their lists moved
   to the HOD desk. Their wording stays for the screens that still open from it. */
const MOVED_TO_HOD: AdminPageKey[] = ['library', 'ready', 'submissions', 'admin-queue'];

describe('admin hints copy', () => {
  it('has no em or en dashes in the file', () => {
    const src = readFileSync(new URL('./admin-hints.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/[–—]/);
  });

  it('has four tabs, in this order, and nothing about papers in them', () => {
    expect(ADMIN_TABS.map((t) => [t.key, t.label])).toEqual([
      ['people', 'People'],
      ['teachers', 'Teachers'],
      ['logs', 'Logs'],
      ['system', 'System'],
    ]);
    expect(ADMIN_TABS.map((t) => t.sections.map((s) => s.key))).toEqual([
      ['positions', 'verifiers', 'hods', 'reviewers', 'progress'],
      ['applications', 'reviews', 'listed'],
      ['question-changes', 'checker-activity', 'admin-actions'],
      ['pipeline', 'feedback'],
    ]);
  });

  it('puts every page in exactly one section, except the ones that moved to the HOD desk', () => {
    const placed = ADMIN_TABS.flatMap((t) => t.sections.map((s) => s.page));
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed, ...MOVED_TO_HOD].sort()).toEqual(Object.keys(ADMIN_PAGES).sort());
    for (const t of ADMIN_TABS) for (const s of t.sections) expect(tabOfPage(s.page)?.key).toBe(t.key);
    for (const p of MOVED_TO_HOD) expect(tabOfPage(p)).toBeNull();
  });

  it('gives every tab and section its words, and every page its copy', () => {
    for (const t of ADMIN_TABS) {
      expect(t.hint.length, t.key).toBeGreaterThan(10);
      expect(t.summary.length, t.key).toBeGreaterThan(20);
      // One sentence: a full stop only at the end.
      expect(t.summary.replace(/\.$/, ''), t.key).not.toContain('. ');
      for (const s of t.sections) expect(s.label.length, s.key).toBeGreaterThan(2);
    }
    for (const page of Object.values(ADMIN_PAGES)) {
      expect(page.short.length).toBeGreaterThan(10);
      expect(page.purpose.length).toBeGreaterThan(30);
      expect(page.flow.length).toBeGreaterThan(10);
      expect(page.path.startsWith('/')).toBe(true);
    }
  });

  it('says where each page is now: a section of the Admin page, or a tab of the HOD desk', () => {
    expect(adminPageHref('audit')).toBe('/admin?tab=logs&section=admin-actions');
    expect(adminPageHref('teachers')).toBe('/admin?tab=teachers&section=listed');
    expect(adminHref('people')).toBe('/admin?tab=people');
    for (const p of MOVED_TO_HOD) expect(ADMIN_PAGES[p].path, p).toMatch(/^\/hod\?tab=(needs-you|ready|uploads|live)$/);
    for (const t of ADMIN_TABS) for (const s of t.sections) expect(ADMIN_PAGES[s.page].path).toBe(adminHref(t.key, s.key));
  });

  it('uses plain words, not internal codes or table names', () => {
    const all = JSON.stringify([ADMIN_TABS, ADMIN_PAGES, TIPS]);
    expect(all).not.toMatch(/review_bucket|bank_papers|audit_|_id\b|rpc|SECURITY|snake_case|bucket|registry/i);
  });

  it('says Read only only on a page that lists no buttons', () => {
    for (const page of Object.values(ADMIN_PAGES)) {
      if (/read only/i.test(page.flow)) expect(page.buttons, `${page.label} says Read only but lists buttons`).toHaveLength(0);
    }
  });

  it('uses one word for the people who check: verifier', () => {
    for (const key of ['team', 'checkers'] as const) {
      const p = ADMIN_PAGES[key];
      expect(`${p.label} ${p.short} ${p.purpose} ${p.flow}`).not.toMatch(/\bstudents?\b/i);
    }
  });

  it('sends the verifier details to the HOD desk, where they are saved', () => {
    const p = ADMIN_PAGES.checkers;
    expect(p.purpose).toContain('HOD desk');
    expect(p.buttons.find((b) => b.label === 'Details')?.does).toContain('HOD desk');
  });
});
