import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() } },
}));

import { DEFAULT_TAB, TAB_KEYS, resolveTabKey, tabBadge, tabBadgeLabel } from '@/lib/hod-tabs';
import { normaliseDeskCounts } from '@/lib/hod-publish';
import { TABS } from '@/pages/Hod';

describe('HOD desk tabs', () => {
  it('are in the owner order, and the page lists exactly these tabs', () => {
    expect(TAB_KEYS).toEqual(['needs-you', 'send-to-ai', 'ready', 'uploads', 'requests', 'live', 'assignments', 'verifiers', 'history', 'ai-trust', 'teacher-reviewers']);
    expect(TABS.map((t) => t.key)).toEqual([...TAB_KEYS]);
    expect(TABS.map((t) => t.label)).toEqual([
      'Needs you',
      'Send to AI',
      'Ready to go live',
      'Uploads',
      'Requests',
      'Live papers',
      'Assignments',
      'Checkers',
      'History',
      'AI trust',
      'Reviewers',
    ]);
  });

  it('opens on Needs you by default and for anything unknown', () => {
    expect(DEFAULT_TAB).toBe('needs-you');
    expect(resolveTabKey(null)).toBe('needs-you');
    expect(resolveTabKey('nonsense')).toBe('needs-you');
  });

  it('keeps ?tab=escalated working as an alias for Needs you', () => {
    expect(resolveTabKey('escalated')).toBe('needs-you');
  });

  it('knows every real key', () => {
    for (const k of TAB_KEYS) expect(resolveTabKey(k)).toBe(k);
  });

  it('puts count badges on Needs you, Ready and Student uploads only, from hod_desk_counts', () => {
    const c = normaliseDeskCounts({ needs_you: 9, needs_you_questions: 204, ready: 2, ready_ok: 0, student_uploads_pending: 3, live: 1506, hidden: 5 });
    expect(tabBadge('needs-you', c)).toBe(204);
    expect(tabBadge('ready', c)).toBe(0);
    expect(tabBadge('uploads', c)).toBe(3);
    expect(tabBadge('live', c)).toBe(0);
    expect(tabBadge('history', c)).toBe(0);
    expect(tabBadge('ready', null)).toBe(0);
    expect(tabBadgeLabel('needs-you', c)).toBe('204 questions waiting for you');
    expect(tabBadgeLabel('ready', c)).toBe('0 papers can go live now, 2 blocked');
  });

  it('counts only the papers that can really go live on the Ready tab, not the blocked ones', () => {
    const c = normaliseDeskCounts({ ready: 85, ready_ok: 26 });
    expect(tabBadge('ready', c)).toBe(26);
    expect(tabBadgeLabel('ready', c)).toBe('26 papers can go live now, 59 blocked');
    expect(tabBadgeLabel('ready', normaliseDeskCounts({ ready: 1, ready_ok: 1 }))).toBe('1 paper can go live now');
  });

  it('puts the requests waiting for the HOD on the Requests tab, from their own count', () => {
    expect(tabBadge('requests', null, 4)).toBe(4);
    expect(tabBadge('requests', null)).toBe(0);
    expect(tabBadge('live', null, 4)).toBe(0);
    expect(tabBadgeLabel('requests', null, 1)).toBe('1 request waiting for you');
    expect(tabBadgeLabel('requests', null, 3)).toBe('3 requests waiting for you');
    expect(resolveTabKey('requests')).toBe('requests');
  });

  it('uses no em or en dashes in any tab label or hint', () => {
    for (const t of TABS) expect(`${t.label} ${t.hint}`).not.toMatch(/[–—]/);
  });
});
