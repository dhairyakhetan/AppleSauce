import { useState } from 'react';
import { AdminReviewsPage } from '@/pages/admin/reviews';
import { createFakeReviewsAdminApi, type ReviewsFakeSource } from '@/dummy/reviews-fake-api';
import { DummyBanner } from '@/dummy/DummyBanner';

/* /admin/reviews in dummy mode (D75): the real page against an in-memory
   fake, no sign-in and no real admin check. Test builds only, reached solely
   through the PREVIEW_TOOLS-gated lazy import in admin/reviews.tsx.

   Add &fail=recommendations (or reviews, upvotes) to the address to see that
   source's error state with Try again. */

function failingFromUrl(): ReviewsFakeSource[] {
  try {
    const f = new URLSearchParams(window.location.search).get('fail');
    return f === 'reviews' || f === 'recommendations' || f === 'upvotes' ? [f] : [];
  } catch {
    return [];
  }
}

export default function AdminReviewsDummy() {
  const [api] = useState(() => createFakeReviewsAdminApi({ failing: failingFromUrl() }));
  return <AdminReviewsPage api={api} dummy banner={<DummyBanner leaveTo="/admin/reviews?dummy=0" />} />;
}
