import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() } },
}));

import { checkersPageMeta, sectionPart } from '@/pages/admin/checkers';

/* The People tab draws three sections with the same page. Each one names
   itself in the browser tab, instead of all of them saying "Verifiers". */

describe('the verifiers page title follows the section on screen', () => {
  it('the Verifiers section says Verifiers', () => {
    expect(checkersPageMeta('verifiers', sectionPart('verifiers', true)).title).toBe('Verifiers | Shikshaq Admin');
  });

  it('the HODs section inside Admin says HODs, not Verifiers', () => {
    expect(sectionPart('hods', true)).toBe('hods');
    expect(checkersPageMeta('hods', 'hods').title).toBe('HODs | Shikshaq Admin');
  });

  it('the Teacher reviewers section says Teacher reviewers, not Verifiers', () => {
    expect(sectionPart('reviewers', true)).toBe('reviewers');
    expect(checkersPageMeta('reviewers', 'reviewers').title).toBe('Teacher reviewers | Shikshaq Admin');
  });

  it('the page on its own, showing the HODs tab, names both lists', () => {
    expect(sectionPart('hods', false)).toBe('both');
    expect(checkersPageMeta('hods', 'both').title).toBe('HODs and teacher reviewers | Shikshaq Admin');
  });

  it('every title and description is plain, with no em or en dash', () => {
    const all = [
      checkersPageMeta('verifiers', 'both'),
      checkersPageMeta('hods', 'hods'),
      checkersPageMeta('reviewers', 'reviewers'),
      checkersPageMeta('hods', 'both'),
    ];
    for (const m of all) expect(`${m.title} ${m.description}`).not.toMatch(/[–—]/);
  });
});
