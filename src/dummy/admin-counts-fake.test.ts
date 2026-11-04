import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() } },
}));

import { fakeCounts } from '@/dummy/admin-counts-fake';
import { createFakeApprovalsApi } from '@/dummy/admin-approvals-fake-api';
import { createFakeHodApi } from '@/dummy/hod-fake-api';
import { createFakeReviewsAdminApi } from '@/dummy/reviews-fake-api';
import { tabBadge } from '@/lib/hod-tabs';
import { hodBadge } from '@/pages/admin/shell';

/* Dummy mode is what the owner previews, so its nav badges must say what the
   page they lead to says. Each one is checked against the page's own fake. */

describe('dummy nav counts agree with the pages they lead to', () => {
  it('the HOD desk chip is the three HOD tab badges added up, and is not a separate number', async () => {
    const desk = await createFakeHodApi().deskCounts();
    const tabs = tabBadge('needs-you', desk) + tabBadge('ready', desk) + tabBadge('uploads', desk);
    expect(tabs).toBeGreaterThan(0);
    const { counts, failed } = await fakeCounts();
    expect(hodBadge({ counts, failed })).toEqual({ kind: 'n', n: tabs });
    expect(counts.paperApprovals).toBe(desk.ready);
    expect(counts.adminQueue).toBe(desk.needs_you_questions);
    expect(counts.submissions).toBe(desk.student_uploads_pending);
  });

  it('the Teachers badge is the applications waiting in the Waiting view', async () => {
    const waiting = (await createFakeApprovalsApi().list()).filter((a) => a.status === 'pending').length;
    expect(waiting).toBeGreaterThan(0);
    const { counts } = await fakeCounts();
    expect(counts.approvals).toBe(waiting);
  });

  it('the Teachers badge counts reviews waiting: pending comments plus pending recommendations', async () => {
    const r = await createFakeReviewsAdminApi().counts();
    const { counts } = await fakeCounts();
    expect(counts.reviews).toBe(r.pendingReviews + r.pendingRecommendations);
  });

  it('reports nothing failed in a normal read', async () => {
    expect((await fakeCounts()).failed).toEqual([]);
  });
});
