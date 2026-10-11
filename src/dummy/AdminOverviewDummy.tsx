import { AdminOverviewPage } from '@/pages/admin/index';
import { DummyBanner } from '@/dummy/DummyBanner';

/* /admin in dummy mode (D75): the real "Needs you now" page with no sign-in and
   no real admin check. The numbers come from src/dummy/admin-counts-fake.ts
   through the shared counts hook, so the nav badges and the rows agree.
   `?counts=error` or `?counts=partial` shows the unreadable-count states.
   Test builds only, reached solely through the PREVIEW_TOOLS-gated lazy import
   in pages/admin/index.tsx. */

export default function AdminOverviewDummy() {
  return <AdminOverviewPage dummy banner={<DummyBanner leaveTo="/admin?dummy=0" />} />;
}
