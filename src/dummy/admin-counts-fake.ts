import { createFakeApprovalsApi } from '@/dummy/admin-approvals-fake-api';
import { createFakeHodApi } from '@/dummy/hod-fake-api';
import { createFakeReviewsAdminApi } from '@/dummy/reviews-fake-api';
import type { AdminCountField, AdminCountsResult, AdminSectionCounts } from '@/pages/admin/useAdminSectionCounts';

/* Made-up nav counts for dummy mode (D75). Test builds only: reached solely
   through a dynamic import behind PREVIEW_TOOLS in useAdminSectionCounts.ts.

   `?counts=error` on the URL makes the FIRST read fail on every field, and
   `?counts=partial` makes it fail on two, so the "?" badge and the Retry
   button can be seen. Every later read (the Retry button) succeeds. The state
   is per page load, so it never leaks into a real session.

   Nothing here is a typed-in number. Each badge is read from the same made-up
   fake the page it leads to uses, so the nav, the page's own header and its
   list cannot disagree:
     approvals   pending applications       (admin-approvals-fake-api, the Waiting view)
     reviews     pending reviews + recs     (reviews-fake-api counts)
     the HOD three, from hod_desk_counts    (hod-fake-api, the HOD desk's tab badges) */

const FIELDS: AdminCountField[] = ['paperApprovals', 'adminQueue', 'submissions', 'approvals', 'reviews'];

async function fixtureCounts(): Promise<AdminSectionCounts> {
  const [applications, reviews, desk] = await Promise.all([
    createFakeApprovalsApi().list(),
    createFakeReviewsAdminApi().counts(),
    createFakeHodApi().deskCounts(),
  ]);
  return {
    approvals: applications.filter((a) => a.status === 'pending').length,
    reviews: reviews.pendingReviews + reviews.pendingRecommendations,
    paperApprovals: desk.ready,
    adminQueue: desk.needs_you_questions,
    submissions: desk.student_uploads_pending,
  };
}

function mode(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('counts');
  } catch {
    return null;
  }
}

let firstRead = true;

export async function fakeCounts(): Promise<AdminCountsResult> {
  const failFirst = firstRead ? mode() : null;
  firstRead = false;
  if (failFirst === 'error') return { counts: {}, failed: [...FIELDS] };
  const all = await fixtureCounts();
  if (failFirst === 'partial') {
    const failed: AdminCountField[] = ['adminQueue', 'reviews'];
    const counts: AdminSectionCounts = { ...all };
    for (const f of failed) delete counts[f];
    return { counts, failed };
  }
  return { counts: all, failed: [] };
}
