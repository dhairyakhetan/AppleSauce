import { useState } from 'react';
import { AdminFeedbackPage } from '@/pages/admin/feedback';
import { createFakeFeedbackApi } from '@/dummy/feedback-fake-api';
import { DummyBanner } from '@/dummy/DummyBanner';

/* /admin/feedback in dummy mode (D75): the real page against an in-memory
   fake, no sign-in and no real admin check. Test builds only, reached solely
   through the PREVIEW_TOOLS-gated lazy import in admin/feedback.tsx. */

export default function AdminFeedbackDummy() {
  const [api] = useState(createFakeFeedbackApi);
  return <AdminFeedbackPage api={api} dummy banner={<DummyBanner leaveTo="/admin/feedback?dummy=0" />} />;
}
