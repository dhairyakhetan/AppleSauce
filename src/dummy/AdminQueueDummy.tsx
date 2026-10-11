import { useState } from 'react';
import { AdminQueuePage } from '@/pages/admin/admin-queue';
import { createFakeAdminQueueApi } from '@/dummy/admin-queue-fake-api';
import { DummyBanner } from '@/dummy/DummyBanner';

/* /admin/admin-queue in dummy mode (D75): the real page against made-up
   papers, no sign-in and no real admin check. Test builds only, reached
   solely through the PREVIEW_TOOLS-gated lazy import in admin/admin-queue.tsx. */

export default function AdminQueueDummy() {
  const [api] = useState(createFakeAdminQueueApi);
  return <AdminQueuePage api={api} dummy banner={<DummyBanner leaveTo="/admin/admin-queue?dummy=0" />} />;
}
