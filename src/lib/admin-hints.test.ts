import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ADMIN_GROUPS, ADMIN_PAGES, PAGE_ORDER, TIPS, groupOf } from '@/lib/admin-hints';

describe('admin hints copy', () => {
  it('has no em or en dashes in the file', () => {
    const src = readFileSync(new URL('./admin-hints.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/[\u2013\u2014]/);
  });

  it('puts every page in exactly one group and gives it all its copy', () => {
    const seen = new Set<string>();
    for (const g of ADMIN_GROUPS) {
      expect(g.blurb.length).toBeGreaterThan(10);
      for (const p of g.pages) {
        expect(seen.has(p)).toBe(false);
        seen.add(p);
        expect(groupOf(p).key).toBe(g.key);
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(ADMIN_PAGES).sort());
    expect(PAGE_ORDER).toHaveLength(Object.keys(ADMIN_PAGES).length);
    for (const page of Object.values(ADMIN_PAGES)) {
      expect(page.short.length).toBeGreaterThan(10);
      expect(page.purpose.length).toBeGreaterThan(30);
      expect(page.flow.length).toBeGreaterThan(10);
      expect(page.path.startsWith('/')).toBe(true);
    }
  });

  it('uses plain words, not internal codes or table names', () => {
    const all = JSON.stringify([ADMIN_GROUPS, ADMIN_PAGES, TIPS]);
    expect(all).not.toMatch(/review_bucket|bank_papers|audit_|_id\b|rpc|SECURITY|snake_case/i);
  });

  it('says Read only only on a page that lists no buttons', () => {
    for (const page of Object.values(ADMIN_PAGES)) {
      if (/read only/i.test(page.flow)) expect(page.buttons, `${page.label} says Read only but lists buttons`).toHaveLength(0);
    }
  });

  it('has the six groups in order, the landing first and outside links last', () => {
    expect(ADMIN_GROUPS.map((g) => g.key)).toEqual(['now', 'papers', 'people', 'teachers', 'logs', 'system']);
    expect(ADMIN_GROUPS.map((g) => g.label)).toEqual(['Needs you', 'Papers', 'People', 'Teachers', 'Logs', 'System']);
    expect(ADMIN_GROUPS[0].pages).toEqual(['now']);
    expect(ADMIN_PAGES.now.path).toBe('/admin');
  });

  it('uses one word for the people who check: verifier', () => {
    for (const key of ['team', 'checkers'] as const) {
      const p = ADMIN_PAGES[key];
      expect(`${p.label} ${p.short} ${p.purpose} ${p.flow}`).not.toMatch(/\bstudents?\b/i);
    }
  });
});
