import { AdminHomePage } from '@/pages/admin/index';

/* /admin in dummy mode (D75): the real Admin page, all four tabs, with no
   sign-in and no real admin check. Each section runs against its own fake. The
   numbers come from src/dummy/admin-counts-fake.ts through the shared counts
   hook, so the tab badges and the sentence under the tabs agree.
   `?counts=error` or `?counts=partial` shows the unreadable-count states.
   The made-up-data strip is drawn by each section's own dummy (it has its own
   hints and its own Leave button), so none is added here.
   Test builds only, reached solely through the PREVIEW_TOOLS-gated lazy import
   in pages/admin/index.tsx. */

export default function AdminOverviewDummy() {
  return <AdminHomePage dummy />;
}
